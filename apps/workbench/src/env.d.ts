/*
 * Ambient types the app needs and the toolchain does not supply.
 *
 * `?raw` imports: vite turns these into string modules at build time. Vite
 * ships a declaration for this in vite/client, but the app's tsconfig does
 * not pull vite's types in, and adding them would drag in a lot more than
 * this one thing.
 *
 * WebHID: no lib.dom in TypeScript 5.6 declares it, and @types/w3c-web-hid
 * would be a dependency for four members. Only what src/lib/sim/flash.ts
 * actually calls is declared, so an unimplemented member cannot be used by
 * accident.
 */

declare module '*?raw' {
  const content: string;
  export default content;
}

interface HIDDevice {
  readonly opened: boolean;
  open(): Promise<void>;
  close(): Promise<void>;
  sendReport(reportId: number, data: BufferSource): Promise<void>;
}

interface HIDDeviceFilter {
  vendorId?: number;
  productId?: number;
}

interface HID {
  requestDevice(options: { filters: HIDDeviceFilter[] }): Promise<HIDDevice[]>;
}

interface Navigator {
  readonly hid: HID;
}
