import { useEffect, useState } from "react";
import { Button, Notice } from "@/components/qwill-ui";
import {
  claimOnChain,
  connectQorex,
  explainChainError,
  loadRegistry,
  DIANA_EXPLORER,
  readWill,
  type ChainWill,
} from "@/lib/qwill/chain";
import { formatWhen } from "@/lib/qwill/format";
import type { ClaimKeyFile, StoredWill } from "@/lib/qwill/protocol";
import type { Hex } from "viem";

export function ChainRecord({ will, keys }: { will: StoredWill; keys: ClaimKeyFile[] }) {
  const [registry, setRegistry] = useState<Hex | null>(null);
  const [chainWill, setChainWill] = useState<ChainWill | null>(null);
  const [hash, setHash] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    const stored = (will.registry as Hex | undefined) ?? loadRegistry();
    setRegistry(stored);
    if (!stored) return;
    void readWill(stored, will.packet.id)
      .then(setChainWill)
      .catch((err: unknown) => setError(explainChainError(err)));
  }, [will.packet.id, will.registry]);

  return (
    <section className="mt-10">
      <h2 className="font-display text-2xl text-ivory">On the chain</h2>
      <p className="mt-3 max-w-xl text-sm leading-relaxed text-muted">{chainLine(chainWill)}</p>
      {registry ? (
        <p className="mt-3 break-all text-sm text-muted">
          Contract{" "}
          <a className="underline" href={`${DIANA_EXPLORER}/address/${registry}`} target="_blank" rel="noreferrer">
            {registry}
          </a>
        </p>
      ) : null}
      {hash ? (
        <a className="mt-3 block break-all text-sm text-ivory underline" href={`${DIANA_EXPLORER}/tx/${hash}`} target="_blank" rel="noreferrer">
          See this transaction on the chain
        </a>
      ) : null}
      {chainWill?.claimable && keys.length > 0 ? (
        <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:flex-wrap">
          {keys.map((key) => (
            <Button
              key={key.heirId}
              variant="quiet"
              disabled={Boolean(busy) || !registry}
              onClick={() =>
                void (async () => {
                  if (!registry) return;
                  setBusy(key.heirId);
                  setError(null);
                  try {
                    await connectQorex();
                    const tx = await claimOnChain(will.packet.id, key, await connectQorex(), registry);
                    setHash(tx);
                    setChainWill(await readWill(registry, will.packet.id));
                  } catch (err) {
                    setError(explainChainError(err));
                  } finally {
                    setBusy(null);
                  }
                })()
              }
            >
              {busy === key.heirId ? "Waiting on QoreX…" : `File ${key.name}'s claim`}
            </Button>
          ))}
        </div>
      ) : null}
      {error ? (
        <div className="mt-4">
          <Notice>{error}</Notice>
        </div>
      ) : null}
    </section>
  );
}

function chainLine(chainWill: ChainWill | null): string {
  if (!chainWill) return "Reading the contract…";
  if (!chainWill.exists) return "This will is not on the contract saved on this phone.";
  if (chainWill.cancelled) return "Cancelled on the chain.";
  if (chainWill.opened) return "The heirs have opened it on the chain.";
  const due = chainWill.lastBeat + chainWill.intervalMs;
  if (chainWill.claimable) return `Quiet on the chain since ${formatWhen(due)}. Heirs can file.`;
  return `On the chain. Check in before ${formatWhen(due)}.`;
}