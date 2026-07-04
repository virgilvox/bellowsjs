import { describe, expect, it } from 'vitest';
import {
  buildOggPage,
  canEncode,
  encodeAudio,
  oggCrc,
  oggOpusMux,
  opusHead,
  opusPacketSamples,
  opusTags,
} from '../../src/io/encode';
import { rng } from '../../src/core/prng';

/* Independent bit-by-bit CRC: polynomial 0x04c11db7, init 0, no
 * reflection, no final xor. The table-driven version must match it. */
function slowCrc(bytes: Uint8Array): number {
  let crc = 0;
  for (const byte of bytes) {
    crc = (crc ^ (byte << 24)) >>> 0;
    for (let i = 0; i < 8; i++) {
      crc = ((crc & 0x80000000) !== 0 ? (crc << 1) ^ 0x04c11db7 : crc << 1) >>> 0;
    }
  }
  return crc;
}

function randomBytes(n: number, label: string): Uint8Array {
  const r = rng(label);
  const out = new Uint8Array(n);
  for (let i = 0; i < n; i++) out[i] = r.int(256);
  return out;
}

describe('oggCrc', () => {
  it('matches a bitwise reference implementation', () => {
    expect(oggCrc(new Uint8Array(0))).toBe(0);
    for (const n of [1, 7, 64, 255, 1000]) {
      const data = randomBytes(n, `crc-${n}`);
      expect(oggCrc(data)).toBe(slowCrc(data));
    }
  });

  it('matches the known check value for "123456789"', () => {
    const data = new Uint8Array([0x31, 0x32, 0x33, 0x34, 0x35, 0x36, 0x37, 0x38, 0x39]);
    expect(slowCrc(data)).toBe(0x89a1897f);
    expect(oggCrc(data)).toBe(0x89a1897f);
  });
});

function readPage(bytes: Uint8Array, off: number) {
  const v = new DataView(bytes.buffer, bytes.byteOffset);
  const magic = String.fromCharCode(bytes[off], bytes[off + 1], bytes[off + 2], bytes[off + 3]);
  const flags = bytes[off + 5];
  const granule = Number(v.getBigUint64(off + 6, true));
  const serial = v.getUint32(off + 14, true);
  const sequence = v.getUint32(off + 18, true);
  const crc = v.getUint32(off + 22, true);
  const segCount = bytes[off + 26];
  const lacing = Array.from(bytes.subarray(off + 27, off + 27 + segCount));
  let payloadLen = 0;
  for (const l of lacing) payloadLen += l;
  const payload = bytes.subarray(off + 27 + segCount, off + 27 + segCount + payloadLen);
  const size = 27 + segCount + payloadLen;
  return { magic, flags, granule, serial, sequence, crc, segCount, lacing, payload, size };
}

describe('buildOggPage', () => {
  it('lays out header fields and lacing for a short packet', () => {
    const payload = randomBytes(100, 'page-short');
    const page = buildOggPage({
      packets: [payload],
      granule: 960,
      serial: 0xdeadbeef,
      sequence: 7,
      bos: true,
    });
    const p = readPage(page, 0);
    expect(p.magic).toBe('OggS');
    expect(page[4]).toBe(0); // version
    expect(p.flags).toBe(2); // bos only
    expect(p.granule).toBe(960);
    expect(p.serial).toBe(0xdeadbeef);
    expect(p.sequence).toBe(7);
    expect(p.lacing).toEqual([100]);
    expect(Array.from(p.payload)).toEqual(Array.from(payload));
  });

  it('laces packet sizes across the 255 boundary', () => {
    const cases: [number, number[]][] = [
      [0, [0]],
      [254, [254]],
      [255, [255, 0]],
      [256, [255, 1]],
      [510, [255, 255, 0]],
      [600, [255, 255, 90]],
    ];
    for (const [len, lacing] of cases) {
      const page = buildOggPage({
        packets: [new Uint8Array(len)],
        granule: 0,
        serial: 1,
        sequence: 0,
      });
      expect(readPage(page, 0).lacing, `packet length ${len}`).toEqual(lacing);
    }
  });

  it('laces multiple packets on one page', () => {
    const page = buildOggPage({
      packets: [new Uint8Array(10), new Uint8Array(255), new Uint8Array(3)],
      granule: 0,
      serial: 1,
      sequence: 0,
    });
    expect(readPage(page, 0).lacing).toEqual([10, 255, 0, 3]);
  });

  it('embeds a CRC computed with the CRC field zeroed', () => {
    const page = buildOggPage({
      packets: [randomBytes(300, 'page-crc')],
      granule: 1920,
      serial: 42,
      sequence: 3,
      eos: true,
    });
    const p = readPage(page, 0);
    expect(p.flags).toBe(4);
    const zeroed = page.slice();
    zeroed[22] = 0;
    zeroed[23] = 0;
    zeroed[24] = 0;
    zeroed[25] = 0;
    expect(p.crc).toBe(slowCrc(zeroed));
  });

  it('rejects payloads needing more than 255 segments', () => {
    expect(() =>
      buildOggPage({ packets: [new Uint8Array(256 * 255)], granule: 0, serial: 1, sequence: 0 }),
    ).toThrow(/segments/);
  });
});

describe('opus packet headers', () => {
  it('builds a spec-shaped OpusHead', () => {
    const head = opusHead(2, 312, 44100);
    expect(head).toHaveLength(19);
    expect(String.fromCharCode(...head.subarray(0, 8))).toBe('OpusHead');
    expect(head[8]).toBe(1);
    expect(head[9]).toBe(2);
    const v = new DataView(head.buffer);
    expect(v.getUint16(10, true)).toBe(312);
    expect(v.getUint32(12, true)).toBe(44100);
    expect(head[18]).toBe(0);
    expect(() => opusHead(3, 0, 48000)).toThrow();
  });

  it('builds OpusTags with the vendor string and zero comments', () => {
    const tags = opusTags('abc');
    expect(String.fromCharCode(...tags.subarray(0, 8))).toBe('OpusTags');
    const v = new DataView(tags.buffer);
    expect(v.getUint32(8, true)).toBe(3);
    expect(String.fromCharCode(...tags.subarray(12, 15))).toBe('abc');
    expect(v.getUint32(15, true)).toBe(0);
  });
});

describe('opusPacketSamples', () => {
  it('reads frame duration and count from the TOC byte', () => {
    // config 31 (CELT FB 20 ms), code 0: one frame, 960 samples.
    expect(opusPacketSamples(new Uint8Array([(31 << 3) | 0, 1, 2]))).toBe(960);
    // config 1 (SILK NB 20 ms), code 1: two frames.
    expect(opusPacketSamples(new Uint8Array([(1 << 3) | 1]))).toBe(1920);
    // config 13 (hybrid FB... SWB 20 ms), code 2: two frames.
    expect(opusPacketSamples(new Uint8Array([(13 << 3) | 2]))).toBe(1920);
    // config 16 (CELT NB 2.5 ms), code 3 with count byte 4.
    expect(opusPacketSamples(new Uint8Array([(16 << 3) | 3, 4]))).toBe(480);
    // config 3 (SILK NB 60 ms), one frame.
    expect(opusPacketSamples(new Uint8Array([3 << 3]))).toBe(2880);
  });

  it('throws on empty or truncated packets', () => {
    expect(() => opusPacketSamples(new Uint8Array(0))).toThrow();
    expect(() => opusPacketSamples(new Uint8Array([(16 << 3) | 3]))).toThrow();
  });
});

describe('oggOpusMux', () => {
  it('assembles head, tags, and audio pages with cumulative granules', () => {
    // Three fake 20 ms CELT FB packets (960 samples each).
    const toc = (31 << 3) | 0;
    const packets = [0, 1, 2].map((i) => {
      const p = randomBytes(40 + i, `pkt-${i}`);
      p[0] = toc;
      return p;
    });
    const file = oggOpusMux(packets, { channels: 2, inputSampleRate: 48000, preSkip: 312 });

    const pages = [];
    let off = 0;
    while (off < file.length) {
      const p = readPage(file, off);
      pages.push(p);
      off += p.size;
    }
    expect(off).toBe(file.length);
    expect(pages).toHaveLength(5);

    expect(pages[0].flags & 2).toBe(2); // bos
    expect(String.fromCharCode(...pages[0].payload.subarray(0, 8))).toBe('OpusHead');
    expect(pages[0].granule).toBe(0);
    expect(String.fromCharCode(...pages[1].payload.subarray(0, 8))).toBe('OpusTags');

    expect(pages[2].granule).toBe(960);
    expect(pages[3].granule).toBe(1920);
    expect(pages[4].granule).toBe(2880);
    expect(pages[4].flags & 4).toBe(4); // eos
    expect(pages[2].flags & 4).toBe(0);

    for (let i = 0; i < pages.length; i++) expect(pages[i].sequence).toBe(i);
    const serials = new Set(pages.map((p) => p.serial));
    expect(serials.size).toBe(1);

    expect(Array.from(pages[3].payload)).toEqual(Array.from(packets[1]));

    // Every page carries a valid CRC.
    off = 0;
    for (const p of pages) {
      const raw = file.slice(off, off + p.size);
      raw[22] = 0;
      raw[23] = 0;
      raw[24] = 0;
      raw[25] = 0;
      expect(p.crc).toBe(slowCrc(raw));
      off += p.size;
    }
  });

  it('uses a verbatim id header when provided', () => {
    const idHeader = opusHead(1, 555, 48000);
    const toc = (31 << 3) | 0;
    const file = oggOpusMux([new Uint8Array([toc, 9])], {
      channels: 1,
      inputSampleRate: 48000,
      idHeader,
    });
    const first = readPage(file, 0);
    expect(Array.from(first.payload)).toEqual(Array.from(idHeader));
    const v = new DataView(first.payload.buffer, first.payload.byteOffset);
    expect(v.getUint16(10, true)).toBe(555); // pre-skip passed through
  });
});

describe('WebCodecs guards in Node', () => {
  it('canEncode resolves false without AudioEncoder', async () => {
    await expect(canEncode('opus')).resolves.toBe(false);
    await expect(canEncode('aac')).resolves.toBe(false);
  });

  it('encodeAudio rejects with a clear error', async () => {
    await expect(
      encodeAudio([new Float32Array(480)], 48000, { codec: 'opus' }),
    ).rejects.toThrow(/WebCodecs/);
  });
});
