import { eq } from "drizzle-orm";
import type { Locale } from "@/i18n/locale";
import { isLocale } from "@/i18n/locale";
import type { DbExecutor } from "@/server/db/client";
import { authUser } from "@/server/db/schema";

/** Persist the user's explicit UI language. Presentation only — touches nothing else. */
export async function setUserLocale(db: DbExecutor, userId: string, locale: Locale): Promise<void> {
  await db.update(authUser).set({ locale }).where(eq(authUser.id, userId));
}

export async function getUserLocale(db: DbExecutor, userId: string): Promise<Locale | null> {
  const [row] = await db
    .select({ locale: authUser.locale })
    .from(authUser)
    .where(eq(authUser.id, userId))
    .limit(1);
  return isLocale(row?.locale) ? row.locale : null;
}
