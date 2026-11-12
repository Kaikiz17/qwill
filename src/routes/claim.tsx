import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { Ceremony } from "@/components/ceremony";
import { Button, Notice } from "@/components/qwill-ui";
import { Shell } from "@/components/shell";
import { connectQorex, explainChainError, loadRegistry, loadWills } from "@/lib/qwill/chain";
import { formatWhen } from "@/lib/qwill/format";
import { deadline, statusLabel, willStatus, type SealedPacket } from "@/lib/qwill/protocol";
import { useWills } from "@/lib/qwill/store";

export const Route = createFileRoute("/claim")({
  component: ClaimPage,
});

function ClaimPage() {
  return (
    <Shell>
      <Claim />
    </Shell>
  );
}

function Claim() {
  const onThisPhone = useWills((state) => state.wills);
  const [packet, setPacket] = useState<SealedPacket | null>(null);
  const [fromChain, setFromChain] = useState<SealedPacket[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [now] = useState(() => Date.now());
  const [loading, setLoading] = useState(false);

  const names = new Map<string, SealedPacket>();
  for (const will of onThisPhone) names.set(will.packet.id, will.packet);
  for (const item of fromChain) names.set(item.id, item);
  const choices = [...names.values()];

  async function loadNames() {
    setLoading(true);
    setError(null);
    try {
      const registry = loadRegistry();
      if (!registry) throw new Error("Open this page in the QoreX app, on the phone where you created the will.");
      const account = await connectQorex();
      const found = await loadWills(account, registry);
      if (found.length === 0) throw new Error("This wallet has no will on the contract.");
      setFromChain(found.map((item) => item.packet));
    } catch (err) {
      setError(explainChainError(err));
    } finally {
      setLoading(false);
    }
  }

  const status = packet ? willStatus(packet, now) : null;

  return (
    <div>
      <h1 className="font-display text-4xl text-ivory">Open a will</h1>
      <p className="mt-3 max-w-xl text-sm leading-relaxed text-muted">Tap the name. There is nothing to paste.</p>
      {choices.length > 0 ? (
        <div className="mt-6 flex flex-col gap-2">
          {choices.map((item) => (
            <Button key={item.id} variant="quiet" onClick={() => { setPacket(item); setError(null); }}>
              {item.title}
            </Button>
          ))}
        </div>
      ) : (
        <p className="mt-6 text-sm text-muted">No will is on this phone yet.</p>
      )}
      <div className="mt-4">
        <Button disabled={loading} onClick={() => void loadNames()}>
          {loading ? "Waiting on QoreX…" : "Load the names from the chain"}
        </Button>
      </div>
      {error ? (
        <div className="mt-4">
          <Notice>{error}</Notice>
        </div>
      ) : null}
      {packet && status ? (
        <section className="mt-8">
          <h2 className="font-display text-3xl text-ivory">{packet.title}</h2>
          <p className="mt-2 text-sm text-muted">
            {statusLabel(status)}
            {status === "alive" ? ` · opens after ${formatWhen(deadline(packet))}` : null}
          </p>
          <ul className="mt-4 space-y-1 text-sm text-muted">
            {packet.heirs.map((heir) => (
              <li key={heir.id}>{heir.name}</li>
            ))}
          </ul>
          <p className="mt-2 text-sm text-muted">
            {packet.threshold} of {packet.heirs.length} must come together.
          </p>
          <div className="mt-6">
            <Ceremony packet={packet} now={now} keys={[]} />
          </div>
        </section>
      ) : null}
    </div>
  );
}
