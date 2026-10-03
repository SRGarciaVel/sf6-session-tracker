"use server";

import { cookies } from "next/headers";
import { fail, ok, type ActionResult } from "@/lib/action-result";
import { getCurrentUser } from "@/server/auth/session";
import { getDb } from "@/server/db/client";
import { setUserLocale } from "@/server/users/locale";
import { LOCALE_COOKIE, LOCALE_COOKIE_MAX_AGE, isLocale } from "./locale";

/**
 * Explicit language choice: stored in a long-lived cookie (survives logout / browser restart) and,
 * when signed in, on the account (follows the user to other browsers).
 */
export async function setLocaleAction(locale: string): Promise<ActionResult> {
  if (!isLocale(locale)) return fail("invalid locale");
  (await cookies()).set(LOCALE_COOKIE, locale, {
    path: "/",
    maxAge: LOCALE_COOKIE_MAX_AGE,
    sameSite: "lax",
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
  });
  const user = await getCurrentUser();
  if (user) await setUserLocale(getDb(), user.id, locale);
  return ok(undefined);
}
