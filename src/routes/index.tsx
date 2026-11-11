import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Button, LinkButton, Pulse, fieldClass } from "@/components/qwill-ui";
import { RestoreForm } from "@/components/restore-form";
import { Shell } from "@/components/shell";
import { b64ToBytes, fromUtf8 } from "@/lib/qwill/bytes";
import { connectQorex, explainChainError, loadRegistry, loadWills, saveRegistry } from "@/lib/qwill/chain";
import { openWithPassword } from "@/lib/qwill/crypto";
import { formatRemain, formatWhen } from "@/lib/qwill/format";
import { deadline, statusLabel, willStatus, type FounderKeyFile } from "@/lib/qwill/protocol";
import { useWills } from "@/lib/qwill/store";

export const Route = createFileRoute("/")({
  component: Desk,
});

function Desk() {
  const wills = useWills((state) => state.wills);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(id);
  }, []);

  return (
    <Shell>
      {wills.length === 0 ? <Empty /> : <List now={now} />}
    </Shell>
  );
}

function Empty() {
  return (
    <div className="max-w-xl">
      <h1 className="font-display text-4xl leading-tight text-ivory sm:text-5xl">
        A will for what they will need later.
      </h1>
      <p className="mt-5 text-base leading-relaxed text-muted">
        Write a letter and a secret. QoreX records the locked letter on the chain when you create it. If you go quiet,
        your heirs open it together. A stolen ordinary key cannot check in, cancel it, or take a share.
      </p>
      <div className="mt-8">
        <LinkButton to="/write">Write a will</LinkButton>
      </div>
      <WalletLoad />
      <details className="mt-12">
        <summary className="text-sm text-muted">Restore a will</summary>
        <RestoreForm />
      </details>
    </div>
  );
}

function List({ now }: { now: number }) {
  const wills = useWills((state) => state.wills);
  return (
    <div>
      <div className="flex items-end justify-between gap-4">
        <h1 className="font-display text-4xl text-ivory">Your wills</h1>
        <LinkButton to="/write">Write</LinkButton>
      </div>
      <WalletLoad />
      <ul className="mt-8 space-y-3">
        {wills.map((will) => {
          const status = willStatus(will.packet, now);
          const due = deadline(will.packet);
          return (
            <li key={will.packet.id}>
              <LinkButton
                to="/wills/$willId"
                params={{ willId: will.packet.id }}
                variant="quiet"
                className="w-full items-start justify-between px-4 py-4 text-left"
              >
                <span className="block">
                  <span className="flex items-center gap-2">
                    <Pulse alive={status === "alive"} />
                    <span className="font-display text-2xl text-ivory">{will.packet.title}</span>
                  </span>
                  <span className="mt-2 block text-sm text-muted">
                    {statusLabel(status)}
                    {status === "alive" ? ` · check in within ${formatRemain(due - now)}` : null}
                    {status === "claimable" ? ` · quiet since ${formatWhen(due)}` : null}
                    {status === "revoked" && will.packet.veto ? ` · ${formatWhen(will.packet.veto.at)}` : null}
                  </span>
                </span>
              </LinkButton>
            </li>
          );
        })}
      </ul>
      <details className="mt-10">
        <summary className="text-sm text-muted">Restore a will</summary>
        <RestoreForm />
      </details>
    </div>
  );
}

function WalletLoad() {
  const locked = useWills((state) => state.locked ?? []);
  const rememberLocked = useWills((state) => state.rememberLocked);
  const upsertWill = useWills((state) => state.upsertWill);
  const [registry, setRegistry] = useState(() => loadRegistry() ?? "");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function connect() {
    setBusy(true);
    setError(null);
    try {
      const account = await connectQorex();
      const address = registry.trim() ? saveRegistry(registry.trim()) : loadRegistry();
      if (!address) throw new Error("Paste the contract address first. The wallet does not remember it.");
      setRegistry(address);
      const found = await loadWills(account, address);
      rememberLocked(found);
      setNote(found.length === 0 ? "This wallet has no letter on that contract." : "Letter found. Type the password.");
    } catch (err) {
      setError(explainChainError(err));
    } finally {
      setBusy(false);
    }
  }

  async function unlock(id: string) {
    const item = locked.find((entry) => entry.packet.id === id);
    if (!item) return;
    setBusy(true);
    setError(null);
    try {
      const founder = JSON.parse(fromUtf8(await openWithPassword(password, b64ToBytes(item.vault)))) as FounderKeyFile;
      if (founder.kind !== "qwill-founder" || founder.willId !== item.packet.id) {
        throw new Error("That password does not open this will.");
      }
      upsertWill({ packet: item.packet, founder, founderRead: null, claimKeys: null, notes: [] });
      setPassword("");
      setNote(null);
    } catch (err) {
      setError(explainChainError(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="mt-10 max-w-xl">
      <h2 className="font-display text-2xl text-ivory">Open a saved will</h2>
      <p className="mt-3 text-sm leading-relaxed text-muted">
        Connect the same QoreX wallet. The locked letter comes back from the contract. The password opens it. Heir keys
        are not in the wallet.
      </p>
      <div className="mt-4 flex flex-col gap-2">
        <input
          className={fieldClass}
          value={registry}
          placeholder="Contract address"
          spellCheck={false}
          onChange={(event) => setRegistry(event.target.value)}
        />
        <Button disabled={busy} onClick={() => void connect()}>
          {busy ? "Working…" : "Connect QoreX and load"}
        </Button>
        {locked.map((item) => (
          <div key={item.packet.id} className="mt-2 flex flex-col gap-2">
            <p className="text-sm text-ivory">{item.packet.title}</p>
            <input
              className={fieldClass}
              type="password"
              value={password}
              placeholder="Password"
              onChange={(event) => setPassword(event.target.value)}
            />
            <Button variant="quiet" disabled={busy || password.length < 8} onClick={() => void unlock(item.packet.id)}>
              Open with password
            </Button>
          </div>
        ))}
        {note ? <p className="text-sm text-muted">{note}</p> : null}
        {error ? <p className="text-sm text-muted">{error}</p> : null}
      </div>
    </section>
  );
}
