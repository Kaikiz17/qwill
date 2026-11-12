import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState, type FormEvent } from "react";
import { Button, LinkButton, Notice, fieldClass } from "@/components/qwill-ui";
import { Shell } from "@/components/shell";
import {
  connectQorex,
  ensureRegistry,
  explainChainError,
  readWill,
  sealOnChain,
} from "@/lib/qwill/chain";
import { INTERVALS, sealWill, type IntervalId } from "@/lib/qwill/protocol";
import { holdClaimKeys, useWills } from "@/lib/qwill/store";
import type { Hex } from "viem";

export const Route = createFileRoute("/write")({
  component: WritePage,
});

function WritePage() {
  return (
    <Shell>
      <WriteForm />
    </Shell>
  );
}

function WriteForm() {
  const navigate = useNavigate();
  const upsertWill = useWills((state) => state.upsertWill);
  const [title, setTitle] = useState("");
  const [letter, setLetter] = useState("");
  const [secret, setSecret] = useState("");
  const [names, setNames] = useState(["", "", ""]);
  const [threshold, setThreshold] = useState(2);
  const [interval, setInterval] = useState<IntervalId>("30");
  const [keep, setKeep] = useState(true);
  const [account, setAccount] = useState<Hex | null>(null);
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const filled = names.map((name) => name.trim()).filter(Boolean);
  const heirCount = Math.max(names.length, 1);
  const need = Math.min(threshold, names.length);

  function setName(index: number, value: string) {
    setNames((current) => current.map((name, i) => (i === index ? value : name)));
  }

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    if (!title.trim()) return setError("Give the will a name.");
    if (!letter.trim()) return setError("Write the letter.");
    if (!secret.trim()) return setError("Put a secret in it. A seed, a location, a sentence.");
    if (password.trim().length < 8) return setError("Choose a password of at least 8 characters. A new phone needs it.");
    if (!account) return setError("Connect QoreX first. A will is recorded on the chain as it is created.");
    if (filled.length < 2) return setError("Name at least two heirs. One person should not be able to open this alone.");
    if (new Set(filled.map((name) => name.toLowerCase())).size !== filled.length) {
      return setError("Each heir needs their own name.");
    }
    const chosen = INTERVALS.find((item) => item.id === interval)!;
    const nextThreshold = Math.min(Math.max(need, 2), filled.length);
    setBusy(true);
    try {
      const { will, claimKeys } = await sealWill({
        title,
        letter: letter.trim(),
        secret: secret.trim(),
        heirNames: filled,
        threshold: nextThreshold,
        intervalMs: chosen.ms,
        keepClaimKeys: keep,
        now: Date.now(),
      });
      const registry = await ensureRegistry(account);
      await sealOnChain(will, account, registry, password.trim());
      const recorded = await readWill(registry, will.packet.id);
      if (!recorded.exists) throw new Error("The chain did not keep this will. It was not created.");
      holdClaimKeys(will.packet.id, claimKeys);
      upsertWill({ ...will, registry });
      void navigate({ to: "/wills/$willId", params: { willId: will.packet.id } });
    } catch (err) {
      setError(explainChainError(err));
      setBusy(false);
    }
  }

  return (
    <form onSubmit={(event) => void onSubmit(event)} className="space-y-8">
      <div>
        <LinkButton to="/" variant="ghost">
          Back to the desk
        </LinkButton>
        <h1 className="mt-4 font-display text-4xl text-ivory">Write a will</h1>
        <p className="mt-3 max-w-xl text-sm leading-relaxed text-muted">
          QoreX signs it, and the locked letter goes on the chain as soon as you create it. It does not sit only on this
          phone. Heirs still need the keys you give them, and they need each other.
        </p>
        <Notice>
          Before you create it, open the EVM window in the QoreX app. Set the spending cap to 20 QOR and allow 20
          transactions. Creating the will is one approval. If QoreX refuses, the will is not created.
        </Notice>
      </div>

      <div className="flex flex-col gap-2">
        <Button
          type="button"
          disabled={busy}
          onClick={() =>
            void connectQorex()
              .then(setAccount)
              .catch((err: unknown) => setError(explainChainError(err)))
          }
        >
          {account ? "QoreX connected" : "Connect QoreX"}
        </Button>
        {account ? <p className="break-all text-sm text-muted">{account}</p> : null}
      </div>

      {!account ? (
        error ? <Notice>{error}</Notice> : null
      ) : (
        <>
      <label className="block">
        <span className="mb-2 block text-sm text-ivory">Name</span>
        <input className={fieldClass} value={title} maxLength={80} placeholder="For my sister" onChange={(event) => setTitle(event.target.value)} />
      </label>

      <label className="block">
        <span className="mb-2 block text-sm text-ivory">Letter</span>
        <textarea
          className={fieldClass}
          rows={5}
          value={letter}
          placeholder="What you want them to know."
          onChange={(event) => setLetter(event.target.value)}
        />
      </label>

      <label className="block">
        <span className="mb-2 block text-sm text-ivory">Secret</span>
        <textarea
          className={fieldClass}
          rows={3}
          value={secret}
          placeholder="A seed phrase, a box, a sentence."
          onChange={(event) => setSecret(event.target.value)}
        />
        <span className="mt-2 block text-sm text-muted">This is not a place that moves real bitcoin. It seals the words.</span>
      </label>

      <fieldset>
        <legend className="text-sm text-ivory">Heirs</legend>
        <div className="mt-3 space-y-2">
          {names.map((name, index) => (
            <div key={index} className="flex gap-2">
              <input
                className={fieldClass}
                value={name}
                maxLength={40}
                placeholder={index === 0 ? "Sister" : index === 1 ? "Brother" : "Friend"}
                onChange={(event) => setName(index, event.target.value)}
              />
              {names.length > 2 ? (
                <Button
                  variant="quiet"
                  onClick={() => {
                    setNames((current) => current.filter((_, i) => i !== index));
                    setThreshold((current) => Math.min(current, names.length - 1));
                  }}
                >
                  Remove
                </Button>
              ) : null}
            </div>
          ))}
        </div>
        {names.length < 5 ? (
          <Button className="mt-3" variant="ghost" onClick={() => setNames((current) => [...current, ""])}>
            Add an heir
          </Button>
        ) : (
          <p className="mt-3 text-sm text-muted">Five is the most this will can name.</p>
        )}
      </fieldset>

      <fieldset>
        <legend className="text-sm text-ivory">How many must come together</legend>
        <p className="mt-2 text-sm text-muted">
          {Math.min(Math.max(threshold, 2), heirCount)} of {names.length}. One heir alone gets nothing they can use.
        </p>
        {names.length > 2 ? (
          <div className="mt-3 flex gap-2">
            <Button variant="quiet" onClick={() => setThreshold((current) => Math.max(2, current - 1))}>
              Fewer
            </Button>
            <Button variant="quiet" onClick={() => setThreshold((current) => Math.min(names.length, current + 1))}>
              More
            </Button>
          </div>
        ) : null}
      </fieldset>

      <fieldset>
        <legend className="text-sm text-ivory">Check in every</legend>
        <div className="mt-3 grid grid-cols-3 gap-2">
          {INTERVALS.map((item) => (
            <Button key={item.id} variant={interval === item.id ? "primary" : "quiet"} onClick={() => setInterval(item.id)}>
              {item.label}
            </Button>
          ))}
        </div>
      </fieldset>

      <label className="flex items-start gap-3">
        <input
          type="checkbox"
          className="mt-1 size-4 accent-pulse"
          checked={keep}
          onChange={(event) => setKeep(event.target.checked)}
        />
        <span>
          <span className="block text-sm text-ivory">Keep heir keys on this device</span>
          <span className="mt-1 block text-sm leading-relaxed text-muted">
            So you can rehearse an opening here. Turn this off if heirs will use their own phones. You can still
            download each key once.
          </span>
        </span>
      </label>

      <label className="block">
        <span className="mb-2 block text-sm text-ivory">Password</span>
        <input
          className={fieldClass}
          type="password"
          value={password}
          autoComplete="new-password"
          placeholder="At least 8 characters"
          onChange={(event) => setPassword(event.target.value)}
        />
        <span className="mt-2 block text-sm text-muted">
          A new phone asks for this after you connect the same wallet. QoreX does not store it.
        </span>
      </label>

      {error ? <Notice>{error}</Notice> : null}

      <Button type="submit" disabled={busy || password.trim().length < 8}>
        {busy ? "Waiting on QoreX…" : "Create the will"}
      </Button>
        </>
      )}
    </form>
  );
}
