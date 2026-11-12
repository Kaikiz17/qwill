import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { Ceremony } from "@/components/ceremony";
import { Button, Notice, fieldClass } from "@/components/qwill-ui";
import { Shell } from "@/components/shell";
import { listPackets } from "@/lib/qwill/chain";
import { formatWhen } from "@/lib/qwill/format";
import { deadline, statusLabel, willStatus, type SealedPacket } from "@/lib/qwill/protocol";
import { useWills } from "@/lib/qwill/store";
import { getAddress, type Hex } from "viem";

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
  const [found, setFound] = useState<SealedPacket[]>([]);
  const [registry, setRegistry] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [now] = useState(() => Date.now());
  const [loading, setLoading] = useState(false);

  const local = onThisPhone.map((will) => will.packet);
  const choices = [...new Map([...local, ...found].map((item) => [item.id, item])).values()].filter((item) =>
    name.trim() ? item.title.toLowerCase().includes(name.trim().toLowerCase()) : true,
  );

  async function show() {
    setLoading(true);
    setError(null);
    setPacket(null);
    try {
      const address = getAddress(registry.trim());
      const packets = await listPackets(address as Hex);
      const matched = name.trim()
        ? packets.filter((item) => item.title.toLowerCase().includes(name.trim().toLowerCase()))
        : packets;
      if (matched.length === 0) throw new Error(packets.length === 0 ? "No will is on that contract." : "No will has that name.");
      setFound(matched);
      if (matched.length === 1) setPacket(matched[0]);
    } catch (err) {
      setFound([]);
      setError(err instanceof Error ? err.message : "The contract could not be read.");
    } finally {
      setLoading(false);
    }
  }

  const status = packet ? willStatus(packet, now) : null;

  return (
    <div>
      <h1 className="font-display text-4xl text-ivory">Open a will</h1>
      <p className="mt-3 max-w-xl text-sm leading-relaxed text-muted">
        Any browser. No wallet. Enter the contract, then the heirs add their keys on this page. The letter opens here.
        Nothing is sent to the chain.
      </p>
      <form
        className="mt-6 space-y-2"
        onSubmit={(event) => {
          event.preventDefault();
          void show();
        }}
      >
        <input
          className={fieldClass}
          value={registry}
          placeholder="Contract address"
          spellCheck={false}
          onChange={(event) => setRegistry(event.target.value)}
        />
        <input
          className={fieldClass}
          value={name}
          placeholder="Name of the will"
          onChange={(event) => setName(event.target.value)}
        />
        <Button type="submit" disabled={loading || registry.trim().length === 0}>
          {loading ? "Looking…" : "Show the will"}
        </Button>
      </form>
      {error ? (
        <div className="mt-4">
          <Notice>{error}</Notice>
        </div>
      ) : null}
      {choices.length > 1 ? (
        <div className="mt-6 flex flex-col gap-2">
          {choices.map((item) => (
            <Button key={item.id} variant="quiet" onClick={() => { setPacket(item); setError(null); }}>
              {item.title}
            </Button>
          ))}
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
            {packet.threshold} of {packet.heirs.length} add a key below.
          </p>
          <div className="mt-6">
            <Ceremony packet={packet} now={now} keys={[]} />
          </div>
        </section>
      ) : null}
    </div>
  );
}