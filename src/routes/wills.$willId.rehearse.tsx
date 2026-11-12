import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState, type FormEvent } from "react";
import { Ceremony } from "@/components/ceremony";
import { Button, LinkButton, Notice, Pulse, VerdictCard, fieldClass } from "@/components/qwill-ui";
import { explainChainError, loadRegistry, proveAccess } from "@/lib/qwill/chain";
import { formatWhen } from "@/lib/qwill/format";
import {
  cancelWill,
  checkIn,
  deadline,
  statusLabel,
  willStatus,
  type StoredWill,
  type Verdict,
} from "@/lib/qwill/protocol";
import { peekClaimKeys, useWills, type Drill } from "@/lib/qwill/store";

export const Route = createFileRoute("/wills/$willId/rehearse")({
  component: RehearsePage,
});

function RehearsePage() {
  const { willId } = Route.useParams();
  const live = useWills((state) => state.wills.find((item) => item.packet.id === willId));
  const drill = useWills((state) => state.drills[willId]);
  const saveDrill = useWills((state) => state.saveDrill);
  const clearDrill = useWills((state) => state.clearDrill);

  useEffect(() => {
    if (!live || drill) return;
    saveDrill(willId, { will: structuredClone(live), virtualNow: Date.now() });
  }, [live, drill, saveDrill, willId]);

  return !live ? (
    <Missing />
  ) : !drill ? (
    <p className="text-muted">Preparing the rehearsal…</p>
  ) : (
    <Rehearse
      live={live}
      drill={drill}
      onChange={(next) => saveDrill(willId, next)}
      onReset={() => {
        clearDrill(willId);
        saveDrill(willId, { will: structuredClone(live), virtualNow: Date.now() });
      }}
    />
  );
}

function Missing() {
  return (
    <div>
      <h1 className="font-display text-4xl text-ivory">Nothing to rehearse.</h1>
      <div className="mt-6">
        <LinkButton to="/">Back to the desk</LinkButton>
      </div>
    </div>
  );
}

function Rehearse({
  live,
  drill,
  onChange,
  onReset,
}: {
  live: StoredWill;
  drill: Drill;
  onChange: (drill: Drill) => void;
  onReset: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [verdict, setVerdict] = useState<Verdict | null>(null);
  const [unlocked, setUnlocked] = useState(false);
  const [gatePassword, setGatePassword] = useState("");
  const [gateError, setGateError] = useState<string | null>(null);
  const status = willStatus(drill.will.packet, drill.virtualNow);
  const due = deadline(drill.will.packet);
  const keys = drill.will.claimKeys ?? live.claimKeys ?? peekClaimKeys(live.packet.id) ?? [];

  async function act(action: "beat" | "cancel", kind: "pq" | "classical") {
    setBusy(true);
    try {
      const at = Math.max(drill.virtualNow, deadline(drill.will.packet) > drill.virtualNow ? drill.virtualNow : drill.virtualNow);
      const stamp = Math.max(at, drill.will.packet.beats.reduce((max, beat) => Math.max(max, beat.at), 0) + 1);
      const result =
        action === "beat"
          ? await checkIn(drill.will, stamp, kind)
          : await cancelWill(drill.will, stamp, kind);
      onChange({ will: result.will, virtualNow: stamp });
      setVerdict(result.verdict);
    } finally {
      setBusy(false);
    }
  }

  function letItPass() {
    const next = deadline(drill.will.packet) + 60_000;
    onChange({ ...drill, virtualNow: next });
    setVerdict(null);
  }

  if (!unlocked) {
    return (
      <article>
        <LinkButton to="/wills/$willId" params={{ willId: live.packet.id }} variant="ghost">
          Back to the will
        </LinkButton>
        <h1 className="mt-4 font-display text-4xl text-ivory">Rehearse</h1>
        <form
          className="mt-6 max-w-xl space-y-3"
          onSubmit={(event: FormEvent) => {
            event.preventDefault();
            setBusy(true);
            setGateError(null);
            const registry = live.registry ? (live.registry as `0x${string}`) : loadRegistry();
            void (registry
              ? proveAccess(live, gatePassword, registry)
              : Promise.reject(new Error("This will is not on the chain yet."))
            )
              .then(() => {
                setUnlocked(true);
                setGatePassword("");
              })
              .catch((err: unknown) => setGateError(explainChainError(err)))
              .finally(() => setBusy(false));
          }}
        >
          <p className="text-sm leading-relaxed text-muted">Sign with QoreX before this copy can use the heir keys.</p>
          <input
            className={fieldClass}
            type="password"
            value={gatePassword}
            placeholder="Password"
            onChange={(event) => setGatePassword(event.target.value)}
          />
          <Button type="submit" disabled={busy || gatePassword.trim().length < 8}>
            {busy ? "Waiting on QoreX…" : "Sign and unlock"}
          </Button>
          {gateError ? <Notice>{gateError}</Notice> : null}
        </form>
      </article>
    );
  }

  return (
    <article>
      <LinkButton to="/wills/$willId" params={{ willId: live.packet.id }} variant="ghost">
        Back to the will
      </LinkButton>
      <h1 className="mt-4 font-display text-4xl text-ivory">Rehearse</h1>
      <p className="mt-3 max-w-xl text-sm leading-relaxed text-muted">
        This is a copy of {live.packet.title}. You can skip ahead in time. The will on your desk keeps its real clock.
      </p>

      <section className="mt-8 rounded-lg border border-line bg-panel p-5">
        <div className="flex items-center gap-3">
          <Pulse alive={status === "alive"} />
          <p className="text-sm text-muted">{statusLabel(status)}</p>
        </div>
        <p className="mt-3 font-display text-2xl text-ivory">Rehearsal date {formatWhen(drill.virtualNow)}</p>
        <p className="mt-2 text-sm text-muted">
          {status === "alive" ? `The copy goes quiet on ${formatWhen(due)}.` : null}
          {status === "claimable" ? "The copy is quiet. Heirs can open it." : null}
          {status === "revoked" ? "The copy is cancelled." : null}
        </p>
        <div className="mt-5 flex flex-col gap-2 sm:flex-row">
          <Button variant="quiet" disabled={status !== "alive"} onClick={letItPass}>
            Let the window pass
          </Button>
          <Button disabled={busy || status === "revoked"} onClick={() => void act("beat", "pq")}>
            Check in on the copy
          </Button>
        </div>
      </section>

      <section className="mt-8">
        <h2 className="font-display text-2xl text-ivory">Stolen ordinary key</h2>
        <div className="mt-4 flex flex-col gap-2 sm:flex-row">
          <Button variant="quiet" disabled={busy || status === "revoked"} onClick={() => void act("beat", "classical")}>
            Tries to check in
          </Button>
          <Button variant="quiet" disabled={busy || status === "revoked"} onClick={() => void act("cancel", "classical")}>
            Tries to cancel
          </Button>
        </div>
        <div className="mt-4">
          <VerdictCard verdict={verdict} />
        </div>
      </section>

      <section className="mt-10">
        <h2 className="font-display text-2xl text-ivory">Heirs on the copy</h2>
        <div className="mt-4">
          {keys.length === 0 ? (
            <Notice>Heir keys were not kept on this device, so this rehearsal cannot open the letter. A stolen key can still be tried.</Notice>
          ) : (
            <Ceremony packet={drill.will.packet} now={drill.virtualNow} keys={keys} />
          )}
        </div>
      </section>

      <div className="mt-10">
        <Button variant="ghost" onClick={onReset}>
          Reset the rehearsal
        </Button>
      </div>
    </article>
  );
}
