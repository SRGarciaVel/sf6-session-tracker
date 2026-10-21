import { hydrateRoot } from "react-dom/client";
import { Root } from "./Root";

declare global {
  interface Window {
    /** Read by qa.mts: any hydration mismatch React reports while hydrating the SSR markup. */
    __fsHydrationErrors: string[];
  }
}

window.__fsHydrationErrors = [];
const container = document.getElementById("root");
if (container) {
  hydrateRoot(container, <Root locale={document.documentElement.lang === "en" ? "en" : "es"} />, {
    onRecoverableError: (error) => window.__fsHydrationErrors.push(String(error)),
  });
  document.documentElement.dataset.hydrated = "true";
}
