import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { ChainRecord } from "@/components/chain-record";
import { Button, LinkButton, Notice, Pulse, VerdictCard, fieldClass } from "@/components/qwill-ui";
import { cancelOnChain, checkInOnChain, connectQorex, explainChainError, loadRegistry, proveAccess, sealedLine } from "@/lib/qwill/chain";
import { copyText, downloadJson, formatRemain, formatWhen } from "@/lib/qwill/format";
import {
  INTERVALS,
  cancelWill,
  checkIn,
  deadline,
  readAsFounder,
  statusLabel,
  willStatus,
  type PlainWill,
  type StoredWill,
  type Verdict,
} from "@/lib/qwill/protocol";
import { peekClaimKeys, useWills } from "@/lib/qwill/store";

export const Route = createFileRoute("/wills/$willId/")({
  component: WillPage,
});

function WillPage() {
  const { willId } = Route.useParams();
  const will = useWills((state) => state.wills.find((item) => item.packet.id === willId));
  if (!will) return <Missing />;
  return <WillView will={will} />;
}

function Missing() {
  return (
    <div>
      <h1 className="font-display text-4xl text-ivory">This will is not on this device.</h1>
      <p className="mt-3 text-sm text-muted">Restore it with the sealed file and the founder key.</p>
      <div className="mt-6">
        <LinkButton to="/">Back to the desk</LinkButton>
      </div>
    </div>
  );
}

function WillView({ will }: { will: StoredWill }) {
  const navigate = useNavigate();
  const upsertWill = useWills((state) => state.upsertWill);
  const removeWill = useWills((state) => state.removeWill);
  const [now, setNow] = useState(() => Date.now());
  const [busy, setBusy] = useState(false);
  const [verdict, setVerdict] = useState<Verdict | null>(null);
  const [plain, setPlain] = useState<PlainWill | null>(null);
  const [readError, setReadError] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [copyFallback, setCopyFallback] = useState<string | null>(null);
  const [armRemove, setArmRemove] = useState(false);
  const [unlocked, setUnlocked] = useState(false);
  const [gatePassword, setGatePassword] = useState("");
  const [gateError, setGateError] = useState<string | null>(null);

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    if (will.registry) return;
    const saved = loadRegistry();
    if (saved) upsertWill({ ...will, registry: saved });
  }, [will, upsertWill]);

  const status = willStatus(will.packet, now);
  const due = deadline(will.packet);
  const keys = will.claimKeys ?? peekClaimKeys(will.packet.id);
  const interval =
    INTERVALS.find((item) => item.ms === will.packet.intervalMs)?.label ?? formatRemain(will.packet.intervalMs);

  async function run(action: "beat" | "cancel") {
    setBusy(true);
    setVerdict(null);
    try {
      const account = await connectQorex();
      const registry = will.registry ? (will.registry as `0x${string}`) : loadRegistry();
      if (!registry) throw new Error("This will is not on the chain yet.");
      const at = Date.now();
      if (action === "beat") await checkInOnChain(will, account, registry, at);
      else await cancelOnChain(will, account, registry, at);
      const result = action === "beat" ? await checkIn(will, at, "pq") : await cancelWill(will, at, "pq");
      upsertWill({ ...result.will, registry });
      setVerdict(result.verdict);
    } catch (err) {
      setVerdict({
        ok: false,
        oldLockOpens: false,
        title: "Not signed",
        detail: explainChainError(err),
      });
    } finally {
      setBusy(false);
    }
  }

  async function unlock() {
    setBusy(true);
    setGateError(null);
    try {
      const registry = will.registry ? (will.registry as `0x${string}`) : loadRegistry();
      if (!registry) throw new Error("This will is not on the chain yet.");
      await proveAccess(will, gatePassword, registry);
      setUnlocked(true);
      setGatePassword("");
    } catch (err) {
      setGateError(explainChainError(err));
    } finally {
      setBusy(false);
    }
  }

  async function shareJson(id: string, value: unknown) {
    const text = typeof value === "string" ? value : JSON.stringify(value, null, 2);
    try {
      await copyText(text);
      setCopyFallback(null);
      setCopied(id);
      window.setTimeout(() => setCopied(null), 2000);
    } catch {
      setCopied(null);
      setCopyFallback(text);
    }
  }

  async function read() {
    setReadError(null);
    if (plain) {
      setPlain(null);
      return;
    }
    try {
      setPlain(await readAsFounder(will));
    } catch (err) {
      setReadError(err instanceof Error ? err.message : "Could not read the will.");
    }
  }

  const names = will.packet.heirs.map((heir) => heir.name);
  const who =
    names.length === 2 ? `${names[0]} and ${names[1]}` : `${names.slice(0, -1).join(", ")}, and ${names.at(-1)}`;

  return (
    <article>
      <LinkButton to="/" variant="ghost">
        Back to the desk
      </LinkButton>
      <header className="mt-4">
        <div className="flex items-center gap-3">
          <Pulse alive={status === "alive"} />
          <p className="text-sm text-muted">{statusLabel(status)}</p>
        </div>
        <h1 className="mt-2 font-display text-4xl text-ivory">{will.packet.title}</h1>
        <p className="mt-4 max-w-xl text-sm leading-relaxed text-muted">
          Opens if {will.packet.threshold} of {who} come together, after {interval} without a check-in.
        </p>
      </header>

      <section className="mt-8 rounded-lg border border-line bg-panel p-5">
        {status === "alive" ? (
          <>
            <p className="font-display text-2xl text-ivory">Check in within {formatRemain(due - now)}</p>
            <p className="mt-2 text-sm text-muted">Before {formatWhen(due)}. Silence after that wakes the will.</p>
            <Button className="mt-5" disabled={busy} onClick={() => void run("beat")}>
              {busy ? "Waiting on QoreX…" : "Check in"}
            </Button>
          </>
        ) : null}
        {status === "claimable" ? (
          <>
            <p className="font-display text-2xl text-ivory">You have been quiet.</p>
            <p className="mt-2 text-sm leading-relaxed text-muted">
              The window passed on {formatWhen(due)}. Heirs can open this. A check-in seals it again. Cancelling ends it
              for good.
            </p>
            <div className="mt-5 flex flex-col gap-2 sm:flex-row">
              <Button disabled={busy} onClick={() => void run("beat")}>
                Check in — I am here
              </Button>
              <Button variant="quiet" disabled={busy} onClick={() => void run("cancel")}>
                Cancel the will
              </Button>
            </div>
          </>
        ) : null}
        {status === "revoked" ? (
          <p className="font-display text-2xl text-ivory">
            Cancelled{will.packet.veto ? ` on ${formatWhen(will.packet.veto.at)}` : ""}.
          </p>
        ) : null}
      </section>

      {verdict ? (
        <div className="mt-4">
          <VerdictCard verdict={verdict} />
        </div>
      ) : null}

      <section className="mt-10">
        <h2 className="font-display text-2xl text-ivory">Heirs</h2>
        <ul className="mt-4 divide-y divide-line border-y border-line">
          {will.packet.heirs.map((heir) => (
            <li key={heir.id} className="flex items-center justify-between gap-3 py-3">
              <span className="text-ivory">{heir.name}</span>
              {unlocked && keys?.some((key) => key.heirId === heir.id) ? (
                <span className="flex gap-2">
                  <Button
                    variant="ghost"
                    onClick={() => {
                      const key = keys.find((item) => item.heirId === heir.id);
                      if (!key) return;
                      void shareJson(heir.id, key);
                    }}
                  >
                    {copied === heir.id ? "Copied" : "Copy key"}
                  </Button>
                  <Button
                    variant="ghost"
                    onClick={() => {
                      const key = keys.find((item) => item.heirId === heir.id);
                      if (!key) return;
                      downloadJson(`${heir.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}.claim.json`, key);
                    }}
                  >
                    Download
                  </Button>
                </span>
              ) : (
                <span className="text-sm text-muted">{unlocked ? "Key not on this device" : "Locked"}</span>
              )}
            </li>
          ))}
        </ul>
        <p className="mt-3 text-sm leading-relaxed text-muted">
          Give each heir their key. If the only copy is lost, that heir cannot bring their share.
        </p>
      </section>

      <section className="mt-10">
        <h2 className="font-display text-2xl text-ivory">Letter</h2>
        <div className="mt-4">
          {unlocked ? (
            <div className="flex flex-col gap-2 sm:flex-row">
              <Button variant="quiet" onClick={() => void read()}>
                {plain ? "Hide the letter" : "Read what you sealed"}
              </Button>
              <Button
                variant="quiet"
                onClick={() => void shareJson("packet", sealedLine(will.registry ?? loadRegistry() ?? "", will.packet.id, will.sealKey))}
              >
                {copied === "packet" ? "Copied" : "Copy sealed will"}
              </Button>
            </div>
          ) : (
            <form
              className="max-w-xl space-y-3"
              onSubmit={(event) => {
                event.preventDefault();
                void unlock();
              }}
            >
              <p className="text-sm leading-relaxed text-muted">
                The letter and the heir keys stay hidden. Enter the password, then sign with QoreX. Closing the page locks them again.
              </p>
              <input
                className={fieldClass}
                type="password"
                value={gatePassword}
                autoComplete="current-password"
                placeholder="Password"
                onChange={(event) => setGatePassword(event.target.value)}
              />
              <Button type="submit" disabled={busy || gatePassword.trim().length < 8}>
                {busy ? "Waiting on QoreX…" : "Sign and unlock"}
              </Button>
              {gateError ? <Notice>{gateError}</Notice> : null}
            </form>
          )}
          {copyFallback ? (
            <textarea className={`${fieldClass} mt-4`} rows={6} readOnly value={copyFallback} onFocus={(event) => event.target.select()} />
          ) : null}
          {readError ? (
            <div className="mt-3">
              <Notice>{readError}</Notice>
            </div>
          ) : null}
          {unlocked && plain ? (
            <article className="mt-4 rounded-lg border border-line bg-ink-2 p-5">
              <p className="whitespace-pre-wrap font-display text-xl leading-relaxed text-ivory">{plain.letter}</p>
              <p className="mt-6 text-sm text-muted">Secret</p>
              <p className="mt-2 whitespace-pre-wrap break-words text-ivory">{plain.secret}</p>
            </article>
          ) : null}
        </div>
      </section>

      <ChainRecord will={will} keys={unlocked ? (keys ?? []) : []} />

      <details className="mt-10">
        <summary className="text-sm text-muted">Founder key and record</summary>
        <section className="mt-6">
          <div className="flex flex-col gap-2 sm:flex-row">
            {unlocked ? (
              <>
                <Button variant="quiet" onClick={() => void shareJson("founder", will.founder)}>
                  {copied === "founder" ? "Copied" : "Copy founder key"}
                </Button>
                <Button variant="quiet" onClick={() => downloadJson("founder.qwill-key.json", will.founder)}>
                  Download founder key
                </Button>
              </>
            ) : (
              <p className="text-sm text-muted">Sign and unlock before copying a key.</p>
            )}
          </div>
        </section>
        <section className="mt-8">
          <ul className="space-y-2 text-sm text-muted">
            <li>Sealed {formatWhen(will.packet.createdAt)}</li>
            {will.packet.beats
              .filter((beat) => beat.at !== will.packet.createdAt)
              .map((beat) => (
                <li key={beat.at}>Checked in {formatWhen(beat.at)}</li>
              ))}
            {will.packet.veto ? <li>Cancelled {formatWhen(will.packet.veto.at)}</li> : null}
          </ul>
        </section>
      </details>

      <section className="mt-12 border-t border-line pt-6">
        {armRemove ? (
          <div className="space-y-3">
            <p className="text-sm text-muted">Removed from this device only. Files you already exported still exist.</p>
            <div className="flex gap-2">
              <Button
                variant="quiet"
                onClick={() => {
                  removeWill(will.packet.id);
                  void navigate({ to: "/" });
                }}
              >
                Remove
              </Button>
              <Button variant="ghost" onClick={() => setArmRemove(false)}>
                Keep it
              </Button>
            </div>
          </div>
        ) : (
          <Button variant="ghost" onClick={() => setArmRemove(true)}>
            Remove from this device
          </Button>
        )}
      </section>
    </article>
  );
}
