/** next-intl request config: resolves the UI locale for server components and actions. */
import { getRequestConfig } from "next-intl/server";
import { getAppMessages } from "./messages";
import { getRequestLocale } from "./server";

export default getRequestConfig(async () => {
  const locale = await getRequestLocale();
  return { locale, messages: getAppMessages(locale) };
});
