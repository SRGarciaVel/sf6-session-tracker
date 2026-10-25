# QA report — render of 2026-10-20

Renders are git-ignored (`out/`); these are the measured results of the local renders.

## ffprobe

| Field        | `sst-demo-hybrid-16x9.mp4`   | `sst-demo-hybrid-9x16.mp4`   |
| ------------ | ---------------------------- | ---------------------------- |
| Video        | H.264 High, yuv420p, BT.709  | H.264 High, yuv420p, BT.709  |
| Size         | 1920×1080                    | 1080×1920                    |
| Frame rate   | 30/1 (CFR), 1650 frames      | 30/1 (CFR), 1650 frames      |
| Duration     | 55.000 s                     | 55.000 s                     |
| Audio        | AAC LC 48 kHz stereo, silent | AAC LC 48 kHz stereo, silent |
| Bit rate     | 2.50 Mb/s                    | 2.44 Mb/s                    |
| File size    | 17,178,378 B                 | 16,806,572 B                 |
| `moov` first | yes (+faststart)             | yes (+faststart)             |
| Full decode  | no errors                    | no errors                    |
| SHA-256      | `92b3db27…20dc73d6`          | `810f352a…a9061889`          |

16:9 render time: 14 min 7 s (headless Chromium + libx264 `slow`, WSL2).

## Frames inspected (extracted from the MP4s with ffmpeg)

| Time  | 16:9                                                                                            | 9:16                                    |
| ----- | ----------------------------------------------------------------------------------------------- | --------------------------------------- |
| 00:03 | Lockup complete (cyan + letters + magenta, divider, SESSION/STATS/TRACKER), «Tu sesión.» enters | Stacked lockup, «Tu sesión.» enters     |
| 00:10 | Real dashboard pushing in: 5V · 71,4 % · 2D, 1829 → 1859 MR +30                                 | Same, framed on the left column         |
| 00:23 | Zoomed Session overlay 6/2 · 75 % · 1861 MR +32; «Resultado: Victoria»; «Delta de sesión»       | Same, recomposed under a 3-line heading |
| 00:35 | Broadcast #530 · 2189 MR · «7 MR para el corte actual · 2196 MR»; fact chips fading; caveat     | Same                                    |
| 00:45 | Stream canvas with Session + Rank Compact; 4 feature chips                                      | Same, chips below the canvas            |
| 00:53 | «JUEGA. MEJORA. COMPARTE.» fading out, URL, «Compatible con OBS · Beta», disclaimer             | Same, stacked                           |

Count check (16:9, 21.35–21.75 s, frame by frame): 1859 +30 → 1859 +32 → 1860 → 1861. In
the product, the session delta changes at once and only the rating counts, so for two frames (≈67 ms) the
overlay shows 1859 next to +32.

No black frames, no missing glyphs (ñ, á, é, í, ó, ú, «·», «→»), no text overflow in either
layout after the fixes (wrapped Spanish lines, 9:16 heading widths, chip widths).

## Known limitations

- The count is shown at real speed («lenta», 800 ms easeOutCubic). With +2 MR the visible change
  takes ≈0.3 s; the camera zooms in before it plays.
- The «+1 victoria» chip in scene 2 partially covers the «Tracking activo» hint text behind it.
- Silent audio: no licensed music was available. The track is a slot (see README).
- Spanish only; no English cut.
