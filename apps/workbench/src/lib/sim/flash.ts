/*
 * Flashing a Teensy from the browser, over WebHID.
 *
 * READ THIS BEFORE TRUSTING IT
 *
 * This code has never been run against a board. It is written from the
 * HalfKay protocol as implemented in PJRC's teensy_loader_cli, and the
 * protocol is simple enough that transcribing it is low risk, but "compiles
 * and looks right" is not "flashes a board" and this project does not
 * pretend otherwise anywhere else either. The UI says so, and the .hex
 * download plus the teensy_loader_cli command are offered next to it as the
 * path that is known to work.
 *
 * WHY WebHID AND NOT WebUSB
 * HalfKay enumerates as USB HID. Chromium refuses to let WebUSB claim an
 * HID interface, and on Windows and macOS the OS HID driver has it anyway.
 * WebHID works through that driver instead of fighting it. Chromium's HID
 * blocklist covers FIDO, pointing devices and a few vendors; HalfKay's
 * vendor usage page is not on it.
 *
 * WHERE IT WILL NOT WORK
 *   - Firefox and Safari have no WebHID and have both objected to it.
 *     There is no roadmap. Those users get the download.
 *   - No mobile browser has it.
 *   - Linux needs a udev rule before /dev/hidraw is reachable, which is
 *     "install a file as root" and partly defeats the point.
 */

/** HalfKay in bootloader mode, every Teensy. */
export const TEENSY_VID = 0x16c0;
export const TEENSY_PID = 0x0478;

export interface FlashTarget {
  /** Bytes per write, from teensy_loader_cli's per board table. */
  blockSize: number;
  /** Bytes of address prefix before the padding. */
  addrBytes: number;
  /** Flash base subtracted from Intel HEX addresses, 4.x only. */
  flashBase: number;
}

/** The two families the examples build for. */
export const TARGETS: Record<string, FlashTarget> = {
  /* Teensy 4.x: 1024 byte blocks, three address bytes, flash at 0x60000000. */
  'imxrt': { blockSize: 1024, addrBytes: 3, flashBase: 0x60000000 },
  /* Teensy 3.5/3.6: 1024 byte blocks, three address bytes, flash at 0. */
  'k66': { blockSize: 1024, addrBytes: 3, flashBase: 0 },
  /* Teensy 3.2: 1024 byte blocks, two address bytes. */
  'k20': { blockSize: 1024, addrBytes: 2, flashBase: 0 },
};

export function targetFor(boardId: string): FlashTarget {
  if (boardId === 'teensy40' || boardId === 'teensy41' || boardId === 'teensymm') return TARGETS.imxrt;
  if (boardId === 'teensy35' || boardId === 'teensy36') return TARGETS.k66;
  return TARGETS.k20;
}

export function hidAvailable(): boolean {
  return typeof navigator !== 'undefined' && 'hid' in navigator;
}

/**
 * Intel HEX to a flat image.
 *
 * Handles record types 00 (data), 01 (end), 02 (segment) and 04 (extended
 * linear), which is everything a Teensy build emits. Throws on a bad
 * checksum rather than flashing something malformed.
 */
export function parseIntelHex(text: string): { data: Uint8Array; start: number } {
  let upper = 0;
  let min = Infinity;
  let max = 0;
  const chunks: Array<{ addr: number; bytes: Uint8Array }> = [];

  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line[0] !== ':') continue;
    const bytes = new Uint8Array((line.length - 1) / 2);
    for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(line.substr(1 + i * 2, 2), 16);
    let sum = 0;
    for (const b of bytes) sum = (sum + b) & 0xff;
    if (sum !== 0) throw new Error(`bad checksum in ${line.slice(0, 12)}`);

    const len = bytes[0];
    const addr = (bytes[1] << 8) | bytes[2];
    const type = bytes[3];
    const payload = bytes.subarray(4, 4 + len);

    if (type === 0x00) {
      const abs = upper + addr;
      chunks.push({ addr: abs, bytes: payload.slice() });
      if (abs < min) min = abs;
      if (abs + len > max) max = abs + len;
    } else if (type === 0x04) {
      upper = ((payload[0] << 8) | payload[1]) << 16;
    } else if (type === 0x02) {
      upper = ((payload[0] << 8) | payload[1]) << 4;
    } else if (type === 0x01) {
      break;
    }
  }
  if (!chunks.length) throw new Error('no data records in hex file');

  const start = min;
  const image = new Uint8Array(max - start).fill(0xff);
  for (const c of chunks) image.set(c.bytes, c.addr - start);
  return { data: image, start };
}

export type Progress = (done: number, total: number, note: string) => void;

/**
 * Write an image to a Teensy already sitting in HalfKay.
 *
 * The board must be in bootloader mode before this is called: press the
 * program button. There is no reliable hands-off path for a board that is
 * not already running firmware that offers one.
 */
export async function flash(
  device: HIDDevice,
  image: Uint8Array,
  target: FlashTarget,
  onProgress: Progress,
): Promise<void> {
  const { blockSize, addrBytes } = target;
  const reportLen = blockSize + 64;
  const blocks = Math.ceil(image.length / blockSize);

  for (let b = 0; b < blocks; b++) {
    const addr = b * blockSize;
    const slice = image.subarray(addr, addr + blockSize);

    /* Block zero always goes, because writing it is what erases the chip.
     * After that an all-erased block is already correct, so skipping it
     * saves real time on a mostly empty flash. */
    if (b > 0 && slice.every((v) => v === 0xff)) continue;

    const report = new Uint8Array(reportLen);
    for (let i = 0; i < addrBytes; i++) report[i] = (addr >> (8 * i)) & 0xff;
    report.set(slice, 64);

    await device.sendReport(0, report);
    onProgress(b + 1, blocks, b === 0 ? 'erasing and writing block 0' : `writing block ${b + 1}`);

    /* The erase that block zero triggers takes far longer than a write. */
    await sleep(b === 0 ? 1500 : 3);
  }

  /* Reboot: an otherwise empty report with 0xFF in the address bytes. The
   * device detaches while this is in flight, so a rejection here is the
   * expected outcome rather than a failure. */
  const reboot = new Uint8Array(reportLen);
  reboot[0] = reboot[1] = reboot[2] = 0xff;
  try {
    await device.sendReport(0, reboot);
  } catch {
    /* detached mid-transfer, which is what success looks like */
  }
  onProgress(blocks, blocks, 'rebooting');
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** The command that is known to work, for the panel to print. */
export function loaderCommand(boardId: string, hexName: string): string {
  const mcu: Record<string, string> = {
    teensy41: 'TEENSY41',
    teensy40: 'TEENSY40',
    teensymm: 'TEENSY_MICROMOD',
    teensy36: 'TEENSY36',
    teensy35: 'TEENSY35',
    teensy32: 'TEENSY32',
  };
  return `teensy_loader_cli --mcu=${mcu[boardId] ?? 'TEENSY41'} -w -v ${hexName}`;
}
