import { ml_dsa87 } from "@noble/post-quantum/ml-dsa.js";
import { ml_kem1024 } from "@noble/post-quantum/ml-kem.js";
import { b64ToBytes, bytesToB64, exact } from "./bytes";

const ECDSA = { name: "ECDSA", namedCurve: "P-256" } as const;

export type EcdsaSecret = JsonWebKey;
export type EcdsaPublic = JsonWebKey;

export type KemPair = { publicKey: string; secretKey: string };
export type DsaPair = { publicKey: string; secretKey: string };
export type EcdsaPair = { publicKey: EcdsaPublic; secretKey: EcdsaSecret };

export function generateKem(): KemPair {
  const pair = ml_kem1024.keygen();
  return { publicKey: bytesToB64(pair.publicKey), secretKey: bytesToB64(pair.secretKey) };
}

export function generateDsa(): DsaPair {
  const pair = ml_dsa87.keygen();
  return { publicKey: bytesToB64(pair.publicKey), secretKey: bytesToB64(pair.secretKey) };
}

export async function generateEcdsa(): Promise<EcdsaPair> {
  const pair = await crypto.subtle.generateKey(ECDSA, true, ["sign", "verify"]);
  const publicKey = await crypto.subtle.exportKey("jwk", pair.publicKey);
  const secretKey = await crypto.subtle.exportKey("jwk", pair.privateKey);
  return { publicKey, secretKey };
}

export function dsaPublic(secretKey: string): Uint8Array {
  return ml_dsa87.getPublicKey(b64ToBytes(secretKey));
}

export function signDsa(secretKey: string, message: Uint8Array): string {
  const sig = ml_dsa87.sign(message, b64ToBytes(secretKey));
  return bytesToB64(sig);
}

export function verifyDsa(publicKey: string, message: Uint8Array, signature: string): boolean {
  try {
    return ml_dsa87.verify(b64ToBytes(signature), message, b64ToBytes(publicKey));
  } catch {
    return false;
  }
}

export async function signEcdsa(secretKey: EcdsaSecret, message: Uint8Array): Promise<string> {
  const key = await crypto.subtle.importKey("jwk", secretKey, ECDSA, false, ["sign"]);
  const sig = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, exact(message));
  return bytesToB64(new Uint8Array(sig));
}

export async function verifyEcdsa(
  publicKey: EcdsaPublic,
  message: Uint8Array,
  signature: string,
): Promise<boolean> {
  try {
    const key = await crypto.subtle.importKey("jwk", publicKey, ECDSA, false, ["verify"]);
    return await crypto.subtle.verify(
      { name: "ECDSA", hash: "SHA-256" },
      key,
      exact(b64ToBytes(signature)),
      exact(message),
    );
  } catch {
    return false;
  }
}

export type Box = { iv: string; ct: string };

export async function encrypt(key: Uint8Array, plain: Uint8Array): Promise<Box> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cryptoKey = await crypto.subtle.importKey("raw", exact(key), "AES-GCM", false, ["encrypt"]);
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv: exact(iv) }, cryptoKey, exact(plain));
  return { iv: bytesToB64(iv), ct: bytesToB64(new Uint8Array(ct)) };
}

export async function decrypt(key: Uint8Array, box: Box): Promise<Uint8Array> {
  const cryptoKey = await crypto.subtle.importKey("raw", exact(key), "AES-GCM", false, ["decrypt"]);
  const plain = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: exact(b64ToBytes(box.iv)) },
    cryptoKey,
    exact(b64ToBytes(box.ct)),
  );
  return new Uint8Array(plain);
}

export async function lockWithPassword(password: string, plain: Uint8Array): Promise<Uint8Array> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await passwordKey(password, salt);
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv: exact(iv) }, key, exact(plain)));
  const out = new Uint8Array(28 + ct.length);
  out.set(salt, 0);
  out.set(iv, 16);
  out.set(ct, 28);
  return out;
}

export async function openWithPassword(password: string, blob: Uint8Array): Promise<Uint8Array> {
  if (blob.length < 29) throw new Error("That password does not open this will.");
  const salt = blob.slice(0, 16);
  const iv = blob.slice(16, 28);
  const ct = blob.slice(28);
  const key = await passwordKey(password, salt);
  try {
    const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: exact(iv) }, key, exact(ct));
    return new Uint8Array(plain);
  } catch {
    throw new Error("That password does not open this will.");
  }
}

async function passwordKey(password: string, salt: Uint8Array): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey("raw", exact(new TextEncoder().encode(password)), "PBKDF2", false, [
    "deriveKey",
  ]);
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt: exact(salt), iterations: 100_000, hash: "SHA-256" },
    base,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

export function encapsulate(publicKey: string): { cipherText: string; sharedSecret: Uint8Array } {
  const enc = ml_kem1024.encapsulate(b64ToBytes(publicKey));
  return { cipherText: bytesToB64(enc.cipherText), sharedSecret: enc.sharedSecret };
}

export function decapsulate(cipherText: string, secretKey: string): Uint8Array {
  return ml_kem1024.decapsulate(b64ToBytes(cipherText), b64ToBytes(secretKey));
}
