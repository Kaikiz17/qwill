import { Link } from "@tanstack/react-router";
import { useEffect } from "react";
import { useWills } from "@/lib/qwill/store";

export function Shell({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    void Promise.resolve(useWills.persist.rehydrate());
  }, []);

  return (
    <div className="min-h-dvh bg-ink text-ivory">
      <header className="border-b border-line">
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-4 px-5 py-4">
          <Link to="/" className="font-display text-2xl tracking-tight text-ivory">
            QWILL
          </Link>
          <nav className="flex items-center gap-5 text-sm">
            <Link to="/" className="text-muted hover:text-ivory">
              Desk
            </Link>
            <Link to="/claim" className="text-muted hover:text-ivory">
              Claim
            </Link>
          </nav>
        </div>
      </header>
      <main className="mx-auto w-full max-w-3xl px-5 py-8">{children}</main>
      <footer className="mx-auto max-w-3xl px-5 pb-12 text-sm text-muted">
        Your will stays on this device unless you export it.
      </footer>
    </div>
  );
}
