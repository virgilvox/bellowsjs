/*
 * WAV codec. encodeWav writes RIFF/WAVE from planar float channels as
 * 16 or 24 bit integer PCM or 32 bit IEEE float. decodeWav walks the
 * chunk list, reads PCM 8/16/24/32 and float32 (including the
 * WAVE_FORMAT_EXTENSIBLE wrapper), ignores unknown chunks, and tolerates
 * the pad byte after odd-sized chunks. All multibyte fields are little
 * endian. Integer encoding clamps to [-1, 1] and rounds symmetrically
 * (scale 2^(bits-1) - 1), no dither.
 */

export type WavBitDepth = 16 | 24 | 32;

export interface EncodeWavOptions {
  /** 16 and 24 write integer PCM, 32 writes IEEE float. Default 16. */
  bitDepth?: WavBitDepth;
}

export interface DecodedWav {
  channels: Float32Array[];
  sampleRate: number;
}

const FORMAT_PCM = 1;
const FORMAT_FLOAT = 3;
const FORMAT_EXTENSIBLE = 0xfffe;

function writeAscii(v: DataView, offset: number, text: string): void {
  for (let i = 0; i < text.length; i++) v.setUint8(offset + i, text.charCodeAt(i));
}

function readAscii(v: DataView, offset: number, len: number): string {
  let s = '';
  for (let i = 0; i < len; i++) s += String.fromCharCode(v.getUint8(offset + i));
  return s;
}

export function encodeWav(
  channels: Float32Array[],
  sampleRate: number,
  opts: EncodeWavOptions = {},
): ArrayBuffer {
  const bitDepth = opts.bitDepth ?? 16;
  if (bitDepth !== 16 && bitDepth !== 24 && bitDepth !== 32) {
    throw new Error(`wav: unsupported bit depth ${bitDepth}`);
  }
  if (channels.length === 0) throw new Error('wav: no channels');
  if (!(sampleRate > 0) || !Number.isFinite(sampleRate)) {
    throw new Error(`wav: invalid sample rate ${sampleRate}`);
  }
  const frames = channels[0].length;
  for (const ch of channels) {
    if (ch.length !== frames) throw new Error('wav: channel lengths differ');
  }

  const numCh = channels.length;
  const bytesPer = bitDepth / 8;
  const blockAlign = numCh * bytesPer;
  const dataSize = frames * blockAlign;
  const isFloat = bitDepth === 32;

  // Float files get the spec-required extended fmt (cbSize 0) plus a fact chunk.
  const fmtSize = isFloat ? 18 : 16;
  const factBytes = isFloat ? 12 : 0;
  const dataPad = dataSize & 1;
  const riffBody = 4 + (8 + fmtSize) + factBytes + (8 + dataSize + dataPad);
  const buf = new ArrayBuffer(8 + riffBody);
  const v = new DataView(buf);

  writeAscii(v, 0, 'RIFF');
  v.setUint32(4, riffBody, true);
  writeAscii(v, 8, 'WAVE');

  let off = 12;
  writeAscii(v, off, 'fmt ');
  v.setUint32(off + 4, fmtSize, true);
  v.setUint16(off + 8, isFloat ? FORMAT_FLOAT : FORMAT_PCM, true);
  v.setUint16(off + 10, numCh, true);
  v.setUint32(off + 12, sampleRate, true);
  v.setUint32(off + 16, sampleRate * blockAlign, true);
  v.setUint16(off + 20, blockAlign, true);
  v.setUint16(off + 22, bitDepth, true);
  if (isFloat) v.setUint16(off + 24, 0, true);
  off += 8 + fmtSize;

  if (isFloat) {
    writeAscii(v, off, 'fact');
    v.setUint32(off + 4, 4, true);
    v.setUint32(off + 8, frames, true);
    off += 12;
  }

  writeAscii(v, off, 'data');
  v.setUint32(off + 4, dataSize, true);
  off += 8;

  const scale = bitDepth === 16 ? 32767 : 8388607;
  for (let i = 0; i < frames; i++) {
    for (let c = 0; c < numCh; c++) {
      const s = channels[c][i];
      if (isFloat) {
        v.setFloat32(off, s, true);
      } else {
        const clamped = s < -1 ? -1 : s > 1 ? 1 : s;
        const q = Math.round(clamped * scale);
        if (bitDepth === 16) {
          v.setInt16(off, q, true);
        } else {
          v.setUint8(off, q & 0xff);
          v.setUint8(off + 1, (q >> 8) & 0xff);
          v.setUint8(off + 2, (q >> 16) & 0xff);
        }
      }
      off += bytesPer;
    }
  }
  return buf;
}

interface FmtChunk {
  format: number;
  numChannels: number;
  sampleRate: number;
  bitsPerSample: number;
}

export function decodeWav(buf: ArrayBuffer): DecodedWav {
  if (buf.byteLength < 12) throw new Error('wav: buffer too short');
  const v = new DataView(buf);
  if (readAscii(v, 0, 4) !== 'RIFF' || readAscii(v, 8, 4) !== 'WAVE') {
    throw new Error('wav: not a RIFF/WAVE file');
  }

  let fmt: FmtChunk | null = null;
  let dataOff = -1;
  let dataLen = 0;

  let off = 12;
  while (off + 8 <= buf.byteLength) {
    const id = readAscii(v, off, 4);
    const size = v.getUint32(off + 4, true);
    const body = off + 8;
    if (id === 'fmt ') {
      if (size < 16 || body + 16 > buf.byteLength) throw new Error('wav: fmt chunk too short');
      let format = v.getUint16(body, true);
      const numChannels = v.getUint16(body + 2, true);
      const sampleRate = v.getUint32(body + 4, true);
      const bitsPerSample = v.getUint16(body + 14, true);
      if (format === FORMAT_EXTENSIBLE) {
        if (size < 40 || body + 26 > buf.byteLength) {
          throw new Error('wav: extensible fmt chunk too short');
        }
        // The first two bytes of the subformat GUID hold the real format code.
        format = v.getUint16(body + 24, true);
      }
      fmt = { format, numChannels, sampleRate, bitsPerSample };
    } else if (id === 'data') {
      dataOff = body;
      // Tolerate a data size field that overruns the buffer.
      dataLen = Math.min(size, buf.byteLength - body);
    }
    off = body + size + (size & 1);
  }

  if (fmt === null) throw new Error('wav: missing fmt chunk');
  if (dataOff < 0) throw new Error('wav: missing data chunk');
  if (fmt.numChannels < 1) throw new Error('wav: no channels');
  if (!(fmt.sampleRate > 0)) throw new Error('wav: invalid sample rate');

  const { format, numChannels, bitsPerSample } = fmt;
  const pcm = format === FORMAT_PCM;
  if (pcm) {
    if (bitsPerSample !== 8 && bitsPerSample !== 16 && bitsPerSample !== 24 && bitsPerSample !== 32) {
      throw new Error(`wav: unsupported PCM bit depth ${bitsPerSample}`);
    }
  } else if (format === FORMAT_FLOAT) {
    if (bitsPerSample !== 32) throw new Error(`wav: unsupported float bit depth ${bitsPerSample}`);
  } else {
    throw new Error(`wav: unsupported format code ${format}`);
  }

  const bytesPer = bitsPerSample / 8;
  const blockAlign = bytesPer * numChannels;
  const frames = Math.floor(dataLen / blockAlign);
  const channels: Float32Array[] = [];
  for (let c = 0; c < numChannels; c++) channels.push(new Float32Array(frames));

  for (let i = 0; i < frames; i++) {
    for (let c = 0; c < numChannels; c++) {
      const o = dataOff + (i * numChannels + c) * bytesPer;
      let s: number;
      if (!pcm) {
        s = v.getFloat32(o, true);
      } else if (bitsPerSample === 8) {
        s = (v.getUint8(o) - 128) / 128;
      } else if (bitsPerSample === 16) {
        s = v.getInt16(o, true) / 32768;
      } else if (bitsPerSample === 24) {
        const u = v.getUint8(o) | (v.getUint8(o + 1) << 8) | (v.getUint8(o + 2) << 16);
        s = (u >= 0x800000 ? u - 0x1000000 : u) / 8388608;
      } else {
        s = v.getInt32(o, true) / 2147483648;
      }
      channels[c][i] = s;
    }
  }

  return { channels, sampleRate: fmt.sampleRate };
}
