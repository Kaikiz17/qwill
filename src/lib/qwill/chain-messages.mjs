/** Same bytes the contract rebuilds before it calls pqcVerify. */

import { keccak_256 } from "@noble/hashes/sha3.js";

/**
 * @param {Uint8Array} pubkey
 * @returns {string}
 */
export function keyHashHex(pubkey) {
  const digest = keccak_256(pubkey);
  let hex = "";
  for (const byte of digest) hex += byte.toString(16).padStart(2, "0");
  return hex;
}

/**
 * @param {{ id: string, key: Uint8Array }[]} heirs
 * @returns {string}
 */
export function heirsField(heirs) {
  return heirs.map((heir) => `${heir.id}:${keyHashHex(heir.key)}`).join(",");
}

/**
 * @param {Record<string, string>} fields
 * @returns {Uint8Array}
 */
function canonical(fields) {
  const keys = Object.keys(fields).sort();
  return new TextEncoder().encode(keys.map((key) => `${key}=${fields[key]}`).join("\n"));
}

/**
 * @param {{ willId: string, recordedAt: number, intervalMs: number, threshold: number, heirs: { id: string, key: Uint8Array }[], packet: string, vault: string, parts: string }} input
 * @returns {Uint8Array}
 */
export function sealMessage({ willId, recordedAt, intervalMs, threshold, heirs, packet, vault, parts }) {
  return canonical({
    action: "seal",
    at: String(recordedAt),
    heirs: heirsField(heirs),
    interval: String(intervalMs),
    packet,
    parts,
    threshold: String(threshold),
    v: "1",
    vault,
    will: willId,
  });
}

/**
 * @param {{ willId: string, vault: boolean, index: number, part: string, at: number }} input
 * @returns {Uint8Array}
 */
export function putMessage({ willId, vault, index, part, at }) {
  return canonical({
    action: "put",
    at: String(at),
    index: String(index),
    kind: vault ? "vault" : "letter",
    part,
    v: "1",
    will: willId,
  });
}

/**
 * @param {string} willId
 * @param {number} at
 * @returns {Uint8Array}
 */
export function beatMessage(willId, at) {
  return canonical({ action: "beat", at: String(at), v: "1", will: willId });
}

/**
 * @param {string} willId
 * @param {number} at
 * @returns {Uint8Array}
 */
export function vetoMessage(willId, at) {
  return canonical({ action: "veto", at: String(at), v: "1", will: willId });
}

/**
 * @param {string} willId
 * @param {string} heirId
 * @param {number} at
 * @returns {Uint8Array}
 */
export function claimMessage(willId, heirId, at) {
  return canonical({ action: "claim", at: String(at), heir: heirId, v: "1", will: willId });
}
