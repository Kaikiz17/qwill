import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { Ceremony } from "@/components/ceremony";
import { Button, Notice, fieldClass } from "@/components/qwill-ui";
import { Shell } from "@/components/shell";
import { openSealedLine } from "@/lib/qwill/chain";
import { formatWhen } from "@/lib/qwill/format";
import { deadline, statusLabel, willStatus, type SealedPacket } from "@/lib/qwill/protocol";

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
  const [line, setLine] = useState("");
  const [packet, setPacket] = useState<SealedPacket | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [now] = useState(() => Date.now());
  const [loading, setLoading] = useState(false);

  async function open() {
    setLoading(true);
    setError(null);
    setPacket(null);
    try {
      setPacket(await openSealedLine(line));
    } catch (err) {
      setError(err instanceof Error ? err.message : "That sealed will could not be opened.");
    } finally {
      setLoading(false);
    }
  }

  const status = packet ? willStatus(packet, now) : null;

  return (
    <div>
      <h1 className="font-display text-4xl text-ivory">Open a will</h1>
      <p className="mt-3 max-w-xl text-sm leading-relaxed text-muted">
        Paste the sealed will. No wallet. The letter opens on this page after the check-ins stop, when the heirs add their keys.
      </p>
      <form
        className="mt-6 space-y-3"
        onSubmit={(event) => {
          event.preventDefault();
          void open();
        }}
      >
        <textarea
          className={fieldClass}
          rows={3}
          value={line}
          placeholder="qwill1:..."
          spellCheck={false}
          onChange={(event) => setLine(event.target.value)}
        />
        <Button type="submit" disabled={loading || line.trim().length === 0}>
          {loading ? "Opening…" : "Open"}
        </Button>
      </form>
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
