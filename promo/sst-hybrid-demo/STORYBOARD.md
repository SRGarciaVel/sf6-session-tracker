# Storyboard / timeline — «SST — Hybrid Product Demo»

55 s · 30 fps · 1650 frames · 16:9 (1920×1080) and 9:16 (1080×1920, recomposed).
Every UI image is a real SST capture (local build, fictitious data); everything else is motion
graphics drawn by `composition/index.html`. Each cut (6, 17, 29, 41, 49 s) has a 0.7 s
cyan→magenta slash wipe.

| #   | Time    | Frames    | On screen                                                                                                                                                                                                                                                             | Copy (ES)                                                                                                                           |
| --- | ------- | --------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| 1   | 0–6 s   | 0–179     | SST monogram revealed by layers (cyan slash → letters → magenta slashes), divider and SESSION/STATS/TRACKER; tagline phrase by phrase. 16:9 = horizontal lockup, 9:16 = stacked lockup.                                                                               | «SST \| SESSION STATS TRACKER» · «Tu sesión. Tus estadísticas. Tu progreso.»                                                        |
| 2   | 6–17 s  | 180–509   | Real dashboard (`dashboard-before.png`: 5V·2D, 71,4 %, 1859 MR +30). Camera pushes in on the session panel; at 12 s it cross-fades to `dashboard-after.png` (6V·2D, 75 %, 1861 MR +32), rings + chips.                                                                | «01 · PANEL» · «CADA PARTIDA CUENTA» · «Estadísticas que evolucionan contigo.» · chips «+1 victoria», «+32 MR en la sesión»         |
| 3   | 17–29 s | 510–869   | Abstract stream canvas (neon arena, EN DIRECTO badge, webcam slot) with the real Session overlay. Camera zooms on the overlay; 21.4 s the 37 real count frames play (1859→1860→1861, +30→+32). 25.5 s: the real builder controls (Transición del rating / Velocidad). | «02 · OVERLAY DE SESIÓN» · «MR y LP con transiciones fluidas» · «Resultado: Victoria» · «Delta de sesión +32 MR · 1829 → 1861»      |
| 4   | 29–41 s | 870–1229  | Real Rank Progress Broadcast (Ryu, Ultimate Master, #530, 2189 MR, «7 MR para el corte actual · 2196 MR»), three fact chips; 35 s split with the real Compact style.                                                                                                  | «03 · PROGRESO DE RANGO» · «VISUALIZA TU PROGRESO» · «Cada MR importa. Cada puesto también.» · Legend caveat (see below)            |
| 5   | 41–49 s | 1230–1469 | Stream canvas with the Session overlay (final 1861 state) and Rank Progress Compact; feature chips.                                                                                                                                                                   | «04 · PARA STREAMERS» · «TUS ESTADÍSTICAS, EN DIRECTO» · OBS / se actualiza solo / ES·EN / Sesión · Progreso de rango               |
| 6   | 49–55 s | 1470–1649 | End card, then lockup hold from 53 s (≈2 s).                                                                                                                                                                                                                          | «JUEGA. MEJORA. COMPARTE.» · https://sf6-session-tracker-web.onrender.com · «Compatible con OBS · Beta» · «Proyecto independiente…» |

Persistent: «DATOS DE DEMOSTRACIÓN» tag (bottom-right 16:9, top-left 9:16) and a small SST
monogram watermark during scenes 2–5.

## Legend wording (scene 4)

The Broadcast says «7 MR PARA EL CORTE ACTUAL · 2196 MR» — the product's own wording. The video
never says that reaching 2196 grants Legend. Chips: «Legend: Top 500 del personaje», then «Legend
se decide por puesto: Top 500 del personaje», and the footnote stays on screen 31–41 s:

> Corte ilustrativo con datos de demostración. Legend se obtiene por puesto (Top 500 por
> personaje); el MR del corte cambia con la clasificación y no garantiza el rango por sí solo.

## Count semantics (scene 3)

The count frames were captured from the public overlay page while the real sync endpoint received,
in order, a battlelog-only sync with the new win (rating held at 1859 · +30, Phase 5.5) and then
the next profile (1861). The delta is the engine's **session** delta (current − session baseline
1829), not a per-match delta. Speed «lenta» (800 ms, easeOutCubic): with only 2 MR the visible
change takes ≈0.3 s — played at real speed, not slowed down.

## Audio slot

Silent AAC track. Suggested cue points for a licensed track: 0.4 s (cyan slash), 1.3 s (magenta
slashes), each cut (6/17/29/41/49 s), 21.4 s (count), 49.3/49.7/50.1 s (end-card words), 53.0 s
(logo hold).
