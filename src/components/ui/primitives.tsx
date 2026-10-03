import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode } from "react";

export function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
type ButtonSize = "sm" | "md" | "lg";

const VARIANTS: Record<ButtonVariant, string> = {
  primary:
    "bg-accent text-accent-ink hover:bg-accent-strong font-semibold shadow-[0_0_0_1px_rgb(255_176_32/0.4),0_8px_24px_-12px_rgb(255_176_32/0.6)]",
  secondary: "bg-surface-3 text-text hover:bg-line-strong border border-line-strong",
  ghost: "text-muted hover:text-text hover:bg-surface-3",
  danger: "bg-transparent text-loss border border-loss/40 hover:bg-loss/10",
};

const SIZES: Record<ButtonSize, string> = {
  sm: "h-8 px-3 text-xs gap-1.5",
  md: "h-10 px-4 text-sm gap-2",
  lg: "h-12 px-6 text-base gap-2",
};

export function buttonClass(variant: ButtonVariant = "secondary", size: ButtonSize = "md"): string {
  return cx(
    "inline-flex items-center justify-center rounded-md font-medium transition-colors duration-150",
    "disabled:opacity-50 disabled:pointer-events-none select-none whitespace-nowrap",
    VARIANTS[variant],
    SIZES[size],
  );
}

export function Button({
  variant = "secondary",
  size = "md",
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant; size?: ButtonSize }) {
  return <button type="button" className={cx(buttonClass(variant, size), className)} {...props} />;
}

export function Panel({
  title,
  action,
  children,
  className,
}: {
  title?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={cx("rounded-xl border border-line bg-surface", className)}>
      {(title || action) && (
        <header className="flex items-center justify-between gap-4 border-b border-line px-5 py-3">
          {title && (
            <h2 className="font-display text-xs font-semibold tracking-[0.18em] text-muted uppercase">
              {title}
            </h2>
          )}
          {action}
        </header>
      )}
      <div className="p-5">{children}</div>
    </section>
  );
}

export function Label({ htmlFor, children }: { htmlFor?: string; children: ReactNode }) {
  return (
    <label htmlFor={htmlFor} className="mb-1.5 block text-xs font-medium tracking-wide text-muted">
      {children}
    </label>
  );
}

export function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={cx(
        "h-11 w-full rounded-md border border-line-strong bg-surface-2 px-3 text-sm text-text",
        "placeholder:text-faint focus:border-accent focus:outline-none",
        className,
      )}
      {...props}
    />
  );
}

type Tone = "neutral" | "win" | "loss" | "accent" | "warn" | "info";
const TONES: Record<Tone, string> = {
  neutral: "bg-surface-3 text-muted border-line-strong",
  win: "bg-win/10 text-win border-win/30",
  loss: "bg-loss/10 text-loss border-loss/30",
  accent: "bg-accent/10 text-accent border-accent/30",
  warn: "bg-warn/10 text-warn border-warn/30",
  info: "bg-info/10 text-info border-info/30",
};

export function Badge({ tone = "neutral", children, className }: { tone?: Tone; children: ReactNode; className?: string }) {
  return (
    <span
      className={cx(
        "inline-flex items-center gap-1.5 rounded border px-2 py-0.5 text-[11px] font-semibold tracking-wide uppercase",
        TONES[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

export function Dot({ tone }: { tone: "win" | "loss" | "warn" | "neutral" | "accent" }) {
  const color = {
    win: "bg-win",
    loss: "bg-loss",
    warn: "bg-warn",
    neutral: "bg-faint",
    accent: "bg-accent",
  }[tone];
  return <span aria-hidden className={cx("inline-block size-2 rounded-full", color)} />;
}

export function ErrorText({ children }: { children: ReactNode }) {
  if (!children) return null;
  return (
    <p role="alert" className="text-sm text-loss">
      {children}
    </p>
  );
}
