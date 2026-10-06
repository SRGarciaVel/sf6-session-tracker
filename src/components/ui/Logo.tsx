import Link from "next/link";
import {
  BRAND_FULL_NAME,
  BRAND_NAME,
  BrandMark,
  type BrandSize,
} from "@/components/brand/BrandMark";

/**
 * Header brand link (Phase 4.8). Inline SVG, no image requests, nothing to shift.
 *   variant="responsive" (default): monogram on mobile, full lockup from `sm` (640 px) up —
 *     landing, auth, onboarding, help.
 *   variant="compact": monogram only — dashboard chrome, where workspace comes first.
 * The link's accessible name is the brand name; the marks themselves are decorative.
 */
export function Logo({
  size = "md",
  variant = "responsive",
}: {
  size?: Exclude<BrandSize, "sm">;
  variant?: "responsive" | "compact";
}) {
  return (
    <Link
      href="/"
      aria-label={`${BRAND_NAME} | ${BRAND_FULL_NAME}`}
      className="flex shrink-0 items-center transition-opacity hover:opacity-90"
    >
      {variant === "responsive" ? (
        <>
          <BrandMark variant="monogram" size="sm" className="sm:hidden" />
          <BrandMark variant="lockup" size={size} className="hidden sm:flex" />
        </>
      ) : (
        <BrandMark variant="monogram" size={size} />
      )}
    </Link>
  );
}
