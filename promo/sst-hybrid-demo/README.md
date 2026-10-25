# SST — Hybrid Product Demo (promo video source)

A 55 s Spanish product demo that mixes **real SST captures** (local build, fictitious data) with
motion graphics. Isolated from the app: nothing here is imported by `src/`, no new dependency, and
the media (captures, MP4s, stills) is git-ignored and regenerable.

| File                     | What                                                                                          |
| ------------------------ | --------------------------------------------------------------------------------------------- |
| `capture/demo-data.ts`   | The fictitious account and numbers (Yasmine 1829→1859→1861 MR, Ryu 2189 MR #530, cutoff 2196) |
| `capture/capture.mts`    | Drives a local SST: sign-up, Companion pairing + syncs, session, overlays, screenshots        |
| `composition/index.html` | Deterministic composition: `window.render(frame)`, `?layout=h` (16:9) / `?layout=v` (9:16)    |
| `render.mts`             | Headless Chromium → PNG frames → ffmpeg (H.264)                                               |
| `STORYBOARD.md`          | Timeline, copy and the Legend / count semantics                                               |
| `LICENSING.md`           | Assets, fonts, data and audio notes                                                           |
| `CAPTION.md`             | Instagram caption draft (ES)                                                                  |
| `QA.md`                  | Render QA report (ffprobe + frame inspection)                                                 |

## Render

Requirements: the repo's dev dependencies (`pnpm install`, Playwright Chromium), `ffmpeg` with
`libx264`, a **local** Postgres in `.env` (`DATABASE_URL` on localhost; the capture refuses
anything else).

```bash
pnpm build
```

```bash
CREATOR_KEY_PEPPER=$(openssl rand -hex 32) SF6_PROVIDER=companion APP_URL=http://localhost:3171 PORT=3171 pnpm start
```

In another terminal (≈2 min; it creates and then deletes a `promo-*@test.local` account):

```bash
pnpm exec tsx promo/sst-hybrid-demo/capture/capture.mts
```

Then render (≈14 min each on a laptop):

```bash
pnpm exec tsx promo/sst-hybrid-demo/render.mts h
```

```bash
pnpm exec tsx promo/sst-hybrid-demo/render.mts v
```

Outputs: `promo/sst-hybrid-demo/out/sst-demo-hybrid-16x9.mp4` and `…-9x16.mp4` (H.264 High,
yuv420p, CRF 18, 30 fps CFR, BT.709, `+faststart`, silent AAC 48 kHz stereo).

Stills for review (any times, in seconds):

```bash
pnpm exec tsx promo/sst-hybrid-demo/render.mts h --stills 3,10,23,35,45,53
```

Preview in a browser: open `composition/index.html?layout=h&t=23` from a file URL (Chromium needs
`--allow-file-access-from-files` for the fonts).

## Adding music

The MP4s carry a silent stereo track as a slot. With a track you are licensed to use:

```bash
ffmpeg -i out/sst-demo-hybrid-16x9.mp4 -i music.wav -map 0:v -map 1:a -c:v copy -c:a aac -b:a 192k -af "afade=t=out:st=53:d=2" -shortest -movflags +faststart out/sst-demo-hybrid-16x9-music.mp4
```

Record the track's title, author and license in `LICENSING.md`. Cue points are in `STORYBOARD.md`.

## Rules kept

- Fictitious data only; the e-mail in the app header is masked; the demo account is deleted.
- The SST mark is animated by its documented layers, never re-slanted or recoloured.
- No Capcom logos, artwork or footage; the end card states the project is independent.
- Legend is presented as a **position** (Top 500 per character); 2196 MR is labelled an
  illustrative current cutoff, never a guaranteed threshold.
