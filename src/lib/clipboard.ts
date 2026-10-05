/**
 * Copy-to-clipboard with feedback, shared by every copy button (pairing code, overlay URLs,
 * browser addresses). The controller is framework-free (unit tested with fake timers); the hook
 * wires it to React. One reset timer at a time: repeated clicks restart it, never stack it.
 */
import { useEffect, useRef, useState } from "react";

export type CopyStatus = "idle" | "copied" | "failed";

export const COPY_FEEDBACK_MS = 2_000;

export interface CopyTimers {
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

export interface ClipboardDeps {
  /** navigator.clipboard.writeText when available (secure contexts). */
  writeText?: (text: string) => Promise<void>;
  /** Legacy fallback (hidden textarea + execCommand); returns false when it did not copy. */
  legacyCopy?: (text: string) => boolean;
}

export async function copyText(text: string, deps: ClipboardDeps): Promise<boolean> {
  if (deps.writeText) {
    try {
      await deps.writeText(text);
      return true;
    } catch {
      // Permission denied / not focused: try the legacy path below.
    }
  }
  try {
    return deps.legacyCopy ? deps.legacyCopy(text) : false;
  } catch {
    return false;
  }
}

export function createCopyController(options: {
  onChange: (status: CopyStatus) => void;
  deps: ClipboardDeps;
  resetMs?: number;
  timers?: CopyTimers;
}) {
  const timers: CopyTimers = options.timers ?? {
    setTimeout: (fn, ms) => globalThis.setTimeout(fn, ms),
    clearTimeout: (h) => globalThis.clearTimeout(h as ReturnType<typeof setTimeout>),
  };
  let handle: unknown = null;
  let disposed = false;

  const clear = () => {
    if (handle !== null) timers.clearTimeout(handle);
    handle = null;
  };

  return {
    async copy(text: string): Promise<boolean> {
      const ok = await copyText(text, options.deps);
      if (disposed) return ok;
      clear();
      options.onChange(ok ? "copied" : "failed");
      handle = timers.setTimeout(() => {
        handle = null;
        if (!disposed) options.onChange("idle");
      }, options.resetMs ?? COPY_FEEDBACK_MS);
      return ok;
    },
    dispose() {
      disposed = true;
      clear();
    },
  };
}

function browserDeps(): ClipboardDeps {
  const clipboard = typeof navigator !== "undefined" ? navigator.clipboard : undefined;
  return {
    writeText: clipboard?.writeText ? (text) => clipboard.writeText(text) : undefined,
    legacyCopy: (text) => {
      const el = document.createElement("textarea");
      el.value = text;
      el.setAttribute("readonly", "");
      el.style.position = "fixed";
      el.style.opacity = "0";
      document.body.appendChild(el);
      el.select();
      // Deprecated but still the only path on insecure origins (http://LAN-ip during setup).
      const ok = document.execCommand("copy");
      el.remove();
      return ok;
    },
  };
}

/** `[status, copy]`: status returns to "idle" after COPY_FEEDBACK_MS. */
export function useCopyToClipboard(
  resetMs = COPY_FEEDBACK_MS,
): [CopyStatus, (text: string) => Promise<boolean>] {
  const [status, setStatus] = useState<CopyStatus>("idle");
  const controller = useRef<ReturnType<typeof createCopyController> | null>(null);
  useEffect(() => {
    const c = createCopyController({ onChange: setStatus, deps: browserDeps(), resetMs });
    controller.current = c;
    return () => c.dispose();
  }, [resetMs]);
  const copy = (text: string) => controller.current?.copy(text) ?? Promise.resolve(false);
  return [status, copy];
}
