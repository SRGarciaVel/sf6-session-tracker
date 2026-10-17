// @vitest-environment happy-dom
/**
 * Client behaviour of the export actions: copy the given text, announce "Copied" (or the manual
 * fallback) in a live region, hydrate the server HTML without mismatch.
 */
import { act } from "react";
import { createRoot, hydrateRoot, type Root } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ReviewExportActions } from "./ReviewExportActions";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const labels = {
  copy: "Copiar resumen",
  copied: "Copiado",
  copyFailed: "No se pudo copiar",
  download: "Descargar PDF",
};
const props = {
  plainText: "SST — RESUMEN\n1. A.K.I. vs JP",
  pdfHref: "/dashboard/analytics/review.pdf?range=90d&mode=ranked",
  labels,
};

let root: Root | null = null;
let host: HTMLDivElement;
afterEach(() => {
  act(() => root?.unmount());
  root = null;
  host?.remove();
  vi.restoreAllMocks();
});

function mount(html?: string) {
  host = document.createElement("div");
  document.body.append(host);
  if (html !== undefined) {
    host.innerHTML = html;
    act(() => {
      root = hydrateRoot(host, <ReviewExportActions {...props} />);
    });
  } else {
    act(() => {
      root = createRoot(host);
      root.render(<ReviewExportActions {...props} />);
    });
  }
  const q = (id: string) => host.querySelector<HTMLElement>(`[data-testid="${id}"]`)!;
  return { copy: q("review-copy"), pdf: q("review-pdf"), status: q("review-copy-status") };
}

describe("ReviewExportActions", () => {
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
    expect(status.textContent).toBe("No se pudo copiar");
    expect(copy.textContent).toBe("Copiar resumen");
  });

  it("the download link is a plain link to the route (no client data)", () => {
    const { pdf } = mount();
    expect(pdf.tagName).toBe("A");
    expect(pdf.getAttribute("href")).toBe(props.pdfHref);
    expect(pdf.hasAttribute("download")).toBe(true);
  });

  it("60. hydrates the server HTML without errors", () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    mount(renderToString(<ReviewExportActions {...props} />));
    expect(errors).not.toHaveBeenCalled();
  });
});
