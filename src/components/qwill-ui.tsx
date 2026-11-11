import { Link } from "@tanstack/react-router";
import { cn } from "@/lib/cn";
import type { Verdict } from "@/lib/qwill/protocol";

const button =
  "inline-flex min-h-11 items-center justify-center rounded-md px-4 text-center text-sm font-medium transition-opacity duration-200 disabled:cursor-not-allowed disabled:opacity-50";

export function buttonClass(variant: "primary" | "quiet" | "ghost" = "primary") {
  return cn(
    button,
    variant === "primary" && "bg-pulse text-ink hover:opacity-90",
    variant === "quiet" && "border border-line bg-panel text-ivory hover:border-pulse",
    variant === "ghost" && "px-0 text-muted hover:text-ivory",
  );
}

export function Button({
  variant = "primary",
  className,
  type = "button",
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "quiet" | "ghost" }) {
  return <button type={type} className={cn(buttonClass(variant), className)} {...props} />;
}

export function LinkButton({
  to,
  params,
  variant = "primary",
  children,
  className,
}: {
  to: "/write" | "/claim" | "/" | "/wills/$willId" | "/wills/$willId/rehearse";
  params?: { willId: string };
  variant?: "primary" | "quiet" | "ghost";
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <Link to={to} params={params} className={cn(buttonClass(variant), className)}>
      {children}
    </Link>
  );
}

export const fieldClass =
  "w-full rounded-md border border-line bg-ink-2 px-3 py-3 text-base text-ivory placeholder:text-muted focus:border-pulse focus:outline-none";

export function Pulse({ alive }: { alive: boolean }) {
  return (
    <span
      className={cn("inline-block size-2.5 rounded-full", alive ? "pulse-live bg-pulse" : "bg-line")}
      aria-hidden
    />
  );
}

export function VerdictCard({ verdict }: { verdict: Verdict | null }) {
  if (!verdict) return null;
  if (verdict.oldLockOpens) {
    return (
      <div className="grid gap-3 sm:grid-cols-2">
        <article className="rounded-lg border border-line bg-panel p-4">
          <p className="text-sm text-muted">Ordinary signature</p>
          <p className="mt-2 font-display text-3xl text-ivory">Opens</p>
          <p className="mt-2 text-sm leading-relaxed text-muted">
            The signature verifies. A stolen key can produce it.
          </p>
        </article>
        <article className="rounded-lg border border-pulse bg-ink-2 p-4">
          <p className="text-sm text-pulse">QWILL</p>
          <p className="mt-2 font-display text-3xl text-ivory">Stays shut</p>
          <p className="mt-2 text-sm leading-relaxed text-muted">{verdict.detail}</p>
        </article>
      </div>
    );
  }
  return (
    <article className="rounded-lg border border-line bg-panel p-4">
      <p className="font-display text-2xl text-ivory">{verdict.title}</p>
      <p className="mt-2 text-sm leading-relaxed text-muted">{verdict.detail}</p>
    </article>
  );
}

export function Notice({ children }: { children: React.ReactNode }) {
  return <p className="rounded-md border border-line bg-panel px-3 py-3 text-sm leading-relaxed text-ivory">{children}</p>;
}
