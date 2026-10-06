"use client";

/** Small form controls shared by the overlay builder sections. */
import { useTranslations } from "next-intl";
import { useState, type ReactNode } from "react";
import { cx } from "@/components/ui/primitives";

export function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-3 border-b border-line px-5 py-4 last:border-b-0">
      <h3 className="hud-heading">{title}</h3>
      {children}
    </section>
  );
}

/** A titled group inside a section (no extra box: a label and a divider-free stack). */
export function Group({
  title,
  tag,
  children,
}: {
  title: string;
  /** Optional small tag next to the title (e.g. "Creator"). */
  tag?: ReactNode;
  children: ReactNode;
}) {
  return (
    <fieldset className="min-w-0 space-y-3">
      <legend className="mb-2 flex items-center gap-2 font-display text-xs font-semibold tracking-[0.14em] text-muted uppercase">
        {title}
        {tag}
      </legend>
      {children}
    </fieldset>
  );
}

/** Native select styled like the other inputs. */
export const selectClass =
  "h-9 w-full border border-line-strong bg-surface-2 px-2.5 text-sm focus:border-cyan focus:outline-none";

export function Segmented<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: Array<{ value: T; label: string; disabled?: boolean }>;
  onChange: (v: T) => void;
}) {
  return (
    <div className="inline-flex flex-wrap border-b border-line-strong" role="radiogroup">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          disabled={o.disabled}
          onClick={() => onChange(o.value)}
          className={cx(
            "relative px-3 py-1.5 font-display text-sm font-semibold tracking-[0.05em] uppercase transition-colors disabled:cursor-not-allowed disabled:opacity-40",
            "after:absolute after:inset-x-1 after:-bottom-px after:h-0.5 after:bg-cyan after:transition-transform after:duration-200",
            value === o.value
              ? "bg-cyan/8 text-text after:scale-x-100 after:shadow-[0_0_8px_var(--color-cyan)]"
              : "text-muted after:scale-x-0 hover:text-text",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Toggle({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
}) {
  return (
    <label className="flex cursor-pointer items-center justify-between gap-3 text-sm">
      <span>{label}</span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={cx(
          "relative h-5 w-10 border transition-colors [clip-path:polygon(4px_0,100%_0,calc(100%-4px)_100%,0_100%)]",
          checked ? "border-cyan bg-cyan/25" : "border-line-strong bg-surface-2",
        )}
      >
        <span
          className={cx(
            "absolute top-[3px] left-0 h-3 w-4 transition-transform duration-150",
            checked ? "translate-x-5 bg-cyan" : "translate-x-1 bg-muted",
          )}
        />
      </button>
    </label>
  );
}

export function Slider({
  label,
  value,
  min,
  max,
  step,
  format,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  format: (v: number) => string;
  onChange: (v: number) => void;
}) {
  return (
    <label className="block text-sm">
      <span className="mb-1.5 flex justify-between">
        <span>{label}</span>
        <span className="font-mono text-xs text-muted tabular">{format(value)}</span>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full accent-[var(--color-cyan)]"
      />
    </label>
  );
}

export function ColorField({
  label,
  value,
  onChange,
  resetTo,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  /** The theme's own value; shows a reset button while the colour differs from it. */
  resetTo?: string;
}) {
  const t = useTranslations("Builder");
  const [draft, setDraft] = useState(value);
  const [prev, setPrev] = useState(value);
  if (value !== prev) {
    setPrev(value);
    setDraft(value);
  }
  return (
    <label className="flex items-center justify-between gap-3 text-sm">
      <span>{label}</span>
      <span className="flex items-center gap-2">
        <input
          value={draft}
          onChange={(e) => {
            setDraft(e.target.value);
            if (/^#[0-9a-fA-F]{6}$/.test(e.target.value)) onChange(e.target.value.toLowerCase());
          }}
          className="h-8 w-20 border border-line-strong bg-surface-2 px-2 font-mono text-xs uppercase focus:border-cyan focus:outline-none"
          aria-label={t("hexAria", { label })}
          maxLength={7}
        />
        <input
          type="color"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="size-8 cursor-pointer border border-line-strong bg-transparent"
          aria-label={label}
        />
        {resetTo !== undefined && (
          <button
            type="button"
            onClick={() => onChange(resetTo)}
            disabled={value.toLowerCase() === resetTo.toLowerCase()}
            aria-label={t("resetColorAria", { label })}
            title={t("resetColorAria", { label })}
            className="grid size-8 place-items-center border border-line text-muted hover:border-line-strong hover:text-text focus-visible:border-cyan focus-visible:outline-none disabled:invisible"
          >
            <span aria-hidden>↺</span>
          </button>
        )}
      </span>
    </label>
  );
}
