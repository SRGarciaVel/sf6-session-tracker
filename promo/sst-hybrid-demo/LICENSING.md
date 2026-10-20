# Assets and licensing notes

| Element                                       | Source                                                                                 | License / status                                                                                               |
| --------------------------------------------- | -------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| SST monogram / lockup                         | `public/brand/*` geometry (`src/components/brand/geometry.ts`), inlined layer by layer | Project's own brand (see `docs/brand/NOTICE.md`). Geometry, slant and colours unchanged.                       |
| UI imagery                                    | `capture/capture.mts` screenshots of a **local** production build of SST               | Project's own UI. Data fictitious (see below).                                                                 |
| Fonts                                         | `src/server/analytics/report/fonts/` (Barlow, Barlow Condensed, JetBrains Mono)        | SIL OFL 1.1 — license texts in `src/server/analytics/report/fonts/licenses/`. Used locally, not redistributed. |
| Background, stream canvas, chips, transitions | Drawn with CSS in `composition/index.html`                                             | Original to this project. Abstract shapes only: no game footage, characters or third-party marks.              |
| Audio                                         | Generated silence (`anullsrc`)                                                         | No music included. **Add only music you have a license for**, and record its title/author/license here.        |
| Render tools                                  | Playwright Chromium (already a dev dependency), ffmpeg 6.1 / libx264 (system)          | No new dependency, nothing paid, nothing downloaded.                                                           |

## Data

- Account `DEMO_SST`, CFN `9990000100` (invented), e-mail
  `promo-<random>@test.local`, deleted at the end of the capture. The e-mail shown in the app
  header is replaced by `demo@sst` in the screenshots.
- Ratings: Yasmine 1829 → 1859 → 1861 MR; Ryu 2189 MR #530; Legend reference 2196 MR (last Legend
  #497, first non-Legend #505 at 2195 MR) — all invented. The profile shape comes from the sanitized
  test fixture `tests/fixtures/capcom/play-1733837998.json`, whose identity is replaced before
  anything is stored. Opponents are «Rival N».
- No real player, streamer, CFN ID, cookie, token or HAR was used. Overlay URLs visible in the
  builder capture are local (`localhost:3171`) tokens of overlays deleted with the demo account.

## Third-party names

Character names (Yasmine, Ryu) and the word «Street Fighter 6» appear only as they appear in the
product UI (nominative use). No Capcom logo, artwork or footage is used. The end card says
«Proyecto independiente. No afiliado ni respaldado por Capcom.» The video never presents SST as an
official product.
