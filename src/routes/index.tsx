import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Button, LinkButton, Pulse, fieldClass } from "@/components/qwill-ui";
import { Shell } from "@/components/shell";
import { connectQorex, explainChainError, loadRegistry, openWillsWithPassword, saveRegistry } from "@/lib/qwill/chain";
import { formatRemain, formatWhen } from "@/lib/qwill/format";
import { deadline, statusLabel, willStatus } from "@/lib/qwill/protocol";
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
        Write a letter and a secret. QoreX records it on the chain, locked, so the name is not readable there. If you go
        quiet, your heirs open it together with the sealed will and their keys.
      </p>
      <div className="mt-8">
        <LinkButton to="/write">Write a will</LinkButton>
      </div>
      <details className="mt-12">
        <summary className="text-sm text-muted">This phone is new</summary>
        <WalletLoad />
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
        <summary className="text-sm text-muted">Load a will onto this phone</summary>
        <WalletLoad />
      </details>
    </div>
  );
}

function WalletLoad() {
  const navigate = useNavigate();
  const upsertWill = useWills((state) => state.upsertWill);
  const [registry, setRegistry] = useState(() => loadRegistry() ?? "");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function open() {
    setBusy(true);
    setError(null);
    try {
      if (password.trim().length < 8) throw new Error("Enter the password.");
      const account = await connectQorex();
      const address = registry.trim() ? saveRegistry(registry.trim()) : loadRegistry();
      if (!address) throw new Error("Paste the contract address first.");
      setRegistry(address);
      const opened = await openWillsWithPassword(account, address, password.trim());
      if (opened.length === 0) throw new Error("That password does not open a will on this contract.");
      for (const will of opened) upsertWill(will);
      setPassword("");
      if (opened.length === 1) {
        void navigate({ to: "/wills/$willId", params: { willId: opened[0].packet.id } });
      }
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
        Connect the wallet and enter the password. If this wallet holds more than one will, the password opens the right one.
      </p>
      <form
        className="mt-4 flex flex-col gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          void open();
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
          type="password"
          value={password}
          autoComplete="current-password"
          placeholder="Password"
          onChange={(event) => setPassword(event.target.value)}
        />
        <Button type="submit" disabled={busy || password.trim().length < 8}>
          {busy ? "Opening…" : "Connect and open"}
        </Button>
        {error ? <p className="text-sm text-muted">{error}</p> : null}
      </form>
    </section>
  );
}
