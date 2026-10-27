# Prototype: local user-provided portrait in OBS (dock → Browser Source)

**Status: technical prototype, not a product feature.** Follows `character-portraits-licensing-gate.md` (§7.2 A and §8,
merged in #86). Base: `main` at `bfdfd23`.

> The **central acceptance criterion** is that an image chosen in an OBS Custom Browser Dock is shown by a separate OBS
> Browser Source. It is **NOT verified yet**: this environment cannot run OBS. Everything marked «verified» below was
> verified in Playwright Chromium or in code, **not in OBS**.

## What it is

- **Dock page** `/prototype/obs-portrait/dock`, used as an OBS **Custom Browser Dock**:
  - a file input, validated from the file's bytes;
  - the image is kept in **this browser profile's IndexedDB**, with a preview and replace/delete;
  - a rights reminder;
  - the source URL to paste into OBS.
- **Source page** `/prototype/obs-portrait/source`, used as an OBS **Browser Source**:
  - reads the image from IndexedDB, creates **its own** `blob:` URL and fills the largest centred square;
  - transparent and silent when there is no image or an error. `?debug=1` shows the state.
- **Nothing is uploaded.** No API, SSE, database, log or telemetry carries the image.
- **Unchanged:** the CSP (it already allows `blob:` images), the production overlays and the schema.

### Gate (never in production by accident)

The pages render only when `NODE_ENV !== "production"` (`pnpm dev`), **or** when a production build is started with
`SST_PROTOTYPE_PAGES=1`. Otherwise they return **404**, verified against a local production build.
(`src/server/prototypes/gate.ts`)

### Storage (schema v1)

|               |                                                                                                                                                                               |
| ------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Database      | `sst-proto-local-portrait`, IndexedDB version 1                                                                                                                               |
| Store         | `images`, keyPath `id`; the prototype uses one slot, `"test"`                                                                                                                 |
| Record        | `{ schema: 1, id, blob, type, size, width, height, savedAt }`. A record that does not match reads as missing.                                                                 |
| Change notice | `BroadcastChannel("sst-proto-local-portrait")` carrying `{ type: "saved" \| "deleted", id }`, never image data. The source also re-reads on load and when it becomes visible. |

### Validation (`src/lib/local-portrait/validate.ts`)

- **Never trusted:** the name, the extension and the browser MIME type.
- **Accepted types:** PNG, JPEG or WebP, by signature bytes. SVG, GIF and everything else are refused.
- **Limits:** ≤ **512 KB**, decodes as an image (`createImageBitmap`), each side ≤ **1024 px**.
- **What is stored:** a new Blob typed from the signature.

### Files

- `src/lib/local-portrait/{validate,store}.ts`, plus `local-portrait.test.ts`.
- `src/app/(app)/prototype/obs-portrait/dock/{page.tsx, LocalPortraitDock.tsx}`.
- `src/app/(overlay)/prototype/obs-portrait/source/{page.tsx, LocalPortraitSource.tsx, local-portrait-source.css}`.
  This is the transparent (overlay) root layout: no dashboard CSS, OBS/CEF-safe CSS, no animation.
- `src/app/(app)/prototype/obs-portrait/local-portrait-pages.test.tsx`.
- `src/server/prototypes/gate.ts`.
- `src/i18n/messages/{es,en}.json`: the `Prototype.localPortrait.*` keys.
- `design/phase-m2/e2e/local-portrait.e2e.mts`.
- `package.json` / `pnpm-lock.yaml`: **devDependency** `fake-indexeddb@6.2.5` (Apache-2.0, no dependencies, tests
  only). It is a W3C IndexedDB implementation for Node, because happy-dom has no `indexedDB`. It is never bundled.

## Verified vs assumed

**Verified, automated (this environment):**

- **Unit tests (20):**
  - signature sniffing;
  - a MIME or extension lie is refused;
  - empty, too large, undecodable and oversized images are refused;
  - save, load, replace (one record), delete and missing;
  - a schema-mismatch record reads as missing;
  - errors: unavailable, open failure, quota mapping;
  - the change message carries no data;
  - dock states: loading, empty, saved preview, invalid, storage error, replace with the old URL revoked, delete;
  - no `fetch`;
  - ES/EN rights text;
  - the source reads it, stays empty and silent, shows `?debug`, goes to the error state and follows the dock;
  - the gate.
- **Playwright Chromium (22/22), local production build, synthetic images only** (`e2e/local-portrait.e2e.mts`):
  - **Gate:** without the flag, both pages return 404.
  - **Headers:** the dock and source pages are served with the existing CSP (`img-src 'self' data: blob:`), and no CSP
    violation was reported.
  - **Refusals:** a text file named `.png`, a file over 512 KB and a 1600 px-wide image are refused.
  - **Saving:** a real PNG decodes and is previewed. A **separate page in the same browser profile** shows it through
    its own `blob:` URL **without reloading** (BroadcastChannel).
  - **No upload:** while saving, no POST or PUT and no request body.
  - **Replace and delete:** both propagate to the other page without a reload.
  - **Persistence:** the image survives reloading the source **and restarting the persistent browser profile**.
  - **Isolation:** a different browser profile does **not** see the image, as the user's normal browser and OBS
    would not.
  - **Dimensions:** at 160×160, 320×180 and 96×96 the image fills a square of the shortest side, centred, with no
    overflow.
- **Code-verified OBS facts** (from #86 §7.1, `obs-browser` / `obs-studio` source): Browser Sources and Custom Browser
  Docks both use CEF's **global** request context, whose cache path is OBS's own `plugin_config/obs-browser`.
- **Code-verified, but a risk:** `obs-browser` implements **no `CefDialogHandler`**. The file picker relies on CEF's
  default for a windowed dock.

**Assumptions, unverified until real OBS is run:**

| #   | Assumption                                                                                                                           |
| --- | ------------------------------------------------------------------------------------------------------------------------------------ |
| A1  | `<input type="file">` opens a file picker inside an OBS Custom Browser Dock.                                                         |
| A2  | The dock and the Browser Source on the **same origin** share IndexedDB in OBS.                                                       |
| A3  | `BroadcastChannel` messages cross from the dock to the source in OBS. If not, the source updates only when reloaded or made visible. |
| A4  | The image survives an OBS restart, and the source's «Refresh cache of current page».                                                 |
| A5  | `createImageBitmap` and `blob:` images work in OBS's CEF build on Windows and macOS.                                                 |
| A6  | Several Browser Sources and scene collections all see the same image.                                                                |

## How to run it for OBS

1. Run SST locally:
   - Either **`pnpm dev`** (prototype pages are on in development), then use `http://localhost:3000`.
   - Or a production build: `pnpm build`, then `SST_PROTOTYPE_PAGES=1 pnpm start`.

   Use the **same host and port in OBS for both URLs**. `localhost` and `127.0.0.1` are **different origins** and do
   not share storage.

2. In OBS: **Docks → Custom Browser Docks…**
   - Name: `SST portrait (prototype)`.
   - URL: `http://localhost:3000/prototype/obs-portrait/dock`.
   - Apply.
3. In a scene: **+ → Browser**:
   - URL: `http://localhost:3000/prototype/obs-portrait/source` (add `?debug=1` for a visible state);
   - Width **160**, Height **160**;
   - leave «Local file» **off**. A `file://` page is a different origin.
4. Only use a test image you have the right to use, for example a solid-colour PNG. The prototype is not a source of
   character art.

## Manual checklist (real OBS; record the OBS version and OS)

Status today: **not run, all items open.**

| #   | Step                                                                            | Expected                                                                                  | Windows | macOS |
| --- | ------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- | ------- | ----- |
| 1   | In the dock, «Choose image» (A1)                                                | a file picker opens                                                                       | ☐       | ☐     |
| 2   | Pick a small PNG                                                                | the dock shows the preview and «Image saved in this browser»                              | ☐       | ☐     |
| 3   | Look at the Browser Source, without touching it (A2, A3)                        | the image appears; if not, right-click the source → Refresh and record which one happened | ☐       | ☐     |
| 4   | Replace it with another image                                                   | the source shows the new image (no reload or reload: record)                              | ☐       | ☐     |
| 5   | Delete it in the dock                                                           | the source becomes empty and transparent                                                  | ☐       | ☐     |
| 6   | Save again, then «Refresh cache of current page» on the source (A4)             | the image is still shown                                                                  | ☐       | ☐     |
| 7   | Quit and reopen OBS (A4)                                                        | the source shows the image; the dock lists it                                             | ☐       | ☐     |
| 8   | Add a second Browser Source with the same URL, and switch scene collection (A6) | both show it                                                                              | ☐       | ☐     |
| 9   | Try `fake.png` (text), a > 512 KB file and a > 1024 px image                    | the dock refuses each with a message; the source is unchanged                             | ☐       | ☐     |
| 10  | Resize the source to 320×180 and 96×96                                          | a centred square, nothing clipped outside the source                                      | ☐       | ☐     |
| 11  | Open the dock URL in your normal browser                                        | it does **not** list OBS's image (separate profile, as expected)                          | ☐       | ☐     |

**Decision rule:**

- **If 1–3 and 7 pass on both OSes**, the local-only approach is viable for a real (gated, opt-in) feature PR.
- **If 1 or 2 fails** (no picker or no shared storage), the dock workflow is not viable. Revisit only per the licensing
  gate §8 (app-hosted uploads need legal and operational review first).

## Known limitations (prototype)

- **One test slot only.** No per-character mapping, no integration with the real overlays or the identity plate yet.
- **Origin-bound.** It only works with an identical scheme, host and port. A future production use would be the
  deployed origin, typed identically in OBS.
- **Per OBS install.** It is not portable across machines or browsers, and is lost if `plugin_config/obs-browser` is
  deleted.
- **Unverified environments:** CEF quota and eviction, and other streaming apps (Streamlabs, XSplit, Meld).
- **Rights.** A user-provided image is **not** authorized by SST. Any later feature must keep the rights reminder and
  never supply or recommend character art.
