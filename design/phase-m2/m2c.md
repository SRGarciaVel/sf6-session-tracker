# M2C: Analytics PDF export feedback

**Base:** `main` at `cf68d27`. **Branch:** `feat/analytics-pdf-export-feedback`.

## Root cause (verified)

The «Descargar PDF» control was a plain `<a href="…/review.pdf?…" download>`. A download link
cannot read the response status, and the browser treats any response as «the file».

The route (`review.pdf/route.ts` → `guardedReviewPdfResponse`) refuses with these statuses:

| Status | When                                                                                | Body                           |
| ------ | ----------------------------------------------------------------------------------- | ------------------------------ |
| 401    | not signed in                                                                       | `unauthorized`                 |
| 429    | export already in progress for the account (work gate), or account quota 5 / 10 min | localized text + `Retry-After` |
| 503    | process capacity: 2 in flight, 6 per minute                                         | localized text + `Retry-After` |
| 409    | no review signals for the filters                                                   | localized text                 |
| 404    | no player                                                                           | `no player`                    |

All refusals are `text/plain` and `Cache-Control: private, no-store`. Success is `application/pdf`
with `Content-Disposition: attachment; filename="sst-review-….pdf"`, `nosniff` and `no-store`.

On the `main` build, in Chromium (`e2e/pdf-export.e2e.mts before`): after five successful exports,
the server correctly refused the 6th and 7th. The browser then **saved the error text as
`review.txt`** (download state `canceled`), and the page showed **no message at all**.

## Behaviour now

|                       | Before                         | After                                                                                                      |
| --------------------- | ------------------------------ | ---------------------------------------------------------------------------------------------------------- |
| Click                 | browser download, no feedback  | «Generando PDF…» on the control (`aria-busy`, `aria-disabled`), announced                                  |
| Repeated clicks       | each one a new request         | ignored while one is pending (1 request)                                                                   |
| Success               | file saved                     | the same server file and filename; «PDF descargado. Revisa tu carpeta de descargas.»                       |
| 429                   | `review.txt` saved, no message | «Has alcanzado el límite de informes PDF. Vuelve a intentarlo en N minutos/segundos.» (from `Retry-After`) |
| 503                   | `review.txt` saved, no message | the existing «Ahora mismo se están generando otros informes…»                                              |
| 409 / 401 / other     | file saved with the error text | no-signals message / session expired / generic «No se pudo generar el PDF»                                 |
| Network failure       | browser «failed»               | «SST no pudo completar la solicitud. Comprueba tu conexión…»                                               |
| 200 that is not a PDF | saved as `.pdf`                | nothing saved, «La respuesta no era un PDF válido…»                                                        |

## Implementation

The implementation is `ReviewExportActions.tsx` plus the pure helpers in `review-pdf-download.ts`.

- **Still a link.** Same `href`, same `download` attribute. Before hydration, and for modified
  clicks (Ctrl/⌘/Shift/Alt: new tab, save link), the browser behaves natively, as before.
- **A plain click** (mouse, or Enter on the focused link) runs a same-origin `fetch` of the **same
  URL**:
  - `credentials: "same-origin"`, `cache: "no-store"`;
  - the same session cookie, the same route, the same server limits;
  - no new endpoint and no new dependency.
- **Errors map from the status only.** The response body is never rendered, not even as text: it
  is untrusted, and the client has its own catalog messages. `Retry-After` is read only as
  delay-seconds (1 s to 24 h); otherwise the message has no time.
- **A success must really be a PDF:** `Content-Type: application/pdf` **and** the `%PDF-`
  signature. Otherwise nothing is saved.
- **Filename.** The server's `filename*`/`filename` is kept only if it matches
  `^[A-Za-z0-9][A-Za-z0-9._-]{0,150}\.pdf$`; otherwise `sst-review.pdf`.
- **Object URL.** It is created only for a validated PDF, clicked through a temporary hidden
  anchor, and revoked 10 s later, or immediately on unmount.
- **Unmount.** It aborts an in-flight request and updates nothing.
- **Trade-off.** The PDF is held in memory as a `Blob` before saving. It is a few hundred KB,
  rendered on demand, and the server already buffers it. Chunked streaming to disk would need a
  framework this PR does not want.

## Accessibility and localization

- **Control.** A focusable link, activated with Enter. It keeps focus while pending:
  `aria-disabled`, not `disabled`. It shows the download icon and visible text.
- **Progress and success** go to the existing polite `role="status"` region. While pending the
  control already shows «Generando PDF…» visibly, so the status text is screen-reader-only.
- **Errors** go to a `role="alert"` paragraph that stays visible until the next attempt and is
  referenced by `aria-describedby` on the control. It uses SST's warning style: left `border-warn`
  over `bg-warn/8`.
- **i18n.** New keys `Analytics.reviewReport.export.*` in **es** and **en**, with ICU plurals for
  seconds and minutes. The existing `errors.busy` / `errors.noSignals` are reused. The component
  now reads them with `useTranslations` (the `labels` prop is gone).
- **Mobile.** At 390 px with 200 % text the export area fits: its right edge is 11 px inside the
  viewport. The **page** still overflows by 150 px because of the Analytics filter form at 200 %
  text. That is pre-existing, already listed as deferred in M2A, and not touched here.

## Server security: unchanged

`git diff main -- src/server 'src/app/(app)/dashboard/analytics/review.pdf'` is empty. These are
untouched:

- authentication;
- the per-account quota (5 / 10 min);
- the process admission gate (2 in flight, 6 / min);
- `Cache-Control: private, no-store`, `nosniff`, `Content-Disposition`;
- PDF generation.

The client never caches the PDF: `cache: "no-store"`, an in-memory Blob, and the object URL is
revoked.

## Tests

- `review-pdf-download.test.ts` (9):
  - status mapping (429 seconds/minutes/none, 503, 409, 401, others);
  - `Retry-After` parsing;
  - safe and unsafe filenames (paths, `.html`, NUL, broken RFC 5987, length);
  - PDF validation;
  - request options;
  - network failure vs abort.
- `ReviewExportActions.test.tsx` (29, replaces 4):
  - copy (unchanged);
  - success with the server filename;
  - 4 fallback-filename cases;
  - object URL revoked by timer and on unmount;
  - pending state and duplicate clicks;
  - 8 refusal and error statuses;
  - an untrusted body is never rendered;
  - network failure;
  - 3 not-a-PDF cases;
  - retry after an error;
  - English;
  - keyboard and focus;
  - modified clicks stay native;
  - unmount aborts;
  - hydration.
- A mutation check (validation forced to accept anything) makes the 3 not-a-PDF tests fail.
- `ReviewExport.test.tsx`: the link test now allows the icon before the text.
- **Chromium** (`e2e/pdf-export.e2e.mts after`): local production build, local Postgres, one
  `@test.local` account with 120 matches through the real Companion sync. **14/14:**
  - pending and a single request;
  - a real PDF with the server filename;
  - success announced;
  - keyboard Enter and focus kept;
  - the **real 429** (quota, «10 minutos») and the **real 503** (process gate), statuses
    `200 ×5, 429, 503`;
  - the alert linked to the control;
  - network failure (simulated);
  - HTML served with 200 (simulated), nothing saved;
  - 390 px at 200 % text;
  - English.
- **Evidence:** `screenshots/evidence/m2c/export-states.jpg` (before, plus every after state),
  `mobile-390-text200.jpg`, `checks.json`, `before.json`.
