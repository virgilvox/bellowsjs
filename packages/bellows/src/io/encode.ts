/*
 * Compressed audio export through WebCodecs. encodeAudio runs planar
 * float channels through an AudioEncoder and assembles the packets into
 * a playable file: Ogg Opus for opus (the muxer below is pure and
 * tested in Node), an ADTS stream for aac. canEncode feature-detects.
 *
 * Ogg reference: RFC 3533 (framing) and RFC 7845 (Opus encapsulation).
 * The page CRC is CRC-32 with polynomial 0x04c11db7, zero initial value,
 * no reflection, no final xor, computed with the CRC field zeroed.
 */

/* ------------------------------------------------------------------ */
/* Ogg framing (pure)                                                  */
/* ------------------------------------------------------------------ */

const CRC_TABLE = new Uint32Array(256);
for (let i = 0; i < 256; i++) {
  let r = i << 24;
  for (let j = 0; j < 8; j++) {
    r = ((r & 0x80000000) !== 0 ? (r << 1) ^ 0x04c11db7 : r << 1) >>> 0;
  }
  CRC_TABLE[i] = r;
}

export function oggCrc(bytes: Uint8Array): number {
  let crc = 0;
  for (let i = 0; i < bytes.length; i++) {
    crc = (((crc << 8) >>> 0) ^ CRC_TABLE[((crc >>> 24) ^ bytes[i]) & 0xff]) >>> 0;
  }
  return crc;
}

export interface OggPageOptions {
  /** Packets completed on this page. Each is laced into 255-byte segments. */
  packets: Uint8Array[];
  /** Granule position: for Opus, total 48 kHz samples through this page. */
  granule: number;
  serial: number;
  sequence: number;
  bos?: boolean;
  eos?: boolean;
  continued?: boolean;
}

export function buildOggPage(opts: OggPageOptions): Uint8Array {
  const lacing: number[] = [];
  let payloadLen = 0;
  for (const p of opts.packets) {
    let rest = p.length;
    // A packet of n*255 bytes needs a trailing 0 lacing value.
    for (;;) {
      const seg = rest >= 255 ? 255 : rest;
      lacing.push(seg);
      rest -= seg;
      if (seg < 255) break;
    }
    payloadLen += p.length;
  }
  if (lacing.length > 255) throw new Error('ogg: too many segments for one page');

  const page = new Uint8Array(27 + lacing.length + payloadLen);
  const v = new DataView(page.buffer);
  page[0] = 0x4f; // 'OggS'
  page[1] = 0x67;
  page[2] = 0x67;
  page[3] = 0x53;
  page[4] = 0; // version
  page[5] = (opts.continued ? 1 : 0) | (opts.bos ? 2 : 0) | (opts.eos ? 4 : 0);
  v.setBigUint64(6, BigInt(opts.granule), true);
  v.setUint32(14, opts.serial >>> 0, true);
  v.setUint32(18, opts.sequence >>> 0, true);
  // CRC at 22 stays zero until computed.
  page[26] = lacing.length;
  for (let i = 0; i < lacing.length; i++) page[27 + i] = lacing[i];
  let off = 27 + lacing.length;
  for (const p of opts.packets) {
    page.set(p, off);
    off += p.length;
  }
  v.setUint32(22, oggCrc(page), true);
  return page;
}

/* ------------------------------------------------------------------ */
/* Opus encapsulation (pure)                                           */
/* ------------------------------------------------------------------ */

/** RFC 7845 identification header. Channel mapping family 0 (mono/stereo). */
export function opusHead(channels: number, preSkip: number, inputSampleRate: number): Uint8Array {
  if (channels !== 1 && channels !== 2) {
    throw new Error(`ogg: channel mapping family 0 requires 1 or 2 channels, got ${channels}`);
  }
  const head = new Uint8Array(19);
  const v = new DataView(head.buffer);
  head.set([0x4f, 0x70, 0x75, 0x73, 0x48, 0x65, 0x61, 0x64]); // 'OpusHead'
  head[8] = 1; // version
  head[9] = channels;
  v.setUint16(10, preSkip, true);
  v.setUint32(12, inputSampleRate, true);
  v.setInt16(16, 0, true); // output gain
  head[18] = 0; // mapping family
  return head;
}

/** RFC 7845 comment header with no user comments. */
export function opusTags(vendor = 'bellowsjs'): Uint8Array {
  const tags = new Uint8Array(8 + 4 + vendor.length + 4);
  const v = new DataView(tags.buffer);
  tags.set([0x4f, 0x70, 0x75, 0x73, 0x54, 0x61, 0x67, 0x73]); // 'OpusTags'
  v.setUint32(8, vendor.length, true);
  for (let i = 0; i < vendor.length; i++) tags[12 + i] = vendor.charCodeAt(i);
  v.setUint32(12 + vendor.length, 0, true); // comment count
  return tags;
}

/* Frame duration in 48 kHz samples for each TOC config (RFC 6716 3.1):
 * SILK 10/20/40/60 ms three times, hybrid 10/20 ms twice,
 * CELT 2.5/5/10/20 ms four times. */
const OPUS_CONFIG_SAMPLES = [
  480, 960, 1920, 2880, 480, 960, 1920, 2880, 480, 960, 1920, 2880, 480, 960, 480, 960, 120, 240,
  480, 960, 120, 240, 480, 960, 120, 240, 480, 960, 120, 240, 480, 960,
];

/** Decoded duration of one Opus packet in 48 kHz samples, from the TOC byte. */
export function opusPacketSamples(packet: Uint8Array): number {
  if (packet.length === 0) throw new Error('ogg: empty opus packet');
  const toc = packet[0];
  const perFrame = OPUS_CONFIG_SAMPLES[toc >> 3];
  const code = toc & 3;
  let frames: number;
  if (code === 0) frames = 1;
  else if (code === 3) {
    if (packet.length < 2) throw new Error('ogg: truncated opus packet');
    frames = packet[1] & 0x3f;
  } else frames = 2;
  return perFrame * frames;
}

export interface OggOpusOptions {
  channels: number;
  /** Original input rate, informational in the header. */
  inputSampleRate: number;
  /** 48 kHz samples the player discards at start. Ignored when idHeader is given. */
  preSkip?: number;
  /** Verbatim identification header, e.g. the WebCodecs decoderConfig description. */
  idHeader?: Uint8Array;
  serial?: number;
}

/**
 * Assemble raw Opus packets into a complete Ogg Opus file. One packet
 * per audio page; granule positions accumulate packet durations.
 */
export function oggOpusMux(packets: Uint8Array[], opts: OggOpusOptions): Uint8Array {
  const serial = opts.serial ?? 0x42454c4c;
  const head = opts.idHeader ?? opusHead(opts.channels, opts.preSkip ?? 312, opts.inputSampleRate);

  const pages: Uint8Array[] = [];
  pages.push(buildOggPage({ packets: [head], granule: 0, serial, sequence: 0, bos: true }));
  pages.push(buildOggPage({ packets: [opusTags()], granule: 0, serial, sequence: 1 }));

  let granule = 0;
  for (let i = 0; i < packets.length; i++) {
    granule += opusPacketSamples(packets[i]);
    pages.push(
      buildOggPage({
        packets: [packets[i]],
        granule,
        serial,
        sequence: 2 + i,
        eos: i === packets.length - 1,
      }),
    );
  }

  let total = 0;
  for (const p of pages) total += p.length;
  const out = new Uint8Array(total);
  let off = 0;
  for (const p of pages) {
    out.set(p, off);
    off += p.length;
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* WebCodecs wrapper (browser only)                                    */
/* ------------------------------------------------------------------ */

/* Minimal structural types so this file does not depend on DOM lib
 * versions shipping WebCodecs. */
interface ChunkLike {
  byteLength: number;
  copyTo(dest: Uint8Array): void;
}
interface MetaLike {
  decoderConfig?: { description?: ArrayBuffer | ArrayBufferView };
}
interface AudioEncoderLike {
  configure(config: Record<string, unknown>): void;
  encode(data: unknown): void;
  flush(): Promise<void>;
  close(): void;
}
interface AudioEncoderCtor {
  new (init: {
    output: (chunk: ChunkLike, meta?: MetaLike) => void;
    error: (e: unknown) => void;
  }): AudioEncoderLike;
  isConfigSupported(config: Record<string, unknown>): Promise<{ supported?: boolean }>;
}
interface AudioDataCtor {
  new (init: {
    format: string;
    sampleRate: number;
    numberOfFrames: number;
    numberOfChannels: number;
    timestamp: number;
    data: Float32Array;
  }): unknown;
}

function getAudioEncoder(): AudioEncoderCtor | null {
  const g = globalThis as { AudioEncoder?: AudioEncoderCtor };
  return typeof g.AudioEncoder === 'function' ? g.AudioEncoder : null;
}

function getAudioData(): AudioDataCtor | null {
  const g = globalThis as { AudioData?: AudioDataCtor };
  return typeof g.AudioData === 'function' ? g.AudioData : null;
}

export type EncodeCodec = 'opus' | 'aac';

export interface EncodeAudioOptions {
  codec: EncodeCodec;
  /** Bits per second. Default 128000. */
  bitrate?: number;
}

export interface EncodedAudio {
  /** Playable file: Ogg Opus for opus, raw ADTS stream for aac. */
  data: Uint8Array;
  /** 'audio/ogg; codecs=opus' or 'audio/aac'. */
  mimeType: string;
  /** The raw encoded packets, in order. */
  chunks: Uint8Array[];
  sampleRate: number;
  numberOfChannels: number;
}

function encoderConfig(codec: EncodeCodec, sampleRate: number, channels: number, bitrate: number) {
  const config: Record<string, unknown> = {
    codec: codec === 'opus' ? 'opus' : 'mp4a.40.2',
    sampleRate,
    numberOfChannels: channels,
    bitrate,
  };
  // ADTS packets are self-framing, so concatenating them is playable.
  if (codec === 'aac') config.aac = { format: 'adts' };
  return config;
}

/** True when this environment's AudioEncoder accepts the codec. */
export async function canEncode(codec: EncodeCodec, sampleRate = 48000, channels = 2): Promise<boolean> {
  const Encoder = getAudioEncoder();
  if (Encoder === null) return false;
  try {
    const res = await Encoder.isConfigSupported(encoderConfig(codec, sampleRate, channels, 128000));
    return res.supported === true;
  } catch {
    return false;
  }
}

const FRAMES_PER_CHUNK = 9600;

export async function encodeAudio(
  channels: Float32Array[],
  sampleRate: number,
  opts: EncodeAudioOptions,
): Promise<EncodedAudio> {
  const Encoder = getAudioEncoder();
  const AudioDataC = getAudioData();
  if (Encoder === null || AudioDataC === null) {
    throw new Error('encode: WebCodecs AudioEncoder is not available in this environment');
  }
  if (channels.length === 0) throw new Error('encode: no channels');
  const numCh = channels.length;
  const frames = channels[0].length;
  for (const ch of channels) {
    if (ch.length !== frames) throw new Error('encode: channel lengths differ');
  }

  const chunks: Uint8Array[] = [];
  let idHeader: Uint8Array | undefined;
  let firstError: unknown = null;

  const encoder = new Encoder({
    output: (chunk, meta) => {
      const bytes = new Uint8Array(chunk.byteLength);
      chunk.copyTo(bytes);
      chunks.push(bytes);
      const desc = meta?.decoderConfig?.description;
      if (idHeader === undefined && desc !== undefined) {
        idHeader = ArrayBuffer.isView(desc)
          ? new Uint8Array(desc.buffer.slice(desc.byteOffset, desc.byteOffset + desc.byteLength))
          : new Uint8Array(desc.slice(0));
      }
    },
    error: (e) => {
      if (firstError === null) firstError = e;
    },
  });

  encoder.configure(encoderConfig(opts.codec, sampleRate, numCh, opts.bitrate ?? 128000));

  for (let start = 0; start < frames; start += FRAMES_PER_CHUNK) {
    const n = Math.min(FRAMES_PER_CHUNK, frames - start);
    const planar = new Float32Array(n * numCh);
    for (let c = 0; c < numCh; c++) planar.set(channels[c].subarray(start, start + n), c * n);
    encoder.encode(
      new AudioDataC({
        format: 'f32-planar',
        sampleRate,
        numberOfFrames: n,
        numberOfChannels: numCh,
        timestamp: Math.round((start / sampleRate) * 1e6),
        data: planar,
      }),
    );
  }

  await encoder.flush();
  encoder.close();
  if (firstError !== null) {
    throw firstError instanceof Error ? firstError : new Error(String(firstError));
  }

  if (opts.codec === 'opus') {
    const data = oggOpusMux(chunks, { channels: numCh, inputSampleRate: sampleRate, idHeader });
    return { data, mimeType: 'audio/ogg; codecs=opus', chunks, sampleRate, numberOfChannels: numCh };
  }

  let total = 0;
  for (const c of chunks) total += c.length;
  const data = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) {
    data.set(c, off);
    off += c.length;
  }
  return { data, mimeType: 'audio/aac', chunks, sampleRate, numberOfChannels: numCh };
}
