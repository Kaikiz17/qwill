import { readAsFounder, cancelWill, checkIn, presentShare, reveal, sealWill, willStatus } from "./protocol";

const now = Date.parse("2026-11-08T12:00:00Z");
const { will, claimKeys } = await sealWill({
  title: "For my sister",
  letter: "The blue notebook is yours.",
  secret: "seed words here",
  heirNames: ["Ada", "Ben", "Cam"],
  threshold: 2,
  intervalMs: 30 * 86_400_000,
  keepClaimKeys: true,
  now,
});

if (willStatus(will.packet, now + 1000) !== "alive") throw new Error("expected alive");

const stolenBeat = await checkIn(will, now + 5000, "classical");
if (stolenBeat.verdict.ok || !stolenBeat.verdict.oldLockOpens) throw new Error("classical beat should fail open");
if (stolenBeat.will.packet.beats.length !== 1) throw new Error("classical beat mutated the will");

const stolenVeto = await cancelWill(will, now + 5000, "classical");
if (stolenVeto.verdict.ok || stolenVeto.will.packet.veto) throw new Error("classical veto");

const quiet = now + will.packet.intervalMs + 10;
if (willStatus(will.packet, quiet) !== "claimable") throw new Error("expected claimable");

const early = await presentShare(will.packet, claimKeys[0]!, now + 1000, "pq");
if (early.share) throw new Error("early share leaked");

const one = await presentShare(will.packet, claimKeys[0]!, quiet, "pq");
if (!one.share) throw new Error("missing first share");
let openedEarly = true;
try {
  await reveal(will.packet, [one.share]);
} catch {
  openedEarly = false;
}
if (openedEarly) throw new Error("one share opened the will");

const classicalClaim = await presentShare(will.packet, claimKeys[1]!, quiet, "classical");
if (classicalClaim.share || !classicalClaim.verdict.oldLockOpens) throw new Error("classical claim");

const two = await presentShare(will.packet, claimKeys[2]!, quiet, "pq");
if (!two.share) throw new Error("missing second share");
const plain = await reveal(will.packet, [one.share, two.share]);
if (plain.letter !== "The blue notebook is yours." || plain.secret !== "seed words here") {
  throw new Error("plaintext mismatch");
}

const other = await presentShare(will.packet, claimKeys[1]!, quiet, "pq");
if (!other.share) throw new Error("missing other share");
const plain2 = await reveal(will.packet, [one.share, other.share]);
if (plain2.secret !== plain.secret) throw new Error("share pairs disagree");

const beat = await checkIn(will, quiet, "pq");
if (!beat.verdict.ok || willStatus(beat.will.packet, quiet) !== "alive") throw new Error("revive failed");

const veto = await cancelWill(beat.will, quiet + 10, "pq");
if (willStatus(veto.will.packet, quiet + 20) !== "revoked") throw new Error("revoke failed");
const after = await presentShare(veto.will.packet, claimKeys[0]!, quiet + 20, "pq");
if (after.share) throw new Error("revoked will released a share");

const read = await readAsFounder(will);
if (read.letter !== plain.letter) throw new Error("founder cannot read");

console.log("qwill ok");
