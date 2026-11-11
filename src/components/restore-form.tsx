import { useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { Button, Notice, fieldClass } from "@/components/qwill-ui";
import { readFile } from "@/lib/qwill/format";
import { isFounderKey, isPacket, parseJson, restoreWill } from "@/lib/qwill/protocol";
import { useWills } from "@/lib/qwill/store";

export function RestoreForm() {
  const navigate = useNavigate();
  const wills = useWills((state) => state.wills);
  const upsertWill = useWills((state) => state.upsertWill);
  const [packetText, setPacketText] = useState("");
  const [keyText, setKeyText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onRestore() {
    setBusy(true);
    setError(null);
    try {
      const packet = parseJson(packetText);
      const founder = parseJson(keyText);
      if (!isPacket(packet)) throw new Error("That is not a sealed will.");
      if (!isFounderKey(founder)) throw new Error("That is not a founder key.");
      const existing = wills.find((will) => will.packet.id === packet.id);
      const restored = await restoreWill(packet, founder, Date.now(), existing);
      upsertWill(restored);
      void navigate({ to: "/wills/$willId", params: { willId: restored.packet.id } });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not restore that will.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-4 space-y-4">
      <p className="text-sm leading-relaxed text-muted">
        Bring back a will with the sealed file and the founder key. Check-ins work again. The letter stays sealed on a
        device that did not write it.
      </p>
      <FileField label="Sealed will" value={packetText} onChange={setPacketText} />
      <FileField label="Founder key" value={keyText} onChange={setKeyText} />
      {error ? <Notice>{error}</Notice> : null}
      <Button disabled={busy || !packetText.trim() || !keyText.trim()} onClick={() => void onRestore()}>
        {busy ? "Restoring…" : "Restore"}
      </Button>
    </div>
  );
}

function FileField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="block">
      <span className="mb-2 flex items-center justify-between gap-3 text-sm text-ivory">
        {label}
        <span className="inline-flex min-h-11 cursor-pointer items-center text-muted">
          Load file
          <input
            type="file"
            accept="application/json,.json"
            className="sr-only"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (!file) return;
              void readFile(file).then(onChange);
            }}
          />
        </span>
      </span>
      <textarea
        className={fieldClass}
        rows={4}
        value={value}
        placeholder="Or paste the file"
        onChange={(event) => onChange(event.target.value)}
      />
    </label>
  );
}
