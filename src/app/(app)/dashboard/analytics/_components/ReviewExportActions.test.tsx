// @vitest-environment happy-dom
/**
 * Client behaviour of the export actions: copy the given text and announce it; the PDF export
 * runs as a checked same-origin request with a pending state, one request at a time, a download
 * only for a real PDF (server filename or safe fallback, object URL revoked), and a visible,
 * localized (ES/EN) alert for every refusal or failure. Responses are mocked: no server here.
 */
import { NextIntlClientProvider } from "next-intl";
import { act } from "react";
import { createRoot, hydrateRoot, type Root } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import en from "@/i18n/messages/en.json";
import es from "@/i18n/messages/es.json";
import { ReviewExportActions } from "./ReviewExportActions";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const props = {
  plainText: "SST — RESUMEN\n1. A.K.I. vs JP",
  pdfHref: "/dashboard/analytics/review.pdf?range=90d&mode=ranked",
};
const PDF_BYTES = new TextEncoder().encode("%PDF-1.7\n%test\n");
const SERVER_NAME = "sst-review-aki-ranked-90d-2026-10-26.pdf";

const pdfResponse = (headers: Record<string, string> = {}, body: BodyInit = PDF_BYTES) =>
  new Response(body, {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${SERVER_NAME}"`,
      "Cache-Control": "private, no-store",
      ...headers,
    },
  });
const refusal = (status: number, body: string, headers: Record<string, string> = {}) =>
  new Response(body, {
    status,
    headers: { "Content-Type": "text/plain; charset=utf-8", ...headers },
  });

let root: Root | null = null;
let host: HTMLDivElement;
let saved: Array<{ href: string; download: string }>;
let created: string[];
let revoked: string[];
beforeEach(() => {
  saved = [];
  created = [];
  revoked = [];
  let n = 0;
  vi.spyOn(URL, "createObjectURL").mockImplementation(() => {
    const url = `blob:sst/${++n}`;
    created.push(url);
    return url;
  });
  vi.spyOn(URL, "revokeObjectURL").mockImplementation((url: string) => void revoked.push(url));
  // The temporary download anchor: record what would be saved instead of navigating.
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (
    this: HTMLAnchorElement,
  ) {
    if (this.href.startsWith("blob:")) saved.push({ href: this.href, download: this.download });
  });
});
afterEach(() => {
  act(() => root?.unmount());
  root = null;
  host?.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

function mount(opts: { html?: string; locale?: "es" | "en" } = {}) {
  const locale = opts.locale ?? "es";
  const tree = (
    <NextIntlClientProvider locale={locale} messages={locale === "es" ? es : en} timeZone="UTC">
      <ReviewExportActions {...props} />
    </NextIntlClientProvider>
  );
  host = document.createElement("div");
  document.body.append(host);
  if (opts.html !== undefined) {
    host.innerHTML = opts.html;
    act(() => {
      root = hydrateRoot(host, tree);
    });
  } else {
    act(() => {
      root = createRoot(host);
      root.render(tree);
    });
  }
  const q = (id: string) => host.querySelector<HTMLElement>(`[data-testid="${id}"]`)!;
  return {
    copy: q("review-copy"),
    pdf: q("review-pdf") as HTMLAnchorElement,
    status: q("review-copy-status"),
    error: q("review-pdf-error"),
  };
}
/** A real user click (the handler lets modified clicks through to the browser). */
const press = (el: HTMLElement, init: MouseEventInit = {}) =>
  act(async () => {
    el.dispatchEvent(
      new MouseEvent("click", { bubbles: true, cancelable: true, button: 0, ...init }),
    );
  });
const stubFetch = (impl: (...args: Parameters<typeof fetch>) => Promise<Response>) => {
  const fn = vi.fn(impl);
  vi.stubGlobal("fetch", fn);
  return fn;
};

describe("copy summary (unchanged)", () => {
  it("copies exactly the plain text and announces it", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    const { copy, status } = mount();
    expect(status.textContent).toBe("");
    await act(async () => copy.click());
    expect(writeText).toHaveBeenCalledWith(props.plainText);
    expect(status.getAttribute("role")).toBe("status");
    expect(status.getAttribute("aria-live")).toBe("polite");
    expect(status.textContent).toBe("Copiado");
    expect(copy.textContent).toBe("Copiado");
  });

  it("clipboard failure → a visible manual-copy message", async () => {
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText: vi.fn().mockRejectedValue(new Error("denied")) },
      configurable: true,
    });
    const { copy, status } = mount();
    await act(async () => copy.click());
    expect(status.textContent).toBe("No se pudo copiar. Abre el resumen y cópialo manualmente.");
    expect(copy.textContent).toBe("Copiar resumen");
  });
});

describe("PDF export", () => {
  it("is still a link to the same route (no client data), with a download fallback", () => {
    const { pdf } = mount();
    expect(pdf.tagName).toBe("A");
    expect(pdf.getAttribute("href")).toBe(props.pdfHref);
    expect(pdf.hasAttribute("download")).toBe(true);
  });

  it("success: same-origin, uncached request; saves the PDF under the server's filename", async () => {
    const fetchFn = stubFetch(async () => pdfResponse());
    const { pdf, status, error } = mount();
    await press(pdf);
    expect(fetchFn).toHaveBeenCalledTimes(1);
    const [url, init] = fetchFn.mock.calls[0]!;
    expect(url).toBe(props.pdfHref);
    expect(init).toMatchObject({ credentials: "same-origin", cache: "no-store" });
    expect(saved).toEqual([{ href: "blob:sst/1", download: SERVER_NAME }]);
    expect(status.textContent).toBe("PDF descargado. Revisa tu carpeta de descargas.");
    expect(error.textContent).toBe("");
    expect(pdf.getAttribute("aria-disabled")).toBeNull();
    expect(pdf.getAttribute("data-state")).toBe("done");
  });

  it.each([
    ["no Content-Disposition", null],
    ["a path in the filename", 'attachment; filename="../../etc/passwd"'],
    ["a non-PDF name", 'attachment; filename="report.html"'],
    ["no filename at all", "attachment"],
  ])("%s ⇒ the safe fallback filename", async (_, disposition) => {
    stubFetch(async () => {
      const r = pdfResponse();
      if (disposition === null) r.headers.delete("Content-Disposition");
      else r.headers.set("Content-Disposition", disposition);
      return r;
    });
    const { pdf } = mount();
    await press(pdf);
    expect(saved).toEqual([{ href: "blob:sst/1", download: "sst-review.pdf" }]);
  });

  it("object URLs are revoked after the download starts, and on unmount", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    stubFetch(async () => pdfResponse());
    const { pdf } = mount();
    await press(pdf);
    expect(created).toEqual(["blob:sst/1"]);
    expect(revoked).toEqual([]);
    act(() => vi.advanceTimersByTime(10_000));
    expect(revoked).toEqual(["blob:sst/1"]);
    await press(pdf);
    act(() => root?.unmount()); // before its timer: revoked on unmount
    root = null;
    expect(revoked).toEqual(["blob:sst/1", "blob:sst/2"]);
  });

  it("pending: visible loading state, announced, and duplicate clicks send nothing", async () => {
    let resolve!: (r: Response) => void;
    const fetchFn = stubFetch(() => new Promise<Response>((r) => (resolve = r)));
    const { pdf, status } = mount();
    await press(pdf);
    expect(pdf.textContent).toBe("Generando PDF…");
    expect(pdf.getAttribute("aria-disabled")).toBe("true");
    expect(pdf.getAttribute("aria-busy")).toBe("true");
    expect(status.textContent).toBe("Generando PDF…");
    await press(pdf);
    await press(pdf);
    expect(fetchFn).toHaveBeenCalledTimes(1);
    await act(async () => resolve(pdfResponse()));
    expect(pdf.textContent).toBe("Descargar PDF");
    expect(pdf.getAttribute("aria-disabled")).toBeNull();
    expect(saved).toHaveLength(1);
  });

  it.each([
    [
      "429 with Retry-After seconds",
      refusal(429, "x", { "Retry-After": "5" }),
      "Has alcanzado el límite de informes PDF. Vuelve a intentarlo en 5 segundos.",
    ],
    [
      "429 with Retry-After minutes",
      refusal(429, "x", { "Retry-After": "540" }),
      "Has alcanzado el límite de informes PDF. Vuelve a intentarlo en 9 minutos.",
    ],
    [
      "429 without Retry-After",
      refusal(429, "x"),
      "Has alcanzado el límite de informes PDF. Espera un poco antes de volver a intentarlo.",
    ],
    [
      "503 capacity",
      refusal(503, "x", { "Retry-After": "5" }),
      "Ahora mismo se están generando otros informes. Vuelve a intentarlo en unos segundos.",
    ],
    [
      "409 no signals",
      refusal(409, "x"),
      "No hay prioridades de revisión para exportar con estos filtros.",
    ],
    [
      "401 signed out",
      refusal(401, "unauthorized"),
      "Tu sesión ha caducado. Vuelve a iniciar sesión para descargar el PDF.",
    ],
    ["500 other", refusal(500, "boom"), "No se pudo generar el PDF. Vuelve a intentarlo."],
    ["404 other", refusal(404, "no player"), "No se pudo generar el PDF. Vuelve a intentarlo."],
  ])("%s → visible localized alert, no download, control usable again", async (_, res, msg) => {
    stubFetch(async () => res);
    const { pdf, error, status } = mount();
    await press(pdf);
    expect(error.getAttribute("role")).toBe("alert");
    expect(error.textContent).toBe(msg);
    expect(pdf.getAttribute("aria-describedby")).toBe("review-pdf-error");
    expect(pdf.getAttribute("aria-disabled")).toBeNull();
    expect(pdf.getAttribute("data-state")).toBe("error");
    expect(status.textContent).toBe("");
    expect(saved).toEqual([]);
    expect(created).toEqual([]);
  });

  it("the server's error body is never rendered (untrusted), not even as text", async () => {
    stubFetch(async () => refusal(500, "<img src=x onerror=alert(1)> SQL: select * from user"));
    const { pdf, error } = mount();
    await press(pdf);
    expect(host.innerHTML).not.toContain("onerror");
    expect(host.textContent).not.toContain("SQL");
    expect(error.textContent).toBe("No se pudo generar el PDF. Vuelve a intentarlo.");
  });

  it("network failure → retryable message and the loading state clears", async () => {
    stubFetch(async () => {
      throw new TypeError("Failed to fetch");
    });
    const { pdf, error } = mount();
    await press(pdf);
    expect(error.textContent).toBe(
      "SST no pudo completar la solicitud. Comprueba tu conexión y vuelve a intentarlo.",
    );
    expect(pdf.textContent).toBe("Descargar PDF");
    expect(pdf.getAttribute("aria-disabled")).toBeNull();
  });

  it.each([
    [
      "an HTML page served with 200",
      pdfResponse({ "Content-Type": "text/html" }, "<html>login</html>"),
    ],
    ["a PDF content type without the PDF signature", pdfResponse({}, "<html>oops</html>")],
    ["an empty PDF", pdfResponse({}, "")],
  ])("%s is never saved as a PDF", async (_, res) => {
    stubFetch(async () => res);
    const { pdf, error } = mount();
    await press(pdf);
    expect(saved).toEqual([]);
    expect(created).toEqual([]);
    expect(error.textContent).toBe(
      "La respuesta no era un PDF válido, así que no se descargó nada. Vuelve a intentarlo.",
    );
  });

  it("a retry clears the previous error and can succeed", async () => {
    const fetchFn = stubFetch(async () => refusal(503, "x"));
    const { pdf, error } = mount();
    await press(pdf);
    expect(error.textContent).not.toBe("");
    fetchFn.mockImplementation(async () => pdfResponse());
    await press(pdf);
    expect(error.textContent).toBe("");
    expect(saved).toHaveLength(1);
  });

  it("English messages", async () => {
    stubFetch(async () => refusal(429, "x", { "Retry-After": "1" }));
    const { pdf, error } = mount({ locale: "en" });
    expect(pdf.textContent).toBe("Download PDF");
    await press(pdf);
    expect(error.textContent).toBe("You have reached the PDF report limit. Try again in 1 second.");
    stubFetch(async () => {
      throw new TypeError("offline");
    });
    await press(pdf);
    expect(error.textContent).toBe(
      "SST could not complete the request. Check your connection and try again.",
    );
  });

  it("keyboard: a focusable link activated with Enter (click), focus kept while pending", async () => {
    let resolve!: (r: Response) => void;
    stubFetch(() => new Promise<Response>((r) => (resolve = r)));
    const { pdf } = mount();
    pdf.focus();
    expect(document.activeElement).toBe(pdf);
    // Browsers turn Enter on a focused link into a click with button 0.
    await press(pdf);
    expect(pdf.getAttribute("aria-busy")).toBe("true");
    expect(document.activeElement).toBe(pdf);
    await act(async () => resolve(pdfResponse()));
    expect(document.activeElement).toBe(pdf);
  });

  it("modified clicks (new tab, save link) keep the browser's native behaviour", async () => {
    const fetchFn = stubFetch(async () => pdfResponse());
    const { pdf } = mount();
    for (const init of [{ ctrlKey: true }, { metaKey: true }, { shiftKey: true }]) {
      const event = new MouseEvent("click", { bubbles: true, cancelable: true, ...init });
      await act(async () => {
        pdf.dispatchEvent(event);
      });
      expect(event.defaultPrevented).toBe(false);
    }
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("unmounting mid-request aborts it and updates nothing", async () => {
    let signal: AbortSignal | undefined;
    stubFetch(
      (_url, init) =>
        new Promise<Response>((_, reject) => {
          signal = init?.signal ?? undefined;
          signal?.addEventListener("abort", () =>
            reject(new DOMException("aborted", "AbortError")),
          );
        }),
    );
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const { pdf } = mount();
    await press(pdf);
    act(() => root?.unmount());
    root = null;
    await act(async () => {});
    expect(signal?.aborted).toBe(true);
    expect(saved).toEqual([]);
    expect(errors).not.toHaveBeenCalled();
  });

  it("60. hydrates the server HTML without errors", () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    mount({
      html: renderToString(
        <NextIntlClientProvider locale="es" messages={es} timeZone="UTC">
          <ReviewExportActions {...props} />
        </NextIntlClientProvider>,
      ),
    });
    expect(errors).not.toHaveBeenCalled();
  });
});
