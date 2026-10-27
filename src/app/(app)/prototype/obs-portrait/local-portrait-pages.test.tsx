// @vitest-environment happy-dom
/**
 * PROTOTYPE — the dock and the Browser Source pages with a real (fake-indexeddb) IndexedDB:
 * loading / empty / saved preview / invalid file / storage error states, replace and delete,
 * the source reading the dock's image through its own object URL, change notification, no
 * network request, ES/EN rights reminder, and the production gate. Real OBS is NOT exercised
 * here (see design/phase-m2/local-portrait-prototype.md).
 */
import { Blob as NodeBlob, File as NodeFile } from "node:buffer";
import { IDBFactory } from "fake-indexeddb";
import { NextIntlClientProvider } from "next-intl";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import en from "@/i18n/messages/en.json";
import es from "@/i18n/messages/es.json";
import { saveLocalPortrait } from "@/lib/local-portrait/store";
import type { ImageDecoder } from "@/lib/local-portrait/validate";
import { prototypePagesEnabled } from "@/server/prototypes/gate";
import { LocalPortraitSource } from "../../../(overlay)/prototype/obs-portrait/source/LocalPortraitSource";
import { LocalPortraitDock } from "./dock/LocalPortraitDock";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 1, 2, 3, 4];
const JPEG = [0xff, 0xd8, 0xff, 0xe0, 0, 16, 1, 2, 3, 4];
const pick = (data: number[], name: string, type: string) =>
  new NodeFile([new Uint8Array(data)], name, { type }) as unknown as File;
const decode: ImageDecoder = async () => ({ width: 128, height: 128 });

let root: Root | null = null;
let host: HTMLDivElement;
let created: string[];
let revoked: string[];
let fetchSpy: ReturnType<typeof vi.fn>;
beforeEach(() => {
  // Node's Blob/File: the ones IndexedDB (structured clone) can store in this environment.
  vi.stubGlobal("Blob", NodeBlob);
  vi.stubGlobal("File", NodeFile);
  created = [];
  revoked = [];
  let n = 0;
  vi.spyOn(URL, "createObjectURL").mockImplementation(() => {
    const url = `blob:proto/${++n}`;
    created.push(url);
    return url;
  });
  vi.spyOn(URL, "revokeObjectURL").mockImplementation((u: string) => void revoked.push(u));
  fetchSpy = vi.fn();
  vi.stubGlobal("fetch", fetchSpy);
});
afterEach(() => {
  act(() => root?.unmount());
  root = null;
  host?.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function mount(node: React.ReactNode, locale: "es" | "en" = "en") {
  host = document.createElement("div");
  document.body.append(host);
  act(() => {
    root = createRoot(host);
    root.render(
      <NextIntlClientProvider locale={locale} messages={locale === "es" ? es : en} timeZone="UTC">
        {node}
      </NextIntlClientProvider>,
    );
  });
  const q = (id: string) => host.querySelector<HTMLElement>(`[data-testid="${id}"]`);
  return { q, status: () => q("status") };
}
const settle = () => act(async () => new Promise((r) => setTimeout(r, 30)));
async function choose(input: HTMLElement | null, f: File) {
  const el = input as HTMLInputElement;
  Object.defineProperty(el, "files", { value: [f], configurable: true });
  await act(async () => el.dispatchEvent(new Event("change", { bubbles: true })));
  await settle();
}

describe("dock page", () => {
  it("loading → empty; a valid image is saved, previewed with its real type and size", async () => {
    const factory = new IDBFactory();
    const d = mount(
      <LocalPortraitDock
        sourcePath="/prototype/obs-portrait/source"
        factory={factory}
        decode={decode}
      />,
    );
    expect(d.status()?.dataset.state).toBe("loading");
    await settle();
    expect(d.status()?.textContent).toBe("No image saved.");
    expect(d.q("preview")?.dataset.state).toBe("empty");

    // Claims to be WebP: the bytes say PNG, and PNG is what is stored and shown.
    await choose(d.q("file"), pick(PNG, "me.webp", "image/webp"));
    expect(d.status()?.dataset.state).toBe("saved");
    expect(d.status()?.textContent).toBe("Image saved in this browser.");
    expect(d.q("preview")?.dataset.state).toBe("image");
    expect(d.q("preview")?.querySelector("img")?.getAttribute("src")).toBe("blob:proto/1");
    expect(d.q("meta")?.textContent).toMatch(/^PNG · 0 KB · 128 × 128 px · saved /);
    expect(fetchSpy).not.toHaveBeenCalled(); // nothing is uploaded
  });

  it("replace swaps the image (old object URL revoked); delete empties it", async () => {
    const factory = new IDBFactory();
    const d = mount(<LocalPortraitDock sourcePath="/s" factory={factory} decode={decode} />);
    await settle();
    await choose(d.q("file"), pick(PNG, "a.png", "image/png"));
    await choose(d.q("file"), pick(JPEG, "b.jpg", "image/jpeg"));
    expect(d.q("meta")?.textContent).toMatch(/^JPEG/);
    expect(revoked).toContain("blob:proto/1");
    await act(async () => d.q("delete")!.click());
    await settle();
    expect(d.status()?.dataset.state).toBe("deleted");
    expect(d.q("preview")?.dataset.state).toBe("empty");
    expect(d.q("delete")).toBeNull();
  });

  it("an invalid file is refused with a visible alert and nothing is stored", async () => {
    const factory = new IDBFactory();
    const d = mount(<LocalPortraitDock sourcePath="/s" factory={factory} decode={decode} />);
    await settle();
    await choose(
      d.q("file"),
      pick([...Buffer.from("<svg onload=alert(1)/>")], "x.png", "image/png"),
    );
    expect(d.status()?.getAttribute("role")).toBe("alert");
    expect(d.status()?.dataset.state).toBe("invalid");
    expect(d.status()?.textContent).toContain("Only PNG, JPEG or WebP");
    expect(d.q("preview")?.dataset.state).toBe("empty");
  });

  it("no IndexedDB in this browser ⇒ a storage alert, never a crash", async () => {
    // happy-dom has no indexedDB: the page's default store is unavailable.
    const d = mount(<LocalPortraitDock sourcePath="/s" decode={decode} />);
    await settle();
    expect(d.status()?.getAttribute("role")).toBe("alert");
    expect(d.status()?.textContent).toBe(
      "This browser does not allow saving local data (IndexedDB unavailable).",
    );
  });

  it("rights reminder and labels in ES and EN", async () => {
    const factory = new IDBFactory();
    let d = mount(<LocalPortraitDock sourcePath="/s" factory={factory} decode={decode} />, "es");
    await settle();
    expect(d.q("rights")?.textContent).toBe(
      "Usa solo imágenes que tengas derecho a usar. SST no proporciona, verifica ni autoriza imágenes de personajes.",
    );
    act(() => root?.unmount());
    root = null;
    host.remove();
    d = mount(<LocalPortraitDock sourcePath="/s" factory={factory} decode={decode} />, "en");
    await settle();
    expect(d.q("rights")?.textContent).toContain("Only use images you have the right to use.");
  });
});

describe("Browser Source page", () => {
  const labels = {
    empty: "No local image",
    loading: "Loading…",
    error: "Local storage unavailable",
  };
  const frame = () => host.querySelector<HTMLElement>(".lp-source");

  it("reads the dock's image and renders it through its own object URL", async () => {
    const factory = new IDBFactory();
    await saveLocalPortrait(
      {
        blob: new NodeBlob([new Uint8Array(PNG)], { type: "image/png" }) as unknown as Blob,
        type: "image/png",
        size: 16,
        width: 128,
        height: 128,
      },
      { factory },
    );
    mount(<LocalPortraitSource debug={false} labels={labels} factory={factory} />);
    await settle();
    expect(frame()?.dataset.state).toBe("image");
    expect(frame()?.querySelector("img")?.getAttribute("src")).toBe("blob:proto/1");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("empty draws nothing over the stream; ?debug=1 shows the state", async () => {
    const factory = new IDBFactory();
    mount(<LocalPortraitSource debug={false} labels={labels} factory={factory} />);
    await settle();
    expect(frame()?.dataset.state).toBe("empty");
    expect(frame()?.textContent).toBe("");
    act(() => root?.unmount());
    root = null;
    host.remove();
    mount(<LocalPortraitSource debug labels={labels} factory={factory} />);
    await settle();
    expect(frame()?.textContent).toBe("No local image");
  });

  it("no IndexedDB ⇒ error state, transparent unless debugging", async () => {
    mount(<LocalPortraitSource debug={false} labels={labels} />);
    await settle();
    expect(frame()?.dataset.state).toBe("error");
    expect(frame()?.dataset.error).toBe("unavailable");
    expect(frame()?.textContent).toBe("");
  });

  it("follows the dock: a change announcement makes it re-read (save, then delete)", async () => {
    const factory = new IDBFactory();
    mount(<LocalPortraitSource debug={false} labels={labels} factory={factory} />);
    await settle();
    expect(frame()?.dataset.state).toBe("empty");
    // The dock (another page in a real browser) saves and announces.
    const dock = document.createElement("div");
    document.body.append(dock);
    const dockRoot = createRoot(dock);
    act(() =>
      dockRoot.render(
        <NextIntlClientProvider locale="en" messages={en} timeZone="UTC">
          <LocalPortraitDock sourcePath="/s" factory={factory} decode={decode} />
        </NextIntlClientProvider>,
      ),
    );
    await settle();
    await choose(dock.querySelector('[data-testid="file"]'), pick(PNG, "a.png", "image/png"));
    await vi.waitFor(() => expect(frame()?.dataset.state).toBe("image"));
    await act(async () => dock.querySelector<HTMLElement>('[data-testid="delete"]')!.click());
    await vi.waitFor(() => expect(frame()?.dataset.state).toBe("empty"));
    act(() => dockRoot.unmount());
    dock.remove();
  });
});

describe("production gate", () => {
  it("available in development; a production build needs SST_PROTOTYPE_PAGES=1", () => {
    expect(prototypePagesEnabled({ NODE_ENV: "development" } as NodeJS.ProcessEnv)).toBe(true);
    expect(prototypePagesEnabled({ NODE_ENV: "test" } as NodeJS.ProcessEnv)).toBe(true);
    expect(prototypePagesEnabled({ NODE_ENV: "production" } as NodeJS.ProcessEnv)).toBe(false);
    expect(
      prototypePagesEnabled({
        NODE_ENV: "production",
        SST_PROTOTYPE_PAGES: "true",
      } as NodeJS.ProcessEnv),
    ).toBe(false);
    expect(
      prototypePagesEnabled({
        NODE_ENV: "production",
        SST_PROTOTYPE_PAGES: "1",
      } as NodeJS.ProcessEnv),
    ).toBe(true);
  });
});
