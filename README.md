# QWILL

A will that still holds if today's signatures break.

The letter is locked with post-quantum encryption. Any two of the named heirs can open it together. One cannot. Check-in, cancel, and a claim each need an ML-DSA-87 signature. The contract sends that signature to the QoreChain testnet checker at `0x0000000000000000000000000000000000000a01`. An ordinary signature is refused.

The locked letter is stored on the contract. The founder's key is stored beside it, locked with a password. Connecting the same QoreX wallet on a new phone loads the letter. The password opens it. Heir keys are handed out by the founder and are not in the wallet.

## Chain

Diana testnet, chain id 9800.

The first registry, deployed before the letter was stored on the contract:

`0x9aE7641cc986d5e4b982ff87de88276FDe448f35`

Record transaction:

`0x9be5a145edadf8b3121b215b2725cfb3d8b6e36bb2bce5ec032a370ff5616570`

That deployment cannot hold the letter. Deploy the contract in this repository and record again.

## Tests

```bash
npm test --prefix contracts
```

The tests install a stand-in checker at the same precompile address. The real checker exists only on the testnet.

## Window

QoreX does not let a website send `MsgOpenEVMWindow`. Open the EVM access window in the QoreX app. The wallet has no screen for a window limited to one contract.

## AI

See [AI_USAGE.md](AI_USAGE.md). Contract reviews go through QCAI. See [audit/QCAI.md](audit/QCAI.md).
