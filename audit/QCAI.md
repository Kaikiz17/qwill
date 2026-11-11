# QCAI audit

Status: not run.

The bounty asks for a two-stage QCAI audit. QCAI is QoreChain's contract reviewer. There is no public API for it in the docs used to build this, so a report written here would be invented. Do not fill the stage files until QCAI answers.

## Stage 1

Paste `contracts/src/QwillRegistry.sol` into QCAI Advanced and ask for a contract review. Save the answer as `audit/qcai-stage-1.md`.

Ask it to look at:

- whether check-in, cancel, and claim can succeed without `pqcVerify`
- whether a signature over a different message can be replayed
- whether one heir can mark the will opened
- whether a founder check-in clears a finished claim
- whether the signed bytes can be made to mean two different things

## Stage 2

Fix whatever stage 1 reports, if it is real. Paste the updated contract and stage 1's findings. Save the answer as `audit/qcai-stage-2.md`.

The Hardhat tests are the local stand-in. They are not the QCAI audit.
