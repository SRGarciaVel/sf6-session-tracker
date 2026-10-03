import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode } from "react";

export function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
type ButtonSize = "sm" | "md" | "lg";

/** Styles live in globals.css (.btn*): notched, rectangular, wipe-on-hover. */
export function buttonClass(variant: ButtonVariant = "secondary", size: ButtonSize = "md"): string {
  return `btn btn-${variant} btn-${size}`;
}

export function Button({
  variant = "secondary",
  size = "md",
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant; size?: ButtonSize }) {
  return <button type="button" className={cx(buttonClass(variant, size), className)} {...props} />;
}

/** Notched HUD panel with an optional SF6-style section heading. */
export function Panel({
  title,
  action,
  children,
  className,
  bodyClassName,
}: {
  title?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
}) {
  return (
    <section className={cx("hud-panel", className)}>
      {(title || action) && (
        <header className="flex items-center gap-4 px-5 pt-4">
          {title && <h2 className="hud-heading flex-1">{title}</h2>}
          {action}
        </header>
      )}
      <div className={cx("p-5", bodyClassName)}>{children}</div>
    </section>
  );
}

export function Label({ htmlFor, children }: { htmlFor?: string; children: ReactNode }) {
  return (
    <label htmlFor={htmlFor} className="hud-label mb-1.5 block">
      {children}
    </label>
  );
}

export function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={cx(
        "h-11 w-full border border-line-strong bg-surface-2 px-3 text-sm text-text",
        "transition-[border-color,box-shadow] duration-150 placeholder:text-faint",
        "focus:border-cyan focus:shadow-[inset_0_-2px_0_var(--color-cyan)] focus:outline-none",
        "disabled:opacity-50",
        className,
      )}
      {...props}
    />
  );
}

type Tone = "neutral" | "win" | "loss" | "accent" | "warn" | "info";
const TONES: Record<Tone, string> = {
  neutral: "bg-surface-3 text-muted",
  win: "bg-win/15 text-win",
  loss: "bg-loss/15 text-loss",
  accent: "bg-magenta/15 text-magenta",
  warn: "bg-warn/15 text-warn",
  info: "bg-info/15 text-info",
};

export function Badge({
  tone = "neutral",
  children,
  className,
}: {
  tone?: Tone;
  children: ReactNode;
  className?: string;
}) {
  return <span className={cx("hud-tag", TONES[tone], className)}>{children}</span>;
}

export function Dot({ tone }: { tone: "win" | "loss" | "warn" | "neutral" | "accent" }) {
  const color = {
    win: "bg-win",
    loss: "bg-loss",
    warn: "bg-warn shadow-[0_0_8px_var(--color-warn)]",
    neutral: "bg-faint",
    accent: "bg-magenta",
  }[tone];
  return <span aria-hidden className={cx("inline-block size-2 rounded-full", color)} />;
}

/** "● LIVE" — the only continuously animated element, and a very soft one. */
export function LiveIndicator({ label }: { label: string }) {
  return (
    <span className="inline-flex items-center gap-2 font-display text-sm font-bold tracking-[0.12em] text-win uppercase">
      <span className="live-dot" aria-hidden />
      {label}
    </span>
  );
}

export function ErrorText({ children }: { children: ReactNode }) {
  if (!children) return null;
  return (
    <p role="alert" className="border-l-2 border-loss pl-3 text-sm text-loss">
      {children}
    </p>
  );
}
