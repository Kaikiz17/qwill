/**
 * Protobuf bytes for MsgOpenEVMWindow, field for field with the QoreChain SDK.
 * QoreX wants these bytes. It adds the ML-DSA-87 half. This file cannot.
 *
 * 1 sender string, 2 blocks uint64, 3 maxTxs uint64,
 * 4 maxValue string, 5 nativeOnly bool, 6 allowedTargets string (repeated).
 */

/**
 * @param {bigint | number | string} value
 * @returns {number[]}
 */
function varint(value) {
  const out = [];
  let rest = BigInt(value);
  while (rest > 127n) {
    out.push(Number((rest & 127n) | 128n));
    rest >>= 7n;
  }
  out.push(Number(rest));
  return out;
}

/**
 * @param {number} field
 * @param {number} wire
 * @returns {number[]}
 */
function tag(field, wire) {
  return varint((BigInt(field) << 3n) | BigInt(wire));
}

/**
 * @param {number} field
 * @param {string} value
 * @returns {number[]}
 */
function textField(field, value) {
  const raw = new TextEncoder().encode(value);
  return [...tag(field, 2), ...varint(raw.length), ...raw];
}

/**
 * @param {number} field
 * @param {bigint | number | string} value
 * @returns {number[]}
 */
function uintField(field, value) {
  return [...tag(field, 0), ...varint(value)];
}

/**
 * @param {{ sender: string, blocks: string, maxTxs: string, maxValue: string, nativeOnly: boolean, allowedTargets: string[] }} value
 * @returns {Uint8Array}
 */
export function encodeOpenEvmWindow(value) {
  const bytes = [
    ...textField(1, value.sender),
    ...(value.blocks === "0" ? [] : uintField(2, value.blocks)),
    ...(value.maxTxs === "0" ? [] : uintField(3, value.maxTxs)),
    ...(value.maxValue === "" ? [] : textField(4, value.maxValue)),
    ...(value.nativeOnly ? [...tag(5, 0), 1] : []),
    ...value.allowedTargets.flatMap((target) => textField(6, target)),
  ];
  return Uint8Array.from(bytes);
}
