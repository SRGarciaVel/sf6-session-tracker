import Link from "next/link";

/** Wordmark: slanted tag + condensed name. Original mark, no official assets. */
export function Logo() {
  return (
    <Link href="/" aria-label="SF6 Session Tracker" className="group flex items-center gap-3">
      <span
        aria-hidden
        className="grid h-8 w-11 place-items-center bg-accent font-display text-base font-extrabold text-white [clip-path:polygon(8px_0,100%_0,calc(100%-8px)_100%,0_100%)] transition-colors group-hover:bg-accent-strong"
      >
        S6
      </span>
      <span className="hidden font-display text-lg leading-none font-bold tracking-[0.08em] uppercase sm:inline">
        Session<span className="text-cyan">/</span>Tracker
      </span>
    </Link>
  );
}
