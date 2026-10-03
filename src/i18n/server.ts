import { cookies } from "next/headers";
import { cache } from "react";
import { getCurrentUser } from "@/server/auth/session";
import { LOCALE_COOKIE, resolveLocale, type Locale } from "./locale";

/** UI locale for this request: account preference → cookie → default ("es"). */
export const getRequestLocale = cache(async (): Promise<Locale> => {
  const cookieLocale = (await cookies()).get(LOCALE_COOKIE)?.value ?? null;
  const user = await getCurrentUser().catch(() => null);
  return resolveLocale({ userLocale: user?.locale ?? null, cookieLocale });
});
