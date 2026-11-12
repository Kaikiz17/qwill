import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { Ceremony } from "@/components/ceremony";
import { Button, Notice, fieldClass } from "@/components/qwill-ui";
import { Shell } from "@/components/shell";
import { formatWhen, readFile } from "@/lib/qwill/format";
import { deadline, isPacket, parseJson, statusLabel, willStatus, type SealedPacket } from "@/lib/qwill/protocol";

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
  const [text, setText] = useState("");
  const [packet, setPacket] = useState<SealedPacket | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [now] = useState(() => Date.now());

  function accept(raw: string) {
    setText(raw);
    try {
      const parsed = parseJson(raw);
      if (!isPacket(parsed)) {
        setPacket(null);
        setError("That is not a sealed will.");
        return;
      }
      setError(null);
      setPacket(parsed);
    } catch {
      setPacket(null);
      setError("That file could not be read.");
    }
  }

  const status = packet ? willStatus(packet, now) : null;

  return (
    <div>
      <h1 className="font-display text-4xl text-ivory">Open a will</h1>
      <p className="mt-3 max-w-xl text-sm leading-relaxed text-muted">
        This page is for the heirs, after the check-ins have stopped. Put in the sealed will. Then each heir adds their
        own key on this phone. One key does nothing. When enough heirs are here, the letter opens. Their keys are not
        saved into the will, and they leave when this page is closed.
      </p>
      <label className="mt-8 block">
        <span className="mb-2 flex items-center justify-between text-sm text-ivory">
          Sealed will
          <span className="inline-flex min-h-11 cursor-pointer items-center text-muted">
            Load file
            <input
              type="file"
              accept="application/json,.json"
              className="sr-only"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (!file) return;
                void readFile(file).then(accept);
              }}
            />
          </span>
        </span>
        <textarea
          className={fieldClass}
          rows={5}
          value={text}
          placeholder="Paste the sealed will"
          onChange={(event) => {
            setText(event.target.value);
            setPacket(null);
            setError(null);
          }}
        />
      </label>
      <div className="mt-4">
        <Button disabled={text.trim().length === 0} onClick={() => accept(text)}>
          Read the will
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
