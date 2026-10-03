import Link from "next/link";

export function Logo() {
  return (
    <Link href="/" className="flex items-center gap-2.5">
      <span className="grid size-8 -skew-x-12 place-items-center bg-accent font-display text-sm font-black text-accent-ink">
        <span className="skew-x-12">S6</span>
      </span>
      <span className="font-display text-sm font-bold tracking-[0.2em] uppercase">Session Tracker</span>
    </Link>
  );
}
