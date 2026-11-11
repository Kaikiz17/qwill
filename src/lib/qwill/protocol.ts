import { b64ToBytes, bytesToB64, canonical, fromUtf8, randomId, utf8 } from "./bytes";
import {
  decapsulate,
  decrypt,
  encapsulate,
  encrypt,
  generateDsa,
  generateEcdsa,
  generateKem,
  signDsa,
  signEcdsa,
  verifyDsa,
  verifyEcdsa,
  type Box,
  type EcdsaPublic,
  type EcdsaSecret,
} from "./crypto";
import { combineShares, splitSecret } from "./shamir";

export const INTERVALS = [
  { id: "7", label: "7 days", ms: 7 * 86_400_000 },
  { id: "30", label: "30 days", ms: 30 * 86_400_000 },
  { id: "90", label: "90 days", ms: 90 * 86_400_000 },
] as const;

export type IntervalId = (typeof INTERVALS)[number]["id"];

export type Verdict = {
  ok: boolean;
  /** Ordinary signature verified, and QWILL still refused. */
  oldLockOpens: boolean;
  title: string;
  detail: string;
};

export type HeirPublic = {
  id: string;
  name: string;
  kem: string;
  dsa: string;
  ecdsa: EcdsaPublic;
};

export type SealedPacket = {
  v: 1;
  kind: "qwill";
  id: string;
  title: string;
  createdAt: number;
  intervalMs: number;
  threshold: number;
  founder: { dsa: string; ecdsa: EcdsaPublic };
  heirs: HeirPublic[];
  beats: { at: number; sig: string }[];
  veto: { at: number; sig: string } | null;
  payload: Box;
  shares: { heirId: string; kemCt: string; iv: string; ct: string }[];
};

export type ClaimKeyFile = {
  v: 1;
  kind: "qwill-claim";
  willId: string;
  heirId: string;
  name: string;
  kemSk: string;
  dsaSk: string;
  ecdsa: EcdsaSecret;
};

export type FounderKeyFile = {
  v: 1;
  kind: "qwill-founder";
  willId: string;
  dsaSk: string;
  kemSk: string;
  ecdsa: EcdsaSecret;
};

export type StoredWill = {
  packet: SealedPacket;
  founder: FounderKeyFile;
  founderRead: { kemCt: string; iv: string; ct: string } | null;
  claimKeys: ClaimKeyFile[] | null;
  notes: { at: number; text: string }[];
};

export type WillStatus = "alive" | "claimable" | "revoked";

export type PlainWill = { letter: string; secret: string };

const refused = (detail: string): Verdict => ({
  ok: false,
  oldLockOpens: true,
  title: "Stays shut",
  detail,
});

function beatMessage(willId: string, at: number): Uint8Array {
  return canonical({ action: "beat", at: String(at), v: "1", will: willId });
}

function vetoMessage(willId: string, at: number): Uint8Array {
  return canonical({ action: "veto", at: String(at), v: "1", will: willId });
}

function claimMessage(willId: string, heirId: string, at: number): Uint8Array {
  return canonical({ action: "claim", at: String(at), heir: heirId, v: "1", will: willId });
}

export function lastBeat(packet: SealedPacket): number {
  return packet.beats.reduce((max, beat) => Math.max(max, beat.at), packet.createdAt);
}

export function deadline(packet: SealedPacket): number {
  return lastBeat(packet) + packet.intervalMs;
}

export function willStatus(packet: SealedPacket, now: number): WillStatus {
  if (packet.veto) return "revoked";
  if (now < deadline(packet)) return "alive";
  return "claimable";
}

export function statusLabel(status: WillStatus): string {
  if (status === "alive") return "Alive";
  if (status === "claimable") return "Waiting on heirs";
  return "Cancelled";
}

function note(will: StoredWill, at: number, text: string): StoredWill {
  return { ...will, notes: [...will.notes, { at, text }] };
}

export async function sealWill(input: {
  title: string;
  letter: string;
  secret: string;
  heirNames: string[];
  threshold: number;
  intervalMs: number;
  keepClaimKeys: boolean;
  now: number;
}): Promise<{ will: StoredWill; claimKeys: ClaimKeyFile[] }> {
  const names = input.heirNames.map((name) => name.trim());
  if (names.length < 2 || names.length > 5) {
    throw new Error("Name between two and five heirs.");
  }
  if (input.threshold < 2 || input.threshold > names.length) {
    throw new Error("At least two heirs have to show up, and not more than you named.");
  }
  if (new Set(names.map((name) => name.toLowerCase())).size !== names.length) {
    throw new Error("Each heir needs their own name.");
  }

  const id = randomId();
  const founderKem = generateKem();
  const founderDsa = generateDsa();
  const founderEcdsa = await generateEcdsa();
  const dataKey = crypto.getRandomValues(new Uint8Array(32));
  const payload = await encrypt(dataKey, utf8(JSON.stringify({ letter: input.letter, secret: input.secret } satisfies PlainWill)));
  const shares = splitSecret(dataKey, names.length, input.threshold);

  const heirs: HeirPublic[] = [];
  const claimKeys: ClaimKeyFile[] = [];
  const wrapped: SealedPacket["shares"] = [];

  for (let i = 0; i < names.length; i++) {
    const heirId = randomId();
    const kem = generateKem();
    const dsa = generateDsa();
    const ecdsa = await generateEcdsa();
    const enc = encapsulate(kem.publicKey);
    const box = await encrypt(enc.sharedSecret, shares[i]!);
    heirs.push({
      id: heirId,
      name: names[i]!,
      kem: kem.publicKey,
      dsa: dsa.publicKey,
      ecdsa: ecdsa.publicKey,
    });
    claimKeys.push({
      v: 1,
      kind: "qwill-claim",
      willId: id,
      heirId,
      name: names[i]!,
      kemSk: kem.secretKey,
      dsaSk: dsa.secretKey,
      ecdsa: ecdsa.secretKey,
    });
    wrapped.push({ heirId, kemCt: enc.cipherText, iv: box.iv, ct: box.ct });
  }

  const founderReadEnc = encapsulate(founderKem.publicKey);
  const founderReadBox = await encrypt(founderReadEnc.sharedSecret, dataKey);
  const beatSig = signDsa(founderDsa.secretKey, beatMessage(id, input.now));

  const packet: SealedPacket = {
    v: 1,
    kind: "qwill",
    id,
    title: input.title.trim(),
    createdAt: input.now,
    intervalMs: input.intervalMs,
    threshold: input.threshold,
    founder: { dsa: founderDsa.publicKey, ecdsa: founderEcdsa.publicKey },
    heirs,
    beats: [{ at: input.now, sig: beatSig }],
    veto: null,
    payload,
    shares: wrapped,
  };

  const founder: FounderKeyFile = {
    v: 1,
    kind: "qwill-founder",
    willId: id,
    dsaSk: founderDsa.secretKey,
    kemSk: founderKem.secretKey,
    ecdsa: founderEcdsa.secretKey,
  };

  const will: StoredWill = {
    packet,
    founder,
    founderRead: { kemCt: founderReadEnc.cipherText, ...founderReadBox },
    claimKeys: input.keepClaimKeys ? claimKeys : null,
    notes: [{ at: input.now, text: "Sealed on this device." }],
  };

  if (!verifyDsa(packet.founder.dsa, beatMessage(id, input.now), beatSig)) {
    throw new Error("The first check-in did not verify. Nothing was saved.");
  }

  return { will, claimKeys };
}

export async function checkIn(
  will: StoredWill,
  now: number,
  kind: "pq" | "classical",
): Promise<{ will: StoredWill; verdict: Verdict }> {
  if (will.packet.veto) {
    return {
      will,
      verdict: {
        ok: false,
        oldLockOpens: false,
        title: "Already cancelled",
        detail: "A check-in cannot bring a cancelled will back.",
      },
    };
  }

  const message = beatMessage(will.packet.id, now);
  if (kind === "classical") {
    const sig = await signEcdsa(will.founder.ecdsa, message);
    const valid = await verifyEcdsa(will.packet.founder.ecdsa, message, sig);
    if (!valid) {
      return {
        will,
        verdict: {
          ok: false,
          oldLockOpens: false,
          title: "Not a real signature",
          detail: "That ordinary signature does not verify. Nothing changed.",
        },
      };
    }
    return {
      will: note(will, now, "An ordinary key tried to check in. The signature was real. The deadline stayed put."),
      verdict: refused("The ordinary signature is real. It did not move the deadline. Only the quantum-safe key can check in."),
    };
  }

  const sig = signDsa(will.founder.dsaSk, message);
  if (!verifyDsa(will.packet.founder.dsa, message, sig)) {
    return {
      will,
      verdict: {
        ok: false,
        oldLockOpens: false,
        title: "Check-in refused",
        detail: "The quantum-safe signature does not verify.",
      },
    };
  }

  const packet: SealedPacket = { ...will.packet, beats: [...will.packet.beats, { at: now, sig }] };
  const wasQuiet = willStatus(will.packet, now) === "claimable";
  return {
    will: {
      ...note(
        { ...will, packet },
        now,
        wasQuiet ? "Checked in after the window had passed. The will is sealed again." : "Checked in.",
      ),
    },
    verdict: {
      ok: true,
      oldLockOpens: false,
      title: wasQuiet ? "Sealed again" : "Checked in",
      detail: wasQuiet
        ? "You were quiet long enough for heirs to open this. The check-in closed that window."
        : "The next silence starts from this check-in.",
    },
  };
}

export async function cancelWill(
  will: StoredWill,
  now: number,
  kind: "pq" | "classical",
): Promise<{ will: StoredWill; verdict: Verdict }> {
  if (will.packet.veto) {
    return {
      will,
      verdict: {
        ok: false,
        oldLockOpens: false,
        title: "Already cancelled",
        detail: "This will is already cancelled.",
      },
    };
  }

  const message = vetoMessage(will.packet.id, now);
  if (kind === "classical") {
    const sig = await signEcdsa(will.founder.ecdsa, message);
    const valid = await verifyEcdsa(will.packet.founder.ecdsa, message, sig);
    if (!valid) {
      return {
        will,
        verdict: {
          ok: false,
          oldLockOpens: false,
          title: "Not a real signature",
          detail: "That ordinary signature does not verify. The will is unchanged.",
        },
      };
    }
    return {
      will: note(will, now, "An ordinary key tried to cancel the will. The signature was real. The will stands."),
      verdict: refused("The ordinary signature is real. It did not cancel the will."),
    };
  }

  const sig = signDsa(will.founder.dsaSk, message);
  if (!verifyDsa(will.packet.founder.dsa, message, sig)) {
    return {
      will,
      verdict: {
        ok: false,
        oldLockOpens: false,
        title: "Cancel refused",
        detail: "The quantum-safe signature does not verify. The will stands.",
      },
    };
  }

  const packet: SealedPacket = { ...will.packet, veto: { at: now, sig } };
  return {
    will: note({ ...will, packet }, now, "Cancelled. This will cannot open."),
    verdict: {
      ok: true,
      oldLockOpens: false,
      title: "Cancelled",
      detail: "The will is closed for good. Heirs cannot open it.",
    },
  };
}

export async function presentShare(
  packet: SealedPacket,
  claim: ClaimKeyFile,
  now: number,
  kind: "pq" | "classical",
): Promise<{ verdict: Verdict; share?: Uint8Array }> {
  if (claim.kind !== "qwill-claim" || claim.willId !== packet.id) {
    return {
      verdict: {
        ok: false,
        oldLockOpens: false,
        title: "Wrong key",
        detail: "This claim key is for a different will.",
      },
    };
  }
  const heir = packet.heirs.find((item) => item.id === claim.heirId);
  if (!heir) {
    return {
      verdict: {
        ok: false,
        oldLockOpens: false,
        title: "Unknown heir",
        detail: "This key is not one of the heirs on the will.",
      },
    };
  }

  const status = willStatus(packet, now);
  if (status === "revoked") {
    return {
      verdict: {
        ok: false,
        oldLockOpens: false,
        title: "Cancelled",
        detail: "This will was cancelled. It will not open.",
      },
    };
  }
  if (status === "alive") {
    return {
      verdict: {
        ok: false,
        oldLockOpens: false,
        title: "Still alive",
        detail: "The founder is still checking in. A share stays sealed until a window passes.",
      },
    };
  }

  const message = claimMessage(packet.id, heir.id, now);
  if (kind === "classical") {
    const sig = await signEcdsa(claim.ecdsa, message);
    const valid = await verifyEcdsa(heir.ecdsa, message, sig);
    if (!valid) {
      return {
        verdict: {
          ok: false,
          oldLockOpens: false,
          title: "Not a real signature",
          detail: "That ordinary signature does not verify. Nothing was released.",
        },
      };
    }
    return {
      verdict: refused("The ordinary signature is real. No share was released."),
    };
  }

  const sig = signDsa(claim.dsaSk, message);
  if (!verifyDsa(heir.dsa, message, sig)) {
    return {
      verdict: {
        ok: false,
        oldLockOpens: false,
        title: "Claim refused",
        detail: "The quantum-safe signature does not verify. Nothing was released.",
      },
    };
  }

  const row = packet.shares.find((item) => item.heirId === heir.id);
  if (!row) {
    return {
      verdict: {
        ok: false,
        oldLockOpens: false,
        title: "Missing share",
        detail: "This will file has no share for that heir.",
      },
    };
  }

  try {
    const shared = decapsulate(row.kemCt, claim.kemSk);
    const share = await decrypt(shared, row);
    return {
      share,
      verdict: {
        ok: true,
        oldLockOpens: false,
        title: `${heir.name} is here`,
        detail: "Their share is in the room. It is not enough on its own.",
      },
    };
  } catch {
    return {
      verdict: {
        ok: false,
        oldLockOpens: false,
        title: "Could not unseal",
        detail: "This key does not open that heir's share.",
      },
    };
  }
}

export async function reveal(packet: SealedPacket, shares: Uint8Array[]): Promise<PlainWill> {
  const dataKey = combineShares(shares, packet.threshold);
  const plain = await decrypt(dataKey, packet.payload);
  const parsed = JSON.parse(fromUtf8(plain)) as PlainWill;
  if (typeof parsed.letter !== "string" || typeof parsed.secret !== "string") {
    throw new Error("The opened will is damaged.");
  }
  return parsed;
}

export async function readAsFounder(will: StoredWill): Promise<PlainWill> {
  if (!will.founderRead) {
    throw new Error("This device can check in, but the letter was not sealed to it. Open it with the heirs, or use the device that wrote it.");
  }
  const shared = decapsulate(will.founderRead.kemCt, will.founder.kemSk);
  const dataKey = await decrypt(shared, will.founderRead);
  const plain = await decrypt(dataKey, will.packet.payload);
  return JSON.parse(fromUtf8(plain)) as PlainWill;
}

export function isPacket(value: unknown): value is SealedPacket {
  if (!value || typeof value !== "object") return false;
  const packet = value as SealedPacket;
  return (
    packet.v === 1 &&
    packet.kind === "qwill" &&
    typeof packet.id === "string" &&
    typeof packet.title === "string" &&
    Array.isArray(packet.heirs) &&
    Array.isArray(packet.beats) &&
    Array.isArray(packet.shares)
  );
}

export function isClaimKey(value: unknown): value is ClaimKeyFile {
  if (!value || typeof value !== "object") return false;
  const key = value as ClaimKeyFile;
  return key.v === 1 && key.kind === "qwill-claim" && typeof key.heirId === "string" && typeof key.dsaSk === "string";
}

export function isFounderKey(value: unknown): value is FounderKeyFile {
  if (!value || typeof value !== "object") return false;
  const key = value as FounderKeyFile;
  return key.v === 1 && key.kind === "qwill-founder" && typeof key.dsaSk === "string" && typeof key.kemSk === "string";
}

export function parseJson(text: string): unknown {
  return JSON.parse(text);
}

export async function restoreWill(
  packet: SealedPacket,
  founder: FounderKeyFile,
  now: number,
  existing?: StoredWill,
): Promise<StoredWill> {
  const key = existing?.founder ?? founder;
  if (key.willId !== packet.id && founder.willId !== packet.id) {
    throw new Error("That founder key is for a different will.");
  }
  const signingKey = founder.willId === packet.id ? founder : key;
  const probe = signDsa(signingKey.dsaSk, beatMessage(packet.id, packet.createdAt));
  if (!verifyDsa(packet.founder.dsa, beatMessage(packet.id, packet.createdAt), probe)) {
    throw new Error("This founder key does not match the will.");
  }
  for (const beat of packet.beats) {
    if (!verifyDsa(packet.founder.dsa, beatMessage(packet.id, beat.at), beat.sig)) {
      throw new Error("A check-in on this file does not verify. Refusing to restore it.");
    }
  }
  if (packet.veto && !verifyDsa(packet.founder.dsa, vetoMessage(packet.id, packet.veto.at), packet.veto.sig)) {
    throw new Error("The cancellation on this file does not verify.");
  }
  return {
    packet,
    founder: signingKey,
    founderRead: existing?.founderRead ?? null,
    claimKeys: existing?.claimKeys ?? null,
    notes: [
      ...(existing?.notes ?? []),
      {
        at: now,
        text: existing
          ? "Imported a sealed file."
          : "Restored from a founder key. Check-ins work here. The letter stays sealed until heirs open it.",
      },
    ],
  };
}

export function packetFileName(title: string): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40);
  return `${slug || "will"}.qwill.json`;
}

export { bytesToB64, b64ToBytes };
