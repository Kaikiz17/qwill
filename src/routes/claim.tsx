import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { Ceremony } from "@/components/ceremony";
import { Button, Notice, fieldClass } from "@/components/qwill-ui";
import { Shell } from "@/components/shell";
import { explainChainError, loadPacket, loadRegistry } from "@/lib/qwill/chain";
import { formatWhen, readFile } from "@/lib/qwill/format";
import { deadline, isClaimKey, isPacket, parseJson, statusLabel, willStatus, type SealedPacket } from "@/lib/qwill/protocol";
import { useWills } from "@/lib/qwill/store";
import type { Hex } from "viem";

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
  const [text, setText] = useState("");
  const [packet, setPacket] = useState<SealedPacket | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [now] = useState(() => Date.now());
  const [registry, setRegistry] = useState(() => loadRegistry() ?? "");
  const [willId, setWillId] = useState("");
  const [loading, setLoading] = useState(false);

  function usePacket(next: SealedPacket) {
    setPacket(next);
    setText("");
    setError(null);
  }

  function accept(raw: string) {
    const trimmed = raw.trim();
    setText(raw);
    let parsed: unknown;
    try {
      parsed = parseJson(trimmed);
    } catch {
      const start = trimmed.indexOf("{");
      const end = trimmed.lastIndexOf("}");
      if (start === -1 || end <= start) {
        setPacket(null);
        setError("That paste is incomplete. It was cut off. Use the will on this phone instead of pasting.");
        return;
      }
      try {
        parsed = parseJson(trimmed.slice(start, end + 1));
      } catch {
        setPacket(null);
        setError("That paste is incomplete. It was cut off. Use the will on this phone instead of pasting.");
        return;
      }
    }
    if (isClaimKey(parsed)) {
      setPacket(null);
      setError("That is an heir key, not the will. Pick the will first. The key goes in the lower box.");
      return;
    }
    if (!isPacket(parsed)) {
      setPacket(null);
      setError("That is not a sealed will.");
      return;
    }
    setError(null);
    setPacket(parsed);
  }

  async function fromChain() {
    setLoading(true);
    setError(null);
    try {
      const address = registry.trim() as Hex;
      if (!address.startsWith("0x") || !willId.trim()) throw new Error("Enter the contract and the will id.");
      usePacket(await loadPacket(address, willId.trim()));
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
      <p className="mt-3 max-w-xl text-sm leading-relaxed text-muted">
        Pick the will. Do not paste it. The paste is long and the phone cuts it off.
      </p>
      {onThisPhone.length > 0 ? (
        <div className="mt-6 flex flex-col gap-2">
          {onThisPhone.map((will) => (
            <Button key={will.packet.id} variant="quiet" onClick={() => usePacket(will.packet)}>
              {will.packet.title}
            </Button>
          ))}
        </div>
      ) : (
        <p className="mt-6 text-sm text-muted">No will is saved on this phone.</p>
      )}
      <div className="mt-8 space-y-2">
        <p className="text-sm text-ivory">Or load it from the contract</p>
        <input
          className={fieldClass}
          value={registry}
          placeholder="Contract address"
          spellCheck={false}
          onChange={(event) => setRegistry(event.target.value)}
        />
        <input
          className={fieldClass}
          value={willId}
          placeholder="Will id"
          spellCheck={false}
          onChange={(event) => setWillId(event.target.value)}
        />
        <Button disabled={loading} onClick={() => void fromChain()}>
          {loading ? "Loading…" : "Load from the chain"}
        </Button>
      </div>
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
