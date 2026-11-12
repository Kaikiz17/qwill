import { useState } from "react";
import { Button, Notice, VerdictCard, fieldClass } from "@/components/qwill-ui";
import { readFile } from "@/lib/qwill/format";
import {
  isClaimKey,
  parseJson,
  presentShare,
  reveal,
  willStatus,
  type ClaimKeyFile,
  type PlainWill,
  type SealedPacket,
  type Verdict,
} from "@/lib/qwill/protocol";

export function Ceremony({
  packet,
  now,
  keys,
}: {
  packet: SealedPacket;
  now: number;
  keys: ClaimKeyFile[];
}) {
  const [shares, setShares] = useState<{ heirId: string; name: string; raw: Uint8Array }[]>([]);
  const [plain, setPlain] = useState<PlainWill | null>(null);
  const [verdict, setVerdict] = useState<Verdict | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [paste, setPaste] = useState("");
  const status = willStatus(packet, now);

  function clearRoom() {
    setShares([]);
    setPlain(null);
    setVerdict(null);
    setError(null);
  }

  async function add(claim: ClaimKeyFile, kind: "pq" | "classical") {
    setBusy(true);
    setError(null);
    try {
      const result = await presentShare(packet, claim, now, kind);
      setVerdict(result.verdict);
      if (!result.share) return;
      setShares((current) => {
        const next = current.some((share) => share.heirId === claim.heirId)
          ? current
          : [...current, { heirId: claim.heirId, name: claim.name, raw: result.share! }];
        if (next.length >= packet.threshold) {
          void reveal(
            packet,
            next.map((share) => share.raw),
          )
            .then(setPlain)
            .catch(() => {
              setPlain(null);
              setError("Those shares do not open this will.");
            });
        } else {
          setPlain(null);
        }
        return next;
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not use that key.");
    } finally {
      setBusy(false);
    }
  }

  function addPasted(kind: "pq" | "classical") {
    try {
      const parsed = parseJson(paste);
      if (!isClaimKey(parsed)) {
        setError("That is not a claim key.");
        return;
      }
      void add(parsed, kind);
    } catch {
      setError("That claim key could not be read.");
    }
  }

  if (status === "revoked") {
    return <Notice>This will was cancelled. It will not open.</Notice>;
  }

  if (status === "alive") {
    return <Notice>Heirs cannot open this while the check-ins are still on time.</Notice>;
  }

  const present = new Set(shares.map((share) => share.heirId));

  return (
    <div className="space-y-4">
      <p className="text-sm leading-relaxed text-muted">
        {shares.length} of {packet.threshold} heirs on this phone. One person is not enough.
      </p>
      {keys.length > 0 ? (
        <div className="flex flex-col gap-2">
          {keys.map((key) => (
            <Button
              key={key.heirId}
              variant="quiet"
              disabled={busy || present.has(key.heirId)}
              onClick={() => void add(key, "pq")}
            >
              {present.has(key.heirId) ? `${key.name} is here` : `Add ${key.name}`}
            </Button>
          ))}
        </div>
      ) : (
        <p className="text-sm text-muted">Paste the key that heir was given.</p>
      )}
      <label className="block">
        <span className="mb-2 block text-sm text-ivory">One heir key</span>
        <textarea
          className={fieldClass}
          rows={4}
          value={paste}
          placeholder="Paste one key. Not two."
          onChange={(event) => setPaste(event.target.value)}
        />
      </label>
      <div className="flex flex-col gap-2 sm:flex-row">
        <Button disabled={busy || paste.trim().length === 0} onClick={() => addPasted("pq")}>
          Add this heir
        </Button>
        <Button variant="quiet" disabled={busy || paste.trim().length === 0} onClick={() => addPasted("classical")}>
          Try their ordinary key
        </Button>
        <label className={buttonClassQuiet()}>
          Load a key file
          <input
            type="file"
            accept="application/json,.json"
            className="sr-only"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (!file) return;
              void readFile(file).then((text) => setPaste(text));
            }}
          />
        </label>
      </div>
      {error ? <Notice>{error}</Notice> : null}
      <VerdictCard verdict={verdict} />
      {plain ? (
        <article className="rounded-lg border border-pulse bg-ink-2 p-5">
          <p className="text-sm text-muted">Letter</p>
          <p className="mt-3 whitespace-pre-wrap font-display text-xl leading-relaxed text-ivory">{plain.letter}</p>
          <p className="mt-6 text-sm text-muted">Secret</p>
          <p className="mt-2 whitespace-pre-wrap break-words text-ivory">{plain.secret}</p>
          <Button className="mt-5" variant="quiet" onClick={clearRoom}>
            Hide this
          </Button>
        </article>
      ) : null}
    </div>
  );
}

function buttonClassQuiet() {
  return "inline-flex min-h-11 cursor-pointer items-center justify-center rounded-md border border-line bg-panel px-4 text-sm font-medium text-ivory";
}
