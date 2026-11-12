import hre from "hardhat";
import { expect } from "chai";
import {
  beatMessage,
  claimMessage,
  keyHashHex,
  sealMessage,
  putMessage,
  vetoMessage,
} from "../../src/lib/qwill/chain-messages.mjs";

const { ethers, network } = hre;

const PQC = "0x0000000000000000000000000000000000000a01";
const HOUR = 3_600_000;
const PIECE = 12_000;

function chunks(bytes) {
  const raw = ethers.getBytes(bytes);
  const parts = [];
  for (let i = 0; i < raw.length; i += PIECE) parts.push(raw.slice(i, i + PIECE));
  return parts;
}

function partHashes(parts) {
  return parts.map((part) => ethers.keccak256(part));
}

function partsField(letterParts, vaultParts) {
  const hex = (list) => list.map((item) => item.slice(2)).join(",");
  return `${hex(letterParts)}|${hex(vaultParts)}`;
}

async function installMock() {
  const factory = await ethers.getContractFactory("MockQorePQC");
  const mock = await factory.deploy();
  await mock.waitForDeployment();
  const code = await ethers.provider.getCode(await mock.getAddress());
  await network.provider.send("hardhat_setCode", [PQC, code]);
}

function mockSign(pubkey, message) {
  return ethers.keccak256(ethers.concat([pubkey, message]));
}

async function atNextBlock(secondsFromNow) {
  const latest = await ethers.provider.getBlock("latest");
  const next = latest.timestamp + secondsFromNow;
  await network.provider.send("evm_setNextBlockTimestamp", [next]);
  return next * 1000;
}

describe("QwillRegistry", function () {
  this.timeout(120_000);

  /** @type {import('ethers').Contract} */
  let registry;
  let founder;
  let heirs;
  const willId = "11111111-1111-4111-8111-111111111111";
  const letter = ethers.toUtf8Bytes('{"kind":"qwill","title":"For them"}');
  const vault = ethers.toUtf8Bytes("locked-founder-key");

  function bound(body = letter, box = vault) {
    const letterParts = partHashes(chunks(body));
    const vaultParts = partHashes(chunks(box));
    return {
      packet: ethers.keccak256(body).slice(2),
      vault: ethers.keccak256(box).slice(2),
      parts: partsField(letterParts, vaultParts),
      letterParts,
      vaultParts,
    };
  }

  async function storePieces(id, body, box, atStart) {
    let at = atStart;
    const bodies = [
      [false, chunks(body)],
      [true, chunks(box)],
    ];
    for (const [vault, pieces] of bodies) {
      for (let index = 0; index < pieces.length; index += 1) {
        at = await atNextBlock(1);
        const piece = pieces[index];
        const part = ethers.keccak256(piece).slice(2);
        await registry.put(id, vault, index, piece, at, founder, mockSign(founder, putMessage({ willId: id, vault, index, part, at })));
      }
    }
  }

  before(async () => {
    await installMock();
    const factory = await ethers.getContractFactory("QwillRegistry");
    registry = await factory.deploy();
    await registry.waitForDeployment();
    founder = ethers.hexlify(ethers.randomBytes(2592));
    heirs = [
      { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1", key: ethers.hexlify(ethers.randomBytes(2592)) },
      { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2", key: ethers.hexlify(ethers.randomBytes(2592)) },
      { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3", key: ethers.hexlify(ethers.randomBytes(2592)) },
    ];
  });

  function heirArgs() {
    return [heirs.map((heir) => heir.id), heirs.map((heir) => heir.key)];
  }

  async function sealAt(recordedAt) {
    const [ids, keys] = heirArgs();
    const fields = bound();
    const message = sealMessage({
      willId,
      recordedAt,
      intervalMs: HOUR,
      threshold: 2,
      heirs: heirs.map((heir) => ({ id: heir.id, key: ethers.getBytes(heir.key) })),
      packet: fields.packet,
      vault: fields.vault,
      parts: fields.parts,
    });
    await registry.seal(
      willId,
      recordedAt,
      HOUR,
      2,
      ids,
      keys,
      founder,
      mockSign(founder, message),
      ethers.keccak256(letter),
      ethers.keccak256(vault),
      fields.letterParts,
      fields.vaultParts,
    );
    await storePieces(willId, letter, vault, recordedAt);
  }

  it("asks the precompile at 0x…0A01 and has no classical action", async () => {
    expect(await registry.PQC()).to.equal(PQC);
    const writers = registry.interface.fragments
      .filter((fragment) => fragment.type === "function" && !["view", "pure"].includes(fragment.stateMutability))
      .map((fragment) => fragment.name)
      .sort();
    expect(writers).to.deep.equal(["cancel", "checkIn", "claim", "put", "seal"]);
  });

  it("builds the same messages the browser signs", async () => {
    const recordedAt = 1_700_000_000_000;
    const [ids, keys] = heirArgs();
    const jsHeirs = heirs.map((heir) => ({ id: heir.id, key: ethers.getBytes(heir.key) }));
    expect(await registry.keyHashHex(heirs[0].key)).to.equal(keyHashHex(jsHeirs[0].key));
    const fields = bound();
    expect(await registry.previewSeal(willId, recordedAt, HOUR, 2, ids, keys, founder, ethers.keccak256(letter), ethers.keccak256(vault), fields.letterParts, fields.vaultParts)).to.equal(
      ethers.hexlify(sealMessage({ willId, recordedAt, intervalMs: HOUR, threshold: 2, heirs: jsHeirs, packet: fields.packet, vault: fields.vault, parts: fields.parts })),
    );
    expect(await registry.previewBeat(willId, recordedAt)).to.equal(ethers.hexlify(beatMessage(willId, recordedAt)));
    expect(await registry.previewVeto(willId, recordedAt)).to.equal(ethers.hexlify(vetoMessage(willId, recordedAt)));
    expect(await registry.previewClaim(willId, heirs[0].id, recordedAt)).to.equal(
      ethers.hexlify(claimMessage(willId, heirs[0].id, recordedAt)),
    );
  });

  it("rejects a signature the precompile refuses, including a stolen ordinary signature", async () => {
    const recordedAt = await atNextBlock(1);
    const [ids, keys] = heirArgs();
    const fields = bound();
    const message = sealMessage({
      willId,
      recordedAt,
      intervalMs: HOUR,
      threshold: 2,
      heirs: heirs.map((heir) => ({ id: heir.id, key: ethers.getBytes(heir.key) })),
      packet: fields.packet,
      vault: fields.vault,
      parts: fields.parts,
    });
    const stolen = ethers.hexlify(ethers.randomBytes(64));
    await expect(
      registry.seal(willId, recordedAt, HOUR, 2, ids, keys, founder, stolen, ethers.keccak256(letter), ethers.keccak256(vault), fields.letterParts, fields.vaultParts),
    ).to.be.revertedWithCustomError(registry, "Signature");
    await expect(
      registry.seal(
        willId,
        recordedAt,
        HOUR,
        2,
        ids,
        keys,
        founder,
        mockSign(founder, ethers.toUtf8Bytes("other")),
        ethers.keccak256(letter),
        ethers.keccak256(vault),
        fields.letterParts,
        fields.vaultParts,
      ),
    ).to.be.revertedWithCustomError(registry, "Signature");
    await sealAt(recordedAt);
    expect(await registry.letterOf(willId)).to.equal(ethers.hexlify(letter));
    expect(await registry.vaultOf(willId)).to.equal(ethers.hexlify(vault));
    const [signer] = await ethers.getSigners();
    expect(await registry.willsOf(signer.address)).to.deep.equal([willId]);
  });

  it("checks in, refuses the wrong key, and lets the founder cancel", async () => {
    const beatAt = await atNextBlock(30);
    const beat = beatMessage(willId, beatAt);
    await expect(registry.checkIn(willId, beatAt, heirs[0].key, mockSign(heirs[0].key, beat))).to.be.revertedWithCustomError(
      registry,
      "Key",
    );
    await expect(
      registry.checkIn(willId, beatAt, founder, ethers.hexlify(ethers.randomBytes(65))),
    ).to.be.revertedWithCustomError(registry, "Signature");
    await registry.checkIn(willId, beatAt, founder, mockSign(founder, beat));
    const after = await registry.read(willId);
    expect(after.lastBeat).to.equal(beatAt);
    expect(after.cancelled).to.equal(false);

    const cancelAt = await atNextBlock(30);
    await registry.cancel(willId, cancelAt, founder, mockSign(founder, vetoMessage(willId, cancelAt)));
    expect((await registry.read(willId)).cancelled).to.equal(true);
    const later = await atNextBlock(30);
    await expect(
      registry.checkIn(willId, later, founder, mockSign(founder, beatMessage(willId, later))),
    ).to.be.revertedWithCustomError(registry, "Done");
  });

  it("opens only after the silence and only with enough distinct heirs", async () => {
    const freshId = "22222222-2222-4222-8222-222222222222";
    const recordedAt = await atNextBlock(1);
    const jsHeirs = heirs.map((heir) => ({ id: heir.id, key: ethers.getBytes(heir.key) }));
    const fields = bound();
    const message = sealMessage({ willId: freshId, recordedAt, intervalMs: HOUR, threshold: 2, heirs: jsHeirs, packet: fields.packet, vault: fields.vault, parts: fields.parts });
    await registry.seal(
      freshId,
      recordedAt,
      HOUR,
      2,
      heirs.map((heir) => heir.id),
      heirs.map((heir) => heir.key),
      founder,
      mockSign(founder, message),
      ethers.keccak256(letter),
      ethers.keccak256(vault),
      fields.letterParts,
      fields.vaultParts,
    );
    await storePieces(freshId, letter, vault, recordedAt);

    const tooSoon = await atNextBlock(60);
    await expect(
      registry.claim(
        freshId,
        heirs[0].id,
        tooSoon,
        heirs[0].key,
        mockSign(heirs[0].key, claimMessage(freshId, heirs[0].id, tooSoon)),
      ),
    ).to.be.revertedWithCustomError(registry, "Quiet");

    const ready = await atNextBlock(HOUR / 1000 + 30);
    await registry.claim(
      freshId,
      heirs[0].id,
      ready,
      heirs[0].key,
      mockSign(heirs[0].key, claimMessage(freshId, heirs[0].id, ready)),
    );
    let view = await registry.read(freshId);
    expect(view.claimCount).to.equal(1);
    expect(view.opened).to.equal(false);

    await expect(
      registry.claim(
        freshId,
        heirs[0].id,
        ready,
        heirs[0].key,
        mockSign(heirs[0].key, claimMessage(freshId, heirs[0].id, ready)),
      ),
    ).to.be.revertedWithCustomError(registry, "Heir");

    const second = await atNextBlock(30);
    await registry.claim(
      freshId,
      heirs[1].id,
      second,
      heirs[1].key,
      mockSign(heirs[1].key, claimMessage(freshId, heirs[1].id, second)),
    );
    view = await registry.read(freshId);
    expect(view.opened).to.equal(true);
    expect(view.claimCount).to.equal(2);

    const back = await atNextBlock(30);
    await registry.checkIn(freshId, back, founder, mockSign(founder, beatMessage(freshId, back)));
    view = await registry.read(freshId);
    expect(view.opened).to.equal(false);
    expect(view.claimCount).to.equal(0);
    expect(view.claimable).to.equal(false);
  });

  it("stores a letter larger than one transaction in pieces", async () => {
    const wideId = "33333333-3333-4333-8333-333333333333";
    const wide = new Uint8Array(PIECE + 100).fill(87);
    const box = new Uint8Array(50).fill(75);
    const recordedAt = await atNextBlock(1);
    const fields = bound(wide, box);
    const jsHeirs = heirs.map((heir) => ({ id: heir.id, key: ethers.getBytes(heir.key) }));
    const [ids, keys] = heirArgs();
    const message = sealMessage({
      willId: wideId,
      recordedAt,
      intervalMs: HOUR,
      threshold: 2,
      heirs: jsHeirs,
      packet: fields.packet,
      vault: fields.vault,
      parts: fields.parts,
    });
    await registry.seal(
      wideId,
      recordedAt,
      HOUR,
      2,
      ids,
      keys,
      founder,
      mockSign(founder, message),
      ethers.keccak256(wide),
      ethers.keccak256(box),
      fields.letterParts,
      fields.vaultParts,
    );
    await storePieces(wideId, wide, box, recordedAt);
    expect(await registry.letterCount(wideId)).to.equal(2n);
    expect(await registry.letterOf(wideId)).to.equal(ethers.hexlify(wide));
    expect(await registry.vaultOf(wideId)).to.equal(ethers.hexlify(box));
  });
});
