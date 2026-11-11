import { useEffect, useState } from "react";
import { Button, Notice, fieldClass } from "@/components/qwill-ui";
import {
  cancelOnChain,
  checkInOnChain,
  claimOnChain,
  clearRegistry,
  connectQorex,
  deployRegistry,
  explainChainError,
  loadRegistry,
  loadWills,
  readWill,
  readWindow,
  saveRegistry,
  sealOnChain,
  type ChainWill,
} from "@/lib/qwill/chain";
import { formatWhen } from "@/lib/qwill/format";
import type { ClaimKeyFile, StoredWill } from "@/lib/qwill/protocol";
import { useWills } from "@/lib/qwill/store";
import type { Hex } from "viem";

export function ChainRecord({ will, keys }: { will: StoredWill; keys: ClaimKeyFile[] }) {
  const [ready, setReady] = useState(false);
  const [account, setAccount] = useState<Hex | null>(null);
  const [registry, setRegistry] = useState<Hex | null>(null);
  const [chainWill, setChainWill] = useState<ChainWill | null>(null);
  const [windowLine, setWindowLine] = useState<string | null>(null);
  const [hash, setHash] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [password, setPassword] = useState("");
  const rememberLocked = useWills((state) => state.rememberLocked);

  async function refresh(nextRegistry = registry) {
    if (!nextRegistry) {
      setChainWill(null);
      return;
    }
    setChainWill(await readWill(nextRegistry, will.packet.id));
  }

  useEffect(() => {
    const stored = loadRegistry();
    setRegistry(stored);
    setReady(true);
    if (!stored) return;
    void readWill(stored, will.packet.id)
      .then(setChainWill)
      .catch((err: unknown) => setError(explainChainError(err)));
  }, [will.packet.id]);

  async function run(label: string, action: () => Promise<void>) {
    setBusy(label);
    setError(null);
    try {
      await action();
    } catch (err) {
      setError(explainChainError(err));
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="mt-10">
      <h2 className="font-display text-2xl text-ivory">On QoreChain</h2>
      <p className="mt-3 max-w-xl text-sm leading-relaxed text-muted">
        The letter stays locked. Recording stores that locked letter, and your founder key behind the password below, under this
        wallet. A new phone connects the same wallet, loads the letter, and opens it with the password. The heirs still need
        the keys you gave them. An ordinary signature is not enough for check-in, cancel, or a claim.
      </p>
      <p className="mt-3 max-w-xl text-sm leading-relaxed text-muted">
        The chain clock starts when you record the will, from that moment. It does not copy silence that already happened
        on this device. The contract already on the testnet cannot hold a letter. Deploy this version, then record again.
        Testnet coins come from the{" "}
        <a className="underline" href="https://dashboard.qorechain.io/faucet" target="_blank" rel="noreferrer">
          faucet
        </a>
        . QoreX has to sign. This preview cannot see the wallet.
      </p>

      {!ready ? null : (
        <div className="mt-5 space-y-4">
          <p className="text-sm text-ivory">{chainLine(chainWill)}</p>
          {registry ? (
            <p className="break-all text-sm text-muted">Contract {registry}</p>
          ) : (
            <p className="text-sm text-muted">No contract address on this device yet.</p>
          )}
          {windowLine ? <p className="text-sm text-muted">{windowLine}</p> : null}
          {hash ? <p className="break-all text-sm text-muted">Last transaction {hash}</p> : null}

          <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
            <Button disabled={Boolean(busy)} onClick={() => void run("connect", async () => {
              const next = await connectQorex();
              setAccount(next);
              if (registry) rememberLocked(await loadWills(next, registry));
            })}>
              {account ? "QoreX connected" : busy === "connect" ? "Connecting…" : "Connect QoreX"}
            </Button>
            {account ? <span className="self-center break-all text-sm text-muted">{account}</span> : null}
          </div>

          {!registry ? (
            <div className="space-y-3">
              <div className="flex flex-col gap-2 sm:flex-row">
                <Button
                  variant="quiet"
                  disabled={!account || Boolean(busy)}
                  onClick={() =>
                    void run("window", async () => {
                      if (!account) return;
                      const open = await readWindow(account);
                      setWindowLine(
                        open.live
                          ? describeWindow(open.remainingTxs, open.allowedTargets)
                          : "No window is open. Open one in the QoreX app, then come back.",
                      );
                    })
                  }
                >
                  {busy === "window" ? "Checking…" : "Check the window"}
                </Button>
                <Button
                  variant="quiet"
                  disabled={!account || Boolean(busy)}
                  onClick={() =>
                    void run("deploy", async () => {
                      if (!account) return;
                      const address = await deployRegistry(account);
                      setRegistry(address);
                      await refresh(address);
                    })
                  }
                >
                  {busy === "deploy" ? "Deploying…" : "Deploy the registry"}
                </Button>
              </div>
              <p className="max-w-xl text-sm text-muted">
                QoreX will not let this page open the window. Open it in the QoreX app, on the home card or under Settings,
                Security, EVM access window. Leave “native QOR only” off, allow at least 5 transactions, and set the spending
                cap above a few QOR. That signature is hybrid, but it is not limited to this contract. QoreX has no screen
                for a one-contract window, and a website cannot create one.
              </p>
              <form
                className="flex flex-col gap-2 sm:flex-row"
                onSubmit={(event) => {
                  event.preventDefault();
                  void run("paste", async () => {
                    const address = saveRegistry(draft.trim());
                    setRegistry(address);
                    setDraft("");
                    await refresh(address);
                  });
                }}
              >
                <input
                  className={fieldClass}
                  value={draft}
                  placeholder="Or paste a registry address"
                  onChange={(event) => setDraft(event.target.value)}
                  spellCheck={false}
                />
                <Button variant="quiet" type="submit" disabled={!draft.trim() || Boolean(busy)}>
                  Use this contract
                </Button>
              </form>
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              <input
                className={fieldClass}
                value={password}
                type="password"
                placeholder="Password for a new phone, at least 8 characters"
                autoComplete="new-password"
                onChange={(event) => setPassword(event.target.value)}
              />
              <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
              <Button
                variant="quiet"
                disabled={!account || Boolean(busy)}
                onClick={() =>
                  void run("window", async () => {
                    if (!account) return;
                    const open = await readWindow(account);
                    setWindowLine(
                      open.live
                        ? describeWindow(open.remainingTxs, open.allowedTargets)
                        : "No window is open. Open one in the QoreX app, then come back.",
                    );
                  })
                }
              >
                {busy === "window" ? "Checking…" : "Check the window"}
              </Button>
              <Button
                variant="quiet"
                disabled={!account || Boolean(busy)}
                onClick={() =>
                  void run("deploy", async () => {
                    if (!account) return;
                    const address = await deployRegistry(account);
                    setRegistry(address);
                    setChainWill(null);
                    await refresh(address);
                  })
                }
              >
                {busy === "deploy" ? "Deploying…" : "Deploy a new registry"}
              </Button>
              <Button
                disabled={!account || Boolean(busy) || chainWill?.exists || password.trim().length < 8}
                onClick={() =>
                  void run("seal", async () => {
                    if (!account || !registry) return;
                    setHash(await sealOnChain(will, account, registry, password));
                    setPassword("");
                    await refresh(registry);
                  })
                }
              >
                {busy === "seal" ? "Recording…" : "Record this will"}
              </Button>
              <Button
                variant="quiet"
                disabled={!account || Boolean(busy) || !chainWill?.exists || chainWill.cancelled}
                onClick={() =>
                  void run("beat", async () => {
                    if (!account || !registry) return;
                    setHash(await checkInOnChain(will, account, registry));
                    await refresh(registry);
                  })
                }
              >
                {busy === "beat" ? "Signing…" : "Check in on the chain"}
              </Button>
              <Button
                variant="quiet"
                disabled={!account || Boolean(busy) || !chainWill?.exists || chainWill.cancelled}
                onClick={() =>
                  void run("cancel", async () => {
                    if (!account || !registry) return;
                    setHash(await cancelOnChain(will, account, registry));
                    await refresh(registry);
                  })
                }
              >
                {busy === "cancel" ? "Signing…" : "Cancel on the chain"}
              </Button>
              <Button
                variant="ghost"
                disabled={Boolean(busy)}
                onClick={() => {
                  clearRegistry();
                  setRegistry(null);
                  setChainWill(null);
                  setWindowLine(null);
                }}
              >
                Forget this contract
              </Button>
            </div>
            </div>
          )}

          {registry && keys.length > 0 ? (
            <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
              {keys.map((key) => (
                <Button
                  key={key.heirId}
                  variant="quiet"
                  disabled={!account || Boolean(busy) || !chainWill?.claimable}
                  onClick={() =>
                    void run(key.heirId, async () => {
                      if (!account || !registry) return;
                      setHash(await claimOnChain(will.packet.id, key, account, registry));
                      await refresh(registry);
                    })
                  }
                >
                  {busy === key.heirId ? "Filing…" : `File ${key.name}'s claim`}
                </Button>
              ))}
            </div>
          ) : null}
          {error ? <Notice>{error}</Notice> : null}
        </div>
      )}
    </section>
  );
}

function chainLine(will: ChainWill | null): string {
  if (!will?.exists) return "This will is not on the chain yet.";
  if (will.cancelled) return "Cancelled on the chain. Heirs cannot file.";
  if (will.opened) {
    return `${will.claimCount} of ${will.threshold} heirs have filed. The letter is still only on this device.`;
  }
  if (will.claimable) return "The chain waiting period has passed. Heirs can file. The letter stays sealed.";
  return `Chain check-in due before ${formatWhen(will.lastBeat + will.intervalMs)}.`;
}

function describeWindow(remaining: bigint, targets: string[]): string {
  const where = targets.length > 0 ? " It can only call the listed contract." : " It is not limited to one contract.";
  return `${remaining.toString()} transactions left in the window.${where}`;
}
