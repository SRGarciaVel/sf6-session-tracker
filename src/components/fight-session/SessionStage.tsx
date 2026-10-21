import type { ReactNode } from "react";
import { cx } from "@/components/ui/primitives";

/**
 * The one hero surface per screen (Prepare, Live or Recap). `ghost` draws the character name as
 * an outlined typographic backdrop (type, never character artwork); the magenta slash repeats the
 * monogram's cut. Both are decorative and hidden from assistive technology.
 */
export function SessionStage({
  children,
  ghost,
  labelledBy,
  id,
  className,
}: {
  children: ReactNode;
  ghost?: string | null;
  /** Anchor (e.g. `session`, the target of «Preparar nueva sesión» links). */
  id?: string;
  /** id of the stage heading (the stage is a landmark-free region when omitted). */
  labelledBy?: string;
  className?: string;
}) {
  return (
    <section
      id={id}
      aria-labelledby={labelledBy}
      className={cx("fs-stage grid gap-6 p-5 sm:p-9", className)}
    >
      {ghost && (
        <span className="fs-ghost" aria-hidden>
          {ghost}
        </span>
      )}
      <span className="fs-slash" aria-hidden />
      {children}
    </section>
  );
}
