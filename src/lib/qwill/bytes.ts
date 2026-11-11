export function bytesToB64(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]!);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

export function b64ToBytes(value: string): Uint8Array {
  const pad = value.length % 4 === 0 ? "" : "=".repeat(4 - (value.length % 4));
  const bin = atob(value.replace(/-/g, "+").replace(/_/g, "/") + pad);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function utf8(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}

export function fromUtf8(bytes: Uint8Array): string {
  return new TextDecoder().decode(bytes);
}

/** A fresh copy, so WebCrypto never sees a shared ArrayBuffer view. */
export function exact(bytes: Uint8Array): Uint8Array<ArrayBuffer> {
  return new Uint8Array(bytes);
}

export function canonical(fields: Record<string, string>): Uint8Array {
  const keys = Object.keys(fields).sort();
  return utf8(keys.map((key) => `${key}=${fields[key]}`).join("\n"));
}

export function randomId(): string {
  return crypto.randomUUID();
}
