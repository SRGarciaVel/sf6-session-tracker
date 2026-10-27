/**
 * PROTOTYPE (design/phase-m2/local-portrait-prototype.md) — the local portrait store: one
 * IndexedDB database in THIS browser profile, never synchronised, never sent to SST.
 *
 * Schema v1 (versioned so a later prototype can migrate or drop it):
 *   database  "sst-proto-local-portrait"  (IndexedDB version 1)
 *   store     "images", keyPath "id"
 *   record    { schema: 1, id, blob, type, size, width, height, savedAt }
 * Only the slot "test" is used by the prototype. A record that does not match the schema reads
 * as missing (never rendered).
 *
 * Change notification: a same-origin BroadcastChannel message ({ type, id }, no image data).
 * Whether it reaches an OBS Browser Source from an OBS dock is one of the things the prototype
 * must verify in real OBS.
 */
import type { LocalPortraitType } from "./validate";

export const LOCAL_PORTRAIT_DB = "sst-proto-local-portrait";
export const LOCAL_PORTRAIT_DB_VERSION = 1;
export const LOCAL_PORTRAIT_STORE = "images";
export const LOCAL_PORTRAIT_SCHEMA = 1;
export const LOCAL_PORTRAIT_SLOT = "test";
export const LOCAL_PORTRAIT_CHANNEL = "sst-proto-local-portrait";

export interface LocalPortraitRecord {
  schema: typeof LOCAL_PORTRAIT_SCHEMA;
  id: string;
  blob: Blob;
  type: LocalPortraitType;
  size: number;
  width: number;
  height: number;
  /** ISO time it was saved (display only). */
  savedAt: string;
}

export type LocalPortraitErrorCode = "unavailable" | "quota" | "failed";

export class LocalPortraitError extends Error {
  constructor(
    readonly code: LocalPortraitErrorCode,
    options?: { cause?: unknown },
  ) {
    super(`local portrait store: ${code}`, options);
    this.name = "LocalPortraitError";
  }
}

const TYPES: readonly string[] = ["image/png", "image/jpeg", "image/webp"];

function isRecord(value: unknown): value is LocalPortraitRecord {
  if (typeof value !== "object" || value === null) return false;
  const r = value as Record<string, unknown>;
  return (
    r.schema === LOCAL_PORTRAIT_SCHEMA &&
    typeof r.id === "string" &&
    typeof r.blob === "object" &&
    r.blob !== null &&
    typeof (r.blob as Blob).arrayBuffer === "function" &&
    typeof r.type === "string" &&
    TYPES.includes(r.type) &&
    typeof r.size === "number" &&
    typeof r.width === "number" &&
    typeof r.height === "number" &&
    typeof r.savedAt === "string"
  );
}

/** Storage failures as the prototype reports them (quota vs anything else). */
export function localPortraitErrorOf(error: unknown): LocalPortraitError {
  if (error instanceof LocalPortraitError) return error;
  const name = (error as { name?: string } | null)?.name;
  return new LocalPortraitError(name === "QuotaExceededError" ? "quota" : "failed", {
    cause: error,
  });
}

function open(factory: IDBFactory | undefined): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (!factory) return reject(new LocalPortraitError("unavailable"));
    let request: IDBOpenDBRequest;
    try {
      request = factory.open(LOCAL_PORTRAIT_DB, LOCAL_PORTRAIT_DB_VERSION);
    } catch (error) {
      return reject(new LocalPortraitError("unavailable", { cause: error }));
    }
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(LOCAL_PORTRAIT_STORE))
        db.createObjectStore(LOCAL_PORTRAIT_STORE, { keyPath: "id" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(new LocalPortraitError("unavailable", { cause: request.error }));
    request.onblocked = () => reject(new LocalPortraitError("unavailable"));
  });
}

async function run<T>(
  factory: IDBFactory | undefined,
  mode: IDBTransactionMode,
  body: (store: IDBObjectStore) => IDBRequest<T> | void,
): Promise<T | undefined> {
  const db = await open(factory);
  try {
    return await new Promise<T | undefined>((resolve, reject) => {
      let result: T | undefined;
      const tx = db.transaction(LOCAL_PORTRAIT_STORE, mode);
      const request = body(tx.objectStore(LOCAL_PORTRAIT_STORE));
      if (request) request.onsuccess = () => (result = request.result);
      tx.oncomplete = () => resolve(result);
      tx.onerror = () => reject(localPortraitErrorOf(tx.error));
      tx.onabort = () => reject(localPortraitErrorOf(tx.error));
    });
  } catch (error) {
    throw localPortraitErrorOf(error);
  } finally {
    db.close();
  }
}

/** The default factory of this page (undefined where IndexedDB does not exist). */
export function defaultIndexedDB(): IDBFactory | undefined {
  return typeof indexedDB === "undefined" ? undefined : indexedDB;
}

/** Saves (or replaces) the slot's image. */
export async function saveLocalPortrait(
  image: Pick<LocalPortraitRecord, "blob" | "type" | "size" | "width" | "height">,
  options: { id?: string; factory?: IDBFactory; now?: Date } = {},
): Promise<LocalPortraitRecord> {
  const record: LocalPortraitRecord = {
    schema: LOCAL_PORTRAIT_SCHEMA,
    id: options.id ?? LOCAL_PORTRAIT_SLOT,
    blob: image.blob,
    type: image.type,
    size: image.size,
    width: image.width,
    height: image.height,
    savedAt: (options.now ?? new Date()).toISOString(),
  };
  await run(options.factory ?? defaultIndexedDB(), "readwrite", (store) => store.put(record));
  return record;
}

/** The slot's image, or null when there is none (or it does not match the schema). */
export async function loadLocalPortrait(
  options: { id?: string; factory?: IDBFactory } = {},
): Promise<LocalPortraitRecord | null> {
  const value = await run<unknown>(options.factory ?? defaultIndexedDB(), "readonly", (store) =>
    store.get(options.id ?? LOCAL_PORTRAIT_SLOT),
  );
  return isRecord(value) ? value : null;
}

export async function deleteLocalPortrait(
  options: { id?: string; factory?: IDBFactory } = {},
): Promise<void> {
  await run(options.factory ?? defaultIndexedDB(), "readwrite", (store) =>
    store.delete(options.id ?? LOCAL_PORTRAIT_SLOT),
  );
}

export type LocalPortraitMessage = { type: "saved" | "deleted"; id: string };

/** Tells other pages of this origin and profile to re-read (no image data in the message). */
export function announceLocalPortraitChange(message: LocalPortraitMessage): void {
  if (typeof BroadcastChannel === "undefined") return;
  const channel = new BroadcastChannel(LOCAL_PORTRAIT_CHANNEL);
  channel.postMessage(message);
  channel.close();
}

export function onLocalPortraitChange(
  listener: (message: LocalPortraitMessage) => void,
): () => void {
  if (typeof BroadcastChannel === "undefined") return () => {};
  const channel = new BroadcastChannel(LOCAL_PORTRAIT_CHANNEL);
  channel.onmessage = (event: MessageEvent<unknown>) => {
    const data = event.data as Partial<LocalPortraitMessage> | null;
    if ((data?.type === "saved" || data?.type === "deleted") && typeof data.id === "string")
      listener({ type: data.type, id: data.id });
  };
  return () => channel.close();
}
