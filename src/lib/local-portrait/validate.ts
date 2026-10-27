/**
 * PROTOTYPE (M2E follow-up, design/phase-m2/local-portrait-prototype.md) — validation of a
 * user-chosen local image before it is kept in this browser's IndexedDB. The file never leaves
 * the machine; this module only decides whether it is a small, real raster image.
 *
 * Never trusted: the file name, its extension and the browser-reported MIME type. The type comes
 * from the file's own bytes (PNG / JPEG / WebP signatures); SVG, GIF and everything else are
 * refused. The image must also decode, within a conservative pixel size.
 */

/** Conservative limits for a portrait-sized image. */
export const LOCAL_PORTRAIT_MAX_BYTES = 512 * 1024;
export const LOCAL_PORTRAIT_MAX_SIDE = 1024;

export type LocalPortraitType = "image/png" | "image/jpeg" | "image/webp";

export type ValidationError =
  "empty" | "too-large" | "unsupported-type" | "undecodable" | "too-many-pixels";

export type ValidatedImage = {
  ok: true;
  /** A NEW Blob typed from the sniffed signature (the file's own type is ignored). */
  blob: Blob;
  type: LocalPortraitType;
  size: number;
  width: number;
  height: number;
};

export type ValidationResult = ValidatedImage | { ok: false; error: ValidationError };

/** Reads the real dimensions; rejects when the bytes do not decode as an image. */
export type ImageDecoder = (blob: Blob) => Promise<{ width: number; height: number }>;

/** Type from the leading bytes only. */
export function sniffImageType(head: Uint8Array): LocalPortraitType | null {
  const at = (i: number) => head[i];
  if (
    head.length >= 8 &&
    [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((b, i) => at(i) === b)
  )
    return "image/png";
  if (head.length >= 3 && at(0) === 0xff && at(1) === 0xd8 && at(2) === 0xff) return "image/jpeg";
  const ascii = (from: number, to: number) => String.fromCharCode(...head.subarray(from, to));
  if (head.length >= 12 && ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP") return "image/webp";
  return null;
}

/** Browser decoder: createImageBitmap, released right after reading the size. */
export const browserImageDecoder: ImageDecoder = async (blob) => {
  const bitmap = await createImageBitmap(blob);
  try {
    return { width: bitmap.width, height: bitmap.height };
  } finally {
    bitmap.close();
  }
};

export async function validateLocalImage(
  file: Blob,
  decode: ImageDecoder = browserImageDecoder,
): Promise<ValidationResult> {
  if (file.size === 0) return { ok: false, error: "empty" };
  if (file.size > LOCAL_PORTRAIT_MAX_BYTES) return { ok: false, error: "too-large" };
  const head = new Uint8Array(await file.slice(0, 16).arrayBuffer());
  const type = sniffImageType(head);
  if (!type) return { ok: false, error: "unsupported-type" };
  const blob = new Blob([await file.arrayBuffer()], { type });
  let size: { width: number; height: number };
  try {
    size = await decode(blob);
  } catch {
    return { ok: false, error: "undecodable" };
  }
  if (
    !Number.isInteger(size.width) ||
    !Number.isInteger(size.height) ||
    size.width < 1 ||
    size.height < 1
  )
    return { ok: false, error: "undecodable" };
  if (size.width > LOCAL_PORTRAIT_MAX_SIDE || size.height > LOCAL_PORTRAIT_MAX_SIDE)
    return { ok: false, error: "too-many-pixels" };
  return { ok: true, blob, type, size: blob.size, width: size.width, height: size.height };
}
