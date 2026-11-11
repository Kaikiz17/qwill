# AI usage

QWILL was built with Grok, an AI coding agent, in one working session with the person who owns the product. This file is the record the Best AI-Native award asks for: what the agent generated, and what the human decided.

## What the human decided

- The product is a will, not a vault, a messenger, or a token.
- The letter is stored on the contract already locked. The founder key is stored beside it, locked with a password. Heir keys stay with the heirs. Connecting the same QoreX wallet loads the letter. The password opens it.
- Heirs open it together. The default is two of the people named.
- A stolen ordinary key must be shown failing, next to a lock that really opens.
- The project enters the post-quantum dApp bounty. One bounty only.
- The human installs QoreX, claims testnet coins, and signs. The agent cannot.

## What the agent generated

- The browser will: ML-KEM-1024 encryption, ML-DSA-87 signatures, Shamir sharing, check-in, cancel, rehearse, and the side-by-side stolen-key proof.
- `contracts/src/QwillRegistry.sol`. Check-in, cancel, and claim rebuild the signed message and call `pqcVerify` at `0x0000000000000000000000000000000000000a01`. There is no function that skips it.
- Hardhat tests in `contracts/test/QwillRegistry.mjs`. They put a stand-in at that same address, because the real ML-DSA-87 checker exists only on the QoreChain testnet. The tests check that the browser and the contract sign the same bytes, that a bad signature is refused, and that one heir cannot open the record.
- The QoreX flow on the will page: connect, deploy the registry, then record. Recording sends the locked letter and the password-locked founder key. QoreX refuses `MsgOpenEVMWindow` from a website, so the page does not send it. The window is opened in the QoreX app itself. That window is not limited to one contract, because the wallet has no screen for that.
- This file.

## What was checked

- `npm test --prefix contracts` — the registry tests.
- `node --test scripts/qwill-window-bytes.test.mjs` — the scoped-window bytes.
- The earlier will self-check: seal, stolen ordinary key refused, two heirs open the letter, one heir does not.
- A registry was deployed and one will was recorded on Diana from the owner's QoreX wallet. That first contract does not hold the letter. The letter-storage contract has to be deployed again.
- The agent did not open a scoped window. QoreX rejects that message when a website sends it.

## Still a human step

1. Publish the app, deploy the new registry from QoreX, and record a will with a password.
2. Paste `contracts/src/QwillRegistry.sol` into QCAI twice. See `audit/QCAI.md`. Do not write the reports before QCAI does.
