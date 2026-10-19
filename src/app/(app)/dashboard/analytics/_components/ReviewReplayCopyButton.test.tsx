// @vitest-environment happy-dom
/** Copy ONE Replay ID: exactly the id, announced in a polite live region; hydrates cleanly. */
import { act } from "react";
import { createRoot, hydrateRoot, type Root } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ReviewReplayCopyButton } from "./ReviewReplayCopyButton";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const props = {
  replayId: "VGPTB9UCN",
  labels: {
    copy: "Copiar ID",
    copied: "Copiado",
    failed: "No se pudo copiar",
    aria: "Copiar Replay ID VGPTB9UCN",
  },
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
      root = hydrateRoot(host, <ReviewReplayCopyButton {...props} />);
    });
  } else {
    act(() => {
      root = createRoot(host);
      root.render(<ReviewReplayCopyButton {...props} />);
    });
  }
  return {
    button: host.querySelector<HTMLButtonElement>('[data-testid="replay-copy"]')!,
    status: host.querySelector<HTMLElement>('[role="status"]')!,
  };
}

describe("ReviewReplayCopyButton", () => {
  it("copies exactly the Replay ID (nothing prepended) and announces it", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    const { button, status } = mount();
    expect(button.tagName).toBe("BUTTON");
    expect(button.getAttribute("aria-label")).toBe("Copiar Replay ID VGPTB9UCN");
    await act(async () => button.click());
    expect(writeText).toHaveBeenCalledTimes(1);
    expect(writeText).toHaveBeenCalledWith("VGPTB9UCN");
    expect(button.textContent).toBe("Copiado");
    expect(status.getAttribute("aria-live")).toBe("polite");
    expect(status.textContent).toBe("Copiado");
  });

  it("clipboard failure → 'Copy failed'", async () => {
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText: vi.fn().mockRejectedValue(new Error("denied")) },
      configurable: true,
    });
    const { button, status } = mount();
    await act(async () => button.click());
    expect(button.textContent).toBe("No se pudo copiar");
    expect(status.textContent).toBe("No se pudo copiar");
  });

  it("hydrates the server HTML without errors", () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    mount(renderToString(<ReviewReplayCopyButton {...props} />));
    expect(errors).not.toHaveBeenCalled();
  });
});
