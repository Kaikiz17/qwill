const POLY = 0x11b;

function gfMul(a: number, b: number): number {
  let p = 0;
  let x = a;
  let y = b;
  for (let i = 0; i < 8; i++) {
    if (y & 1) p ^= x;
    x <<= 1;
    if (x & 0x100) x ^= POLY;
    y >>= 1;
  }
  return p & 0xff;
}

function gfInv(a: number): number {
  if (a === 0) throw new Error("Division by zero in the share math.");
  let result = 1;
  let base = a;
  let exp = 254;
  while (exp > 0) {
    if (exp & 1) result = gfMul(result, base);
    base = gfMul(base, base);
    exp >>= 1;
  }
  return result;
}

function nonZero(): number {
  const buf = new Uint8Array(1);
  do crypto.getRandomValues(buf);
  while (buf[0] === 0);
  return buf[0]!;
}

function evalAt(coeffs: number[], x: number): number {
  let y = 0;
  let xp = 1;
  for (const coeff of coeffs) {
    y ^= gfMul(coeff, xp);
    xp = gfMul(xp, x);
  }
  return y;
}

/** Reconstruct the secret byte at x = 0. In GF(256), subtraction is XOR. */
function atZero(points: { x: number; y: number }[]): number {
  let secret = 0;
  for (let i = 0; i < points.length; i++) {
    let basis = 1;
    for (let j = 0; j < points.length; j++) {
      if (i === j) continue;
      const den = points[i]!.x ^ points[j]!.x;
      basis = gfMul(basis, gfMul(points[j]!.x, gfInv(den)));
    }
    secret ^= gfMul(points[i]!.y, basis);
  }
  return secret;
}

export type Share = Uint8Array;

export function splitSecret(secret: Uint8Array, count: number, threshold: number): Share[] {
  if (threshold < 2 || threshold > count) {
    throw new Error("A will needs at least two shares, and not more shares than heirs.");
  }
  const shares: Share[] = Array.from({ length: count }, (_, index) => {
    const share = new Uint8Array(secret.length + 1);
    share[0] = index + 1;
    return share;
  });

  for (let byte = 0; byte < secret.length; byte++) {
    const coeffs = [secret[byte]!];
    for (let i = 1; i < threshold - 1; i++) {
      const rand = new Uint8Array(1);
      crypto.getRandomValues(rand);
      coeffs.push(rand[0]!);
    }
    coeffs.push(nonZero());
    for (let index = 0; index < count; index++) {
      shares[index]![byte + 1] = evalAt(coeffs, index + 1);
    }
  }
  return shares;
}

export function combineShares(shares: Share[], threshold: number): Uint8Array {
  const unique = new Map<number, Share>();
  for (const share of shares) {
    if (share.length < 2) throw new Error("A share is damaged.");
    unique.set(share[0]!, share);
  }
  const chosen = [...unique.values()].slice(0, threshold);
  if (chosen.length < threshold) {
    throw new Error("Not enough different shares to open this.");
  }
  const length = chosen[0]!.length;
  const secret = new Uint8Array(length - 1);
  for (let byte = 0; byte < secret.length; byte++) {
    secret[byte] = atZero(
      chosen.map((share) => {
        if (share.length !== length) throw new Error("Shares do not belong together.");
        return { x: share[0]!, y: share[byte + 1]! };
      }),
    );
  }
  return secret;
}
