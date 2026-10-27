/**
 * PROTOTYPE — local portrait store and validation (node environment: real Blob + a W3C
 * IndexedDB implementation, fake-indexeddb, one isolated database per test). No network.
 */
import { IDBFactory } from "fake-indexeddb";
import { describe, expect, it, vi } from "vitest";
import {
  LOCAL_PORTRAIT_DB,
  LOCAL_PORTRAIT_STORE,
  LocalPortraitError,
  announceLocalPortraitChange,
  deleteLocalPortrait,
  loadLocalPortrait,
  localPortraitErrorOf,
  onLocalPortraitChange,
  saveLocalPortrait,
} from "./store";
import {
  LOCAL_PORTRAIT_MAX_BYTES,
  LOCAL_PORTRAIT_MAX_SIDE,
  sniffImageType,
  validateLocalImage,
  type ImageDecoder,
} from "./validate";

const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13];
const JPEG = [0xff, 0xd8, 0xff, 0xe0, 0, 16];
const WEBP = [...Buffer.from("RIFF"), 0, 0, 0, 0, ...Buffer.from("WEBPVP8 ")];
const bytes = (head: number[], total = 64) =>
  new Uint8Array([...head, ...new Array(Math.max(0, total - head.length)).fill(7)]);
const file = (data: Uint8Array<ArrayBuffer>, name = "x.png", type = "image/png") =>
  new File([data], name, { type });
const decodes =
  (width: number, height: number): ImageDecoder =>
  async () => ({ width, height });
const broken: ImageDecoder = async () => {
  throw new Error("decode failed");
};

describe("sniffImageType: from the bytes only", () => {
  it("PNG, JPEG and WebP signatures", () => {
    expect(sniffImageType(bytes(PNG))).toBe("image/png");
    expect(sniffImageType(bytes(JPEG))).toBe("image/jpeg");
    expect(sniffImageType(bytes(WEBP))).toBe("image/webp");
  });
  it("anything else (GIF, SVG, text, truncated) is not an accepted image", () => {
    expect(sniffImageType(new Uint8Array(Buffer.from("GIF89a......")))).toBeNull();
    expect(
      sniffImageType(new Uint8Array(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg">'))),
    ).toBeNull();
    expect(sniffImageType(new Uint8Array(Buffer.from("hello world!")))).toBeNull();
    expect(sniffImageType(new Uint8Array(PNG.slice(0, 4)))).toBeNull();
  });
});

describe("validateLocalImage", () => {
  it("a real PNG within limits: a new Blob typed from its bytes, with its decoded size", async () => {
    const r = await validateLocalImage(
      file(bytes(PNG), "portrait.webp", "image/webp"),
      decodes(160, 160),
    );
    expect(r).toMatchObject({ ok: true, type: "image/png", width: 160, height: 160, size: 64 });
    if (r.ok) expect(r.blob.type).toBe("image/png"); // the claimed image/webp is ignored
  });
  it("never trusts the name or MIME type: text named .png with image/png is refused", async () => {
    const lie = file(
      new Uint8Array(Buffer.from("not an image at all, really")),
      "a.png",
      "image/png",
    );
    expect(await validateLocalImage(lie, decodes(10, 10))).toEqual({
      ok: false,
      error: "unsupported-type",
    });
    const svg = file(new Uint8Array(Buffer.from("<svg/>")), "a.svg", "image/svg+xml");
    expect(await validateLocalImage(svg, decodes(10, 10))).toEqual({
      ok: false,
      error: "unsupported-type",
    });
  });
  it("empty, too large, undecodable and too many pixels", async () => {
    expect(await validateLocalImage(file(new Uint8Array()), decodes(1, 1))).toEqual({
      ok: false,
      error: "empty",
    });
    expect(
      await validateLocalImage(file(bytes(PNG, LOCAL_PORTRAIT_MAX_BYTES + 1)), decodes(1, 1)),
    ).toEqual({ ok: false, error: "too-large" });
    expect(await validateLocalImage(file(bytes(PNG)), broken)).toEqual({
      ok: false,
      error: "undecodable",
    });
    expect(await validateLocalImage(file(bytes(PNG)), decodes(0, 10))).toEqual({
      ok: false,
      error: "undecodable",
    });
    expect(
      await validateLocalImage(file(bytes(PNG)), decodes(LOCAL_PORTRAIT_MAX_SIDE + 1, 10)),
    ).toEqual({ ok: false, error: "too-many-pixels" });
    // Exactly at the limits is accepted.
    expect(
      (
        await validateLocalImage(
          file(bytes(PNG, LOCAL_PORTRAIT_MAX_BYTES)),
          decodes(LOCAL_PORTRAIT_MAX_SIDE, 1),
        )
      ).ok,
    ).toBe(true);
  });
});

describe("IndexedDB store (schema v1)", () => {
  const image = async (head: number[], w = 160) => {
    const r = await validateLocalImage(file(bytes(head)), decodes(w, w));
    if (!r.ok) throw new Error("fixture");
    return r;
  };

  it("missing ⇒ null; save ⇒ the same bytes, type and metadata come back", async () => {
    const factory = new IDBFactory();
    expect(await loadLocalPortrait({ factory })).toBeNull();
    const img = await image(PNG);
    await saveLocalPortrait(img, { factory, now: new Date("2026-10-27T02:00:00Z") });
    const got = await loadLocalPortrait({ factory });
    expect(got).toMatchObject({
      schema: 1,
      id: "test",
      type: "image/png",
      size: 64,
      width: 160,
      height: 160,
      savedAt: "2026-10-27T02:00:00.000Z",
    });
    expect([...new Uint8Array(await got!.blob.arrayBuffer())]).toEqual([...bytes(PNG)]);
  });

  it("replace keeps one record with the new image; delete removes it", async () => {
    const factory = new IDBFactory();
    await saveLocalPortrait(await image(PNG), { factory });
    await saveLocalPortrait(await image(JPEG, 96), { factory });
    const got = await loadLocalPortrait({ factory });
    expect(got).toMatchObject({ type: "image/jpeg", width: 96 });
    const count = await new Promise<number>((resolve) => {
      const open = factory.open(LOCAL_PORTRAIT_DB, 1);
      open.onsuccess = () => {
        const r = open.result
          .transaction(LOCAL_PORTRAIT_STORE)
          .objectStore(LOCAL_PORTRAIT_STORE)
          .count();
        r.onsuccess = () => {
          resolve(r.result);
          open.result.close();
        };
      };
    });
    expect(count).toBe(1);
    await deleteLocalPortrait({ factory });
    expect(await loadLocalPortrait({ factory })).toBeNull();
    await deleteLocalPortrait({ factory }); // deleting nothing is fine
  });

  it("a record that does not match the schema reads as missing (never rendered)", async () => {
    const factory = new IDBFactory();
    await saveLocalPortrait(await image(PNG), { factory });
    await new Promise<void>((resolve) => {
      const open = factory.open(LOCAL_PORTRAIT_DB, 1);
      open.onsuccess = () => {
        const tx = open.result.transaction(LOCAL_PORTRAIT_STORE, "readwrite");
        tx.objectStore(LOCAL_PORTRAIT_STORE).put({ schema: 99, id: "test", blob: "nope" });
        tx.oncomplete = () => {
          open.result.close();
          resolve();
        };
      };
    });
    expect(await loadLocalPortrait({ factory })).toBeNull();
  });

  it("errors: no IndexedDB ⇒ unavailable; open failure ⇒ unavailable; quota ⇒ quota", async () => {
    await expect(loadLocalPortrait({ factory: undefined })).rejects.toMatchObject({
      code: "unavailable",
    });
    const throwing = {
      open: () => {
        throw new Error("SecurityError");
      },
    } as unknown as IDBFactory;
    await expect(saveLocalPortrait(await image(PNG), { factory: throwing })).rejects.toMatchObject({
      code: "unavailable",
    });
    expect(localPortraitErrorOf(new DOMException("full", "QuotaExceededError")).code).toBe("quota");
    expect(localPortraitErrorOf(new Error("x")).code).toBe("failed");
    expect(localPortraitErrorOf(new LocalPortraitError("unavailable")).code).toBe("unavailable");
  });
});

describe("change notification", () => {
  it("carries only the change kind and slot id, never image data", async () => {
    const got = vi.fn();
    const stop = onLocalPortraitChange(got);
    announceLocalPortraitChange({ type: "saved", id: "test" });
    await vi.waitFor(() => expect(got).toHaveBeenCalledWith({ type: "saved", id: "test" }));
    stop();
  });
});
