import {
  createPublicClient,
  decodeErrorResult,
  encodeFunctionData,
  getAddress,
  hexToBytes,
  http,
  keccak256,
  toHex,
  type Hex,
} from "viem";
import { defineChain } from "viem";
import { b64ToBytes, bytesToB64, fromUtf8, utf8 } from "./bytes";
import { beatMessage, claimMessage, sealMessage, vetoMessage } from "./chain-messages.mjs";
import { dsaPublic, lockWithPassword, openWithPassword, signDsa } from "./crypto";
import type { ClaimKeyFile, SealedPacket, StoredWill } from "./protocol";
import { registryAbi, registryBytecode } from "./registry-artifact";
import { encodeOpenEvmWindow } from "./window-bytes.mjs";

export const DIANA_CHAIN_ID = 9800;
export const DIANA_HEX = "0x2648";
export const COSMOS_CHAIN_ID = "qorechain-diana";
export const DIANA_RPC = "https://evm-testnet.qore.host";
export const DIANA_REST = "https://api-testnet.qore.host";
export const DIANA_EXPLORER = "https://explore.qore.network";
export const PQC_PRECOMPILE = "0x0000000000000000000000000000000000000a01";
const REGISTRY_KEY = "qwill.registry.diana";

const diana = defineChain({
  id: DIANA_CHAIN_ID,
  name: "QoreChain Diana",
  nativeCurrency: { name: "QOR", symbol: "QOR", decimals: 18 },
  rpcUrls: { default: { http: [DIANA_RPC] } },
});

const client = createPublicClient({ chain: diana, transport: http(DIANA_RPC) });

type Eip1193 = {
  request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
};

type Native = {
  enable: (chainId: string) => Promise<unknown>;
  signAndBroadcast: (params: {
    chainId: string;
    messages: { typeUrl: string; value: number[] }[];
    memo?: string;
    gasLimit?: number;
  }) => Promise<{ txHash: string; code?: number }>;
};

type ProviderDetail = { info?: { rdns?: string }; provider?: Eip1193 };

let evmProvider: Eip1193 | null = null;

export type ChainWill = {
  exists: boolean;
  registrar: string;
  lastBeat: number;
  intervalMs: number;
  threshold: number;
  heirCount: number;
  claimCount: number;
  cancelled: boolean;
  opened: boolean;
  claimable: boolean;
};

export function loadRegistry(): Hex | null {
  if (typeof localStorage === "undefined") return null;
  const raw = localStorage.getItem(REGISTRY_KEY);
  if (!raw) return null;
  try {
    return getAddress(raw);
  } catch {
    return null;
  }
}

export function saveRegistry(address: string): Hex {
  const checksum = getAddress(address);
  localStorage.setItem(REGISTRY_KEY, checksum);
  return checksum;
}

export function clearRegistry() {
  localStorage.removeItem(REGISTRY_KEY);
}

function nativeProvider(): Native | null {
  if (typeof window === "undefined") return null;
  const native = (window as unknown as { qorex?: { native?: Native } }).qorex?.native;
  return native ?? null;
}

function discoverQorex(): Promise<Eip1193 | null> {
  return new Promise((resolve) => {
    let found: Eip1193 | null = null;
    const onAnnounce = (event: Event) => {
      const detail = (event as CustomEvent<ProviderDetail>).detail;
      if (detail?.info?.rdns === "network.qore.qorex" && detail.provider) found = detail.provider;
    };
    window.addEventListener("eip6963:announceProvider", onAnnounce);
    window.dispatchEvent(new Event("eip6963:requestProvider"));
    window.setTimeout(() => {
      window.removeEventListener("eip6963:announceProvider", onAnnounce);
      resolve(found);
    }, 800);
  });
}

async function suggestedFee(): Promise<bigint> {
  const price = await client.getGasPrice();
  return price > 0n ? (price * 11n) / 10n : 1_000_000_000n;
}

export async function proveAccess(will: StoredWill, password: string, registry: Hex): Promise<void> {
  if (password.trim().length < 8) throw new Error("Enter the password for this will.");
  const vault = await readLocked(registry, will.packet.id, true);
  if (vault.length === 0) throw new Error("The locked key is not on this contract.");
  const opened = JSON.parse(fromUtf8(await openWithPassword(password.trim(), vault))) as { kind?: string; willId?: string };
  if (opened.kind !== "qwill-founder" || opened.willId !== will.packet.id) {
    throw new Error("That password does not open this will.");
  }
  const account = await connectQorex();
  if (!evmProvider) throw new Error("Connect QoreX first.");
  const message = toHex(utf8(`QWILL unlock\nwill=${will.packet.id}`));
  await evmProvider.request({ method: "personal_sign", params: [message, account] });
}

export async function connectQorex(): Promise<Hex> {
  const found = await discoverQorex();
  if (!found) {
    throw new Error("QoreX is not in this browser. Install it, then open QWILL where the extension can see the page.");
  }
  evmProvider = found;
  try {
    await found.request({ method: "wallet_switchEthereumChain", params: [{ chainId: DIANA_HEX }] });
  } catch (err) {
    if (errorCode(err) !== 4902) throw err;
    await found.request({
      method: "wallet_addEthereumChain",
      params: [
        {
          chainId: DIANA_HEX,
          chainName: "QoreChain Diana Testnet",
          nativeCurrency: { name: "QOR", symbol: "QOR", decimals: 18 },
          rpcUrls: [DIANA_RPC],
        },
      ],
    });
  }
  const accounts = (await found.request({ method: "eth_requestAccounts" })) as string[];
  const account = accounts[0];
  if (!account) throw new Error("QoreX did not share an account.");
  return getAddress(account);
}

export async function readWill(registry: Hex, willId: string): Promise<ChainWill> {
  const result = (await client.readContract({
    address: registry,
    abi: registryAbi,
    functionName: "read",
    args: [willId],
  })) as readonly [
    boolean,
    Hex,
    Hex,
    bigint,
    bigint,
    bigint,
    bigint,
    number,
    number,
    number,
    boolean,
    boolean,
    boolean,
  ];
  const [
    exists,
    registrar,
    ,
    ,
    intervalMs,
    lastBeat,
    ,
    threshold,
    heirCount,
    claimCount,
    cancelled,
    opened,
    claimable,
  ] = result;
  return {
    exists,
    registrar,
    lastBeat: Number(lastBeat),
    intervalMs: Number(intervalMs),
    threshold,
    heirCount,
    claimCount,
    cancelled,
    opened,
    claimable,
  };
}

export async function openDeployWindow(account: Hex): Promise<string> {
  return openWindow(account, { maxTxs: 3, gas: 4_000_000n });
}

export async function openScopedWindow(account: Hex, registry: Hex): Promise<string> {
  return openWindow(account, { maxTxs: 20, gas: 6_000_000n, targets: [registry] });
}

async function openWindow(account: Hex, scope: { maxTxs: number; gas: bigint; targets?: Hex[] }): Promise<string> {
  const native = nativeProvider();
  if (!native) {
    throw new Error("QoreX can sign Ethereum transactions here, but the hybrid signer is missing. Use the QoreX browser. A page cannot make the quantum-safe half of the signature.");
  }
  const { openEvmWindowMsg } = await import("@qorechain/sdk");
  const { toQorAddress, evmWindowCost } = await import("@qorechain/evm/window");
  const fee = await suggestedFee();
  const perTx = evmWindowCost({ gas: scope.gas, maxFeePerGas: fee, value: 0n });
  const budget = perTx * BigInt(scope.maxTxs);
  const msg = openEvmWindowMsg({
    sender: toQorAddress(account),
    blocks: 7200,
    maxTxs: scope.maxTxs,
    maxValue: (budget > 0n ? budget : 1n).toString(),
    allowedTargets: scope.targets,
  });
  await native.enable(COSMOS_CHAIN_ID);
  const result = await native.signAndBroadcast({
    chainId: COSMOS_CHAIN_ID,
    messages: [{ typeUrl: msg.typeUrl, value: Array.from(encodeOpenEvmWindow(msg.value)) }],
    memo: scope.targets ? "QWILL window for one contract" : "QWILL deploy window",
    gasLimit: 500_000,
  });
  if (result.code && result.code !== 0) throw new Error(`The chain refused the window (${result.code}).`);
  if (!result.txHash) throw new Error("QoreX did not return a transaction.");
  return result.txHash;
}

export async function readWindow(account: Hex) {
  const { evmWindowStatus, toQorAddress } = await import("@qorechain/evm/window");
  return evmWindowStatus({ rest: DIANA_REST, address: toQorAddress(account) });
}

const PIECE_BYTES = 12_000;

export async function ensureRegistry(account: Hex): Promise<Hex> {
  const saved = loadRegistry();
  if (saved) {
    try {
      const flag = await client.readContract({ address: saved, abi: registryAbi, functionName: "ONE_TX" });
      if (flag === 1n) return saved;
    } catch {
      /* the saved contract cannot hold a long letter */
    }
  }
  return deployRegistry(account);
}

export async function deployRegistry(account: Hex): Promise<Hex> {
  const hash = await send(account, undefined, registryBytecode, 4_000_000n);
  const receipt = await client.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success" || !receipt.contractAddress) {
    throw new Error("The deploy was mined, but no contract address came back.");
  }
  return saveRegistry(receipt.contractAddress);
}

export async function sealOnChain(will: StoredWill, account: Hex, registry: Hex, password: string): Promise<Hex> {
  if (password.trim().length < 8) throw new Error("Use a password of at least 8 characters. You will need it on a new phone.");
  const founderKey = b64ToBytes(will.packet.founder.dsa);
  const heirs = will.packet.heirs.map((heir) => ({ id: heir.id, key: b64ToBytes(heir.dsa) }));
  const recordedAt = Date.now();
  const letter = utf8(JSON.stringify(will.packet));
  const vault = await lockWithPassword(password.trim(), utf8(JSON.stringify(will.founder)));
  const letterPieces = splitPieces(letter);
  const vaultPieces = splitPieces(vault);
  const letterParts = letterPieces.map((piece) => keccak256(piece));
  const vaultParts = vaultPieces.map((piece) => keccak256(piece));
  const message = sealMessage({
    willId: will.packet.id,
    recordedAt,
    intervalMs: will.packet.intervalMs,
    threshold: will.packet.threshold,
    heirs,
    packet: keccak256(letter).slice(2),
    vault: keccak256(vault).slice(2),
    parts: partsField(letterParts, vaultParts),
  });
  const signature = b64ToBytes(signDsa(will.founder.dsaSk, message));
  const data = encodeFunctionData({
    abi: registryAbi,
    functionName: "seal",
    args: [
      will.packet.id,
      BigInt(recordedAt),
      BigInt(will.packet.intervalMs),
      will.packet.threshold,
      heirs.map((heir) => heir.id),
      heirs.map((heir) => toHex(heir.key)),
      toHex(founderKey),
      toHex(signature),
      toHex(letter),
      toHex(vault),
    ],
  });
  const hash = await send(account, registry, data, sealGas(letter, vault));
  const receipt = await client.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") throw new Error("The chain refused the will. It was not created.");
  return hash;
}

export async function loadWills(account: Hex, registry: Hex): Promise<{ packet: SealedPacket; vault: string }[]> {
  const ids = (await client.readContract({
    address: registry,
    abi: registryAbi,
    functionName: "willsOf",
    args: [account],
  })) as string[];
  const found: { packet: SealedPacket; vault: string }[] = [];
  for (const id of ids) {
    const letter = await readLocked(registry, id, false);
    const vault = await readLocked(registry, id, true);
    if (letter.length === 0 || vault.length === 0) continue;
    const packet = JSON.parse(fromUtf8(letter)) as SealedPacket;
    if (packet?.kind !== "qwill" || packet.id !== id) continue;
    found.push({ packet, vault: bytesToB64(vault) });
  }
  return found;
}

export async function loadPacket(registry: Hex, willId: string): Promise<SealedPacket> {
  const letter = await readLocked(registry, willId, false);
  if (letter.length === 0) throw new Error("That contract has no letter for this will.");
  const packet = JSON.parse(fromUtf8(letter)) as SealedPacket;
  if (packet?.kind !== "qwill" || packet.id !== willId) throw new Error("The letter on the chain could not be read.");
  return packet;
}

const lockedEvent = {
  type: "event",
  name: "Locked",
  inputs: [
    { name: "willKey", type: "bytes32", indexed: true },
    { name: "vault", type: "bool", indexed: true },
    { name: "index", type: "uint16", indexed: false },
    { name: "data", type: "bytes", indexed: false },
  ],
} as const;

export async function listPackets(registry: Hex): Promise<SealedPacket[]> {
  const latest = await client.getBlockNumber();
  const span = 9_000n;
  const groups = new Map<string, { index: number; data: Hex }[]>();
  for (let step = 0n; step < 6n; step += 1n) {
    const to = latest - step * span;
    if (to <= 0n) break;
    const from = to > span ? to - span + 1n : 0n;
    let logs: Awaited<ReturnType<typeof client.getLogs<typeof lockedEvent>>> = [];
    try {
      logs = await client.getLogs({
        address: registry,
        event: lockedEvent,
        args: { vault: false },
        fromBlock: from,
        toBlock: to,
      });
    } catch {
      continue;
    }
    for (const log of logs) {
      const key = log.args.willKey;
      if (!key || !log.args.data) continue;
      const list = groups.get(key) ?? [];
      list.push({ index: Number(log.args.index ?? 0), data: log.args.data });
      groups.set(key, list);
    }
  }
  const packets: SealedPacket[] = [];
  for (const parts of groups.values()) {
    parts.sort((a, b) => a.index - b.index);
    try {
      const packet = JSON.parse(fromUtf8(concatBytes(parts.map((part) => hexToBytes(part.data))))) as SealedPacket;
      if (packet?.kind === "qwill" && typeof packet.id === "string" && typeof packet.title === "string") packets.push(packet);
    } catch {
      /* a piece from another contract layout */
    }
  }
  return packets;
}

export async function checkInOnChain(will: StoredWill, account: Hex, registry: Hex, at = Date.now()): Promise<Hex> {
  return founderAction(will, account, registry, "checkIn", at);
}

export async function cancelOnChain(will: StoredWill, account: Hex, registry: Hex, at = Date.now()): Promise<Hex> {
  return founderAction(will, account, registry, "cancel", at);
}

async function founderAction(
  will: StoredWill,
  account: Hex,
  registry: Hex,
  action: "checkIn" | "cancel",
  at: number,
): Promise<Hex> {
  const founderKey = b64ToBytes(will.packet.founder.dsa);
  const message = action === "checkIn" ? beatMessage(will.packet.id, at) : vetoMessage(will.packet.id, at);
  const signature = b64ToBytes(signDsa(will.founder.dsaSk, message));
  const data = encodeFunctionData({
    abi: registryAbi,
    functionName: action,
    args: [will.packet.id, BigInt(at), toHex(founderKey), toHex(signature)],
  });
  const hash = await send(account, registry, data, 3_000_000n);
  const receipt = await client.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") throw new Error("The chain refused it. Nothing changed.");
  return hash;
}

export async function claimOnChain(willId: string, claim: ClaimKeyFile, account: Hex, registry: Hex): Promise<Hex> {
  const at = Date.now();
  const heirKey = dsaPublic(claim.dsaSk);
  const message = claimMessage(willId, claim.heirId, at);
  const signature = b64ToBytes(signDsa(claim.dsaSk, message));
  const data = encodeFunctionData({
    abi: registryAbi,
    functionName: "claim",
    args: [willId, claim.heirId, BigInt(at), toHex(heirKey), toHex(signature)],
  });
  const hash = await send(account, registry, data, 3_000_000n);
  const receipt = await client.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") throw new Error("The chain refused the claim. Nothing changed.");
  return hash;
}

export function explainChainError(err: unknown): string {
  const code = errorCode(err);
  if (code === 4001) return "QoreX was closed before it was signed.";
  const raw = err instanceof Error ? err.message : "The chain refused that.";
  const data = revertData(err);
  if (data) {
    try {
      const decoded = decodeErrorResult({ abi: registryAbi, data });
      return explainName(decoded.errorName);
    } catch {
      /* not one of ours */
    }
  }
  if (raw.toLowerCase().includes("window") || raw.toLowerCase().includes("allowance")) {
    return "The QoreX window is too small, or it is closed. In the QoreX app, open the EVM window, allow 20 transactions, and set the spending cap to 20 QOR.";
  }
  for (const name of ["Signature", "Time", "Quiet", "Done", "Unknown", "Exists", "Heir", "Key", "Heirs", "Interval", "BadId"]) {
    if (raw.includes(name)) return explainName(name);
  }
  const line = raw.split("\n")[0] ?? raw;
  return line.length > 240 ? `${line.slice(0, 240)}…` : line;
}

function explainName(name: string): string {
  if (name === "Signature") return "The quantum-safe signature was refused. An ordinary key cannot do this.";
  if (name === "Time") return "The chain clock and this device are more than five minutes apart.";
  if (name === "Quiet") return "The waiting period on the chain has not finished.";
  if (name === "Done") return "This will is already cancelled on the chain.";
  if (name === "Unknown") return "This will is not recorded on the chain yet.";
  if (name === "Exists") return "This will is already recorded.";
  if (name === "Heir") return "That heir has already filed, or this key is not on the will.";
  if (name === "Key") return "That key is not the one recorded for this action.";
  if (name === "Interval") return "The waiting period has to be at least an hour.";
  return "The chain refused that.";
}

function splitPieces(bytes: Uint8Array): Uint8Array[] {
  const parts: Uint8Array[] = [];
  for (let i = 0; i < bytes.length; i += PIECE_BYTES) parts.push(bytes.subarray(i, i + PIECE_BYTES));
  return parts;
}

function partsField(letterParts: Hex[], vaultParts: Hex[]): string {
  const hex = (list: Hex[]) => list.map((item) => item.slice(2)).join(",");
  return `${hex(letterParts)}|${hex(vaultParts)}`;
}

function sealGas(letter: Uint8Array, vault: Uint8Array): bigint {
  const size = BigInt(letter.length + vault.length);
  const need = 3_000_000n + size * 40n;
  const cap = 29_000_000n;
  return need > cap ? cap : need;
}

async function readLocked(registry: Hex, willId: string, vault: boolean): Promise<Uint8Array> {
  try {
    const block = (await client.readContract({
      address: registry,
      abi: registryAbi,
      functionName: "blockOf",
      args: [willId],
    })) as bigint;
    if (block > 0n) {
      const fromLogs = await readLogs(registry, willId, vault, block);
      if (fromLogs.length > 0) return fromLogs;
    }
  } catch {
    /* the contract already on chain keeps the letter in storage */
  }
  return readPieces(registry, willId, vault);
}

async function readLogs(registry: Hex, willId: string, vault: boolean, block: bigint): Promise<Uint8Array> {
  const logs = await client.getLogs({
    address: registry,
    event: {
      type: "event",
      name: "Locked",
      inputs: [
        { name: "willKey", type: "bytes32", indexed: true },
        { name: "vault", type: "bool", indexed: true },
        { name: "index", type: "uint16", indexed: false },
        { name: "data", type: "bytes", indexed: false },
      ],
    },
    args: { willKey: keccak256(utf8(willId)), vault },
    fromBlock: block,
    toBlock: block,
  });
  const ordered = [...logs].sort((a, b) => Number(a.args.index) - Number(b.args.index));
  const parts: Uint8Array[] = [];
  for (const log of ordered) {
    if (!log.args.data) continue;
    parts.push(hexToBytes(log.args.data));
  }
  return concatBytes(parts);
}

async function readPieces(registry: Hex, willId: string, vault: boolean): Promise<Uint8Array> {
  const count = Number(
    await client.readContract({
      address: registry,
      abi: registryAbi,
      functionName: vault ? "vaultCount" : "letterCount",
      args: [willId],
    }),
  );
  const parts: Uint8Array[] = [];
  for (let index = 0; index < count; index += 1) {
    const piece = (await client.readContract({
      address: registry,
      abi: registryAbi,
      functionName: "pieceOf",
      args: [willId, vault, BigInt(index)],
    })) as Hex;
    parts.push(hexToBytes(piece));
  }
  return concatBytes(parts);
}

function concatBytes(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

async function send(from: Hex, to: Hex | undefined, data: Hex, gas: bigint): Promise<Hex> {
  if (!evmProvider) throw new Error("Connect QoreX first.");
  const fee = await suggestedFee();
  const tx: Record<string, string> = {
    from,
    data,
    gas: toHex(gas),
    maxFeePerGas: toHex(fee),
    maxPriorityFeePerGas: toHex(fee / 2n === 0n ? 1n : fee / 2n),
  };
  if (to) tx.to = to;
  const hash = (await evmProvider.request({ method: "eth_sendTransaction", params: [tx] })) as string;
  return hash as Hex;
}

function errorCode(err: unknown): number | undefined {
  if (typeof err === "object" && err && "code" in err && typeof (err as { code: unknown }).code === "number") {
    return (err as { code: number }).code;
  }
  return undefined;
}

function revertData(err: unknown): Hex | undefined {
  if (typeof err !== "object" || !err) return undefined;
  const data = (err as { data?: unknown }).data;
  if (typeof data === "string" && data.startsWith("0x")) return data as Hex;
  return undefined;
}
