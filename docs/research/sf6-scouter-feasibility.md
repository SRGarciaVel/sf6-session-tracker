# Research: advanced SF6 match analysis (SF6 Scouter) and its feasibility for SST

This is a Phase 5.6C research appendix. It is **not** a feature: nothing here is implemented, and
no replay data, telemetry or Companion change is part of 5.6C.

- **Researched:** 2026-10-21.
- **Sources:** public pages only (listed at the end).
- **Method:** no binaries were downloaded or run, no private endpoints were queried, and nothing
  was reverse-engineered.
- **Labels:** every statement is tagged **[fact]** (a public source or SST's own code states it),
  **[hypothesis]** (plausible, not verified) or **[unknown]**.

## 1. What SF6 Scouter publicly documents

**Live tracking** [fact; source: site, README]:

- "Keep track of wins, losses, win rates, and LP / MR changes".
- Mini and Pro overlays, and an OBS-friendly transparent mode.
- Ranked-only tracking (changelog v0.3.7).
- Character-switch detection for LP/MR (v0.3.0).

**History** [fact]:

- "Unlimited match history — official site caps at 100".
- v0.3.3: "Automatically fetches and persists your last 100 battle records locally".

**OCR on the VS screen** [fact]: v0.3.9: "Introduced OCR technology to automatically identify the
opponent during the VS loading screen".

**Replay analysis** [fact; changelog v0.5.0, 2026-09-24]:

- "Cloud Replay Analysis": "Enter a replay ID in 'Replay Analysis' … to load an existing
  analysis or request a new one".
- A per-device quota: "up to 10 manual analysis submissions per hour".
- Task status with retry.
- Views: "round results, damage, and combo data" and timelines of "health, Drive Gauge, and
  stage position".
- v0.5.2 adds replay history and export.

**Data upload** [fact]:

- v0.3.9: optional anonymous usage data.
- v0.3.11: "the current battle record will now also be uploaded for OCR model training".
- v0.4.0: "player play data will be uploaded for future feature development".

**Distribution** [fact]:

- The GitHub repository "does not contain the application source code". It hosts site,
  previews, release notes and downloads under GPL-3.0.
- The OBS instructions reference Windows 10 1903+ capture, so the client is Windows.

## 2. What has independent technical evidence

- **[fact] Replay IDs are public, first-class identifiers.**
  - Buckler's battlelog exposes `replay_id` per match.
  - SST already stores it (`match.external_match_id`, see §5).
  - The game lets players watch a replay by ID.
- **[fact] Frame-level replay data can be extracted with in-game modding, by an unrelated open
  project.** `rkaganda/sf6_replays_data`:
  - uses **REFramework** ("lua scripts that export SF6 replay data to json", and it "allows
    control of SF6 via Python");
  - drives the game UI to open replays one after another (`auto_replay_capture.lua`);
  - records them with **OBS** over websocket;
  - detects round start and end with image templates.

  This shows one feasible family of techniques, which runs **inside the game client** while it
  **plays the replay back**. It is not evidence of how SF6 Scouter does it.

- **[fact] Capcom's in-game Replay menu offers attack and frame data, and "Replay Review"
  takeover.** Analysis tooling therefore exists on the client side.

## 3. What is still unverified about SF6 Scouter

- **[unknown]** How the cloud analysis obtains frame-level data (health, Drive Gauge, positions,
  combos) from a replay ID. Candidates:
  - [hypothesis] Server-side game clients (for example Windows machines with a mod like
    REFramework) that load the replay by ID, play it and export state or video. This fits
    "tasks", "quota" and "retry".
  - [hypothesis] Vision analysis of recorded replay video (OCR or templates of HUD bars).
  - [hypothesis] Parsing a downloadable replay file. No public evidence was found that Capcom
    exposes replay files outside the game.
- **[unknown]** How live W/L and LP/MR are obtained.
  - [hypothesis] Polling the official site (the changelog mentions "official API", "official
    website's request rate" and CFN login), much as SST's Companion reads Buckler.
- **[unknown]** Whether anything is analysed during gameplay. The only documented in-game
  activity is OCR of the VS screen (opponent identification). **Replay analysis is documented as
  post-match and on demand (by replay ID, in the cloud), not live.**
- **[unknown]** Data retention, privacy and terms for uploaded play data and replay analyses. The
  site has no privacy statement.

## 4. Live match tracking vs post-match replay analysis

|             | Live tracking (SST today, SF6 Scouter)                            | Replay analysis (SF6 Scouter 0.5.0)                                                    |
| ----------- | ----------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| When        | Seconds to minutes after a match ends                             | After the match, on request                                                            |
| Input       | Battlelog entries and profile (result, characters, rounds, LP/MR) | The replay itself (frame-level game state)                                             |
| Granularity | Per match (result) and per observation (rating)                   | Per frame or per event (damage, combos, gauges, positions)                             |
| Cost        | Cheap HTTP reads                                                  | Expensive: a game client or video pipeline per replay (hypothesis), minutes per replay |
| Infra       | Web app + DB                                                      | Job queue + workers (likely Windows with the game) + storage                           |

## 5. Replay data SST retains today [fact, from code]

- **`match` table:**
  - `external_match_id`: Buckler's `replay_id`, unique per player;
  - `played_at`: `uploaded_at`;
  - `mode` and `result`;
  - character key and name;
  - opponent name, character key, character name and rank;
  - `rating_before_*` / `rating_after_*`, which are **null** for battlelog replays (no
    post-match rating);
  - `session_id`.
- **Parsed but not stored:** the parser reads each player's `round_results`
  (`packages/sf6-capcom-core/src/parse.ts`), but only the derived result is persisted.
  Rounds won and lost (`roundsWon`, `roundsLost`) are computed for the result, but there are no
  columns for them.
- **Ratings:** the session baseline/final per character (`session_character_baseline`) and the
  latest observation per character (`player_character_rating`). There is no per-match rating
  history.
- **Nothing frame-level:** no inputs, health, gauges, damage, combos, positions or video.

## 6. Identifiers and metadata already available

- **Replay ID** (`external_match_id`) for every ingested match. It is the key any replay-analysis
  service would need.
- **Players:** the tracked player's CFN short id, plus the opponent's display name, character
  and rank at the time. Opponent CFN ids and raw payloads are **not** stored (`docs/architecture.md`,
  "Privacy: data kept from CFN").
- **Round outcomes:** available in the battlelog payload (`round_results`). They could be stored
  with an additive column, which would need a migration and is not part of this phase.

## 7. Could replay analysis be added without changing the Companion?

- **Yes, for job submission.** The replay IDs are already in SST's database. A server-side job
  could take `(external_match_id, player)` without any Companion change.
- **No, for the analysis itself, under SST's current rules.** Producing frame-level data needs a
  game client that plays the replay. Today only the game can do that. It would mean:
  - an always-on Windows machine with SF6 and a legitimately owned account, driven by
    automation or a mod;
  - or a user-side helper running alongside the game.

  Neither fits the Companion's design. The Companion is a browser extension that reads Buckler
  pages the user already sees. It does no game-process access, memory reading or injection.

## 8. Legitimate, supportable approaches

1. **Battlelog-level enrichment (low risk, no game access).**
   - Store round results (2–0, 2–1, …).
   - Keep the per-match opponent rank.
   - A per-match rating timeline from profile observations needs the separate
     rating-observation log already deferred in 5.6C. It needs a migration, retention and a
     privacy decision.
   - This gives "round score" recaps and matchup insight without replays.
2. **User-provided video (medium).** The streamer already records in OBS. An opt-in, offline or
   local analysis of their own VOD could detect HUD elements (health, Drive Gauge) with
   templates or OCR.
   - The work is heavy CV and fragile across UI patches and resolutions.
   - Data is the user's own, from the user's machine.
3. **In-game modding (high risk).** REFramework-style export (§2) gives exact data, but:
   - it requires running a mod inside the game;
   - it raises anti-cheat and terms-of-service questions;
   - it breaks on game updates;
   - it requires Windows hardware per worker.

   **Not recommended** for SST without explicit legal review and Capcom's position.

4. **Official channels (preferred if they ever exist).** Watch for any Capcom-provided replay
   export or API. None was found.

## 9. Proof of concept that would be needed (Phase 5.7, research only)

1. **Round-results enrichment (approach 1):**
   - a migration-free spike on fixtures;
   - parse and display rounds from the stored battlelog samples;
   - then a migration proposal (`rounds_won`, `rounds_lost`).
2. **Replay-analysis spike (approach 2):**
   - on the developer's own recordings only;
   - measure how accurately health and Drive Gauge can be read from 1080p and 720p OBS
     recordings across stages and characters;
   - estimate CPU time per match;
   - **go/no-go** on accuracy (for example ≥ 98 % of correct round boundaries, ≥ 95 % of
     health-delta events within ±1 frame).
3. **Legal check** before any approach that runs inside the game or processes others' replays.

## 10. Risks

- **Performance:** frame-level analysis costs minutes of CPU/GPU per match; it needs queues,
  quotas and storage (SF6 Scouter itself rate-limits to 10 per hour per device).
- **Privacy:**
  - replays include opponents; analysing them is processing third parties' play;
  - SF6 Scouter's uploads "for OCR model training" and "future feature development" show the
    kind of data use SST should **not** copy without explicit, granular consent.
- **Legal and platform policy:**
  - in-game mods or automation may breach Capcom's terms or anti-cheat;
  - scraping beyond what the user can see in Buckler conflicts with SST's rules (no anti-bot
    evasion, no private endpoints);
  - copying SF6 Scouter's code, branding or assets is not allowed: its code is not public and
    the repository is GPL-3.0.
- **Maintenance:** HUD templates, mod hooks and parsers break on every game patch or UI change.

## 11. Implications for SST's Render/Supabase architecture

- The current design (Next.js web + worker + Postgres + SSE, free or low tiers) **cannot host**
  frame-level analysis:
  - there are no Windows/GPU workers and no game clients;
  - storage for video or frame data would exceed the Supabase free-tier limits.
- **Approach 1** fits as-is: a few columns or a small observation table, with the same ingestion
  path.
- **Approach 2**, as a local/offline tool, would keep heavy compute on the user's machine. SST
  would receive only small derived summaries, opt-in.

## 12. What to defer to Phase 5.7

- **Recommended scope:**
  - round-results enrichment, with a migration proposal and a recap «2–1» per match;
  - a rating-observation log (per-character MR/LP after each profile observation), which is
    what an honest MR journey needs. Retention, privacy and compatibility must be designed
    first;
  - a time-boxed VOD analysis spike on the developer's own footage, with go/no-go criteria
    (§9).
- **Out of scope until legal review:** any in-game mod or automation, server-side game
  clients, and processing replays of players who did not opt in.

## Sources

- SF6 Scouter, GitHub (distribution repository): <https://github.com/RengarLee/sf6_scouter>
- SF6 Scouter website: <https://www.sf6scouter.com/>
- SF6 Scouter changelog: <https://www.sf6scouter.com/changelog>
- `rkaganda/sf6_replays_data` (REFramework + OBS replay export, unrelated project):
  <https://github.com/rkaganda/sf6_replays_data>
- SF6 in-game replay tools and Replay Review: <https://www.wepc.com/gaming/how-to-watch-replays-sf6/>,
  <https://automaton-media.com/en/news/street-fighter-6s-upcoming-replay-review-feature-will-make-learning-from-mistakes-easier/>
- SST code: `packages/sf6-capcom-core/src/parse.ts`, `src/server/db/schema.ts`,
  `docs/architecture.md`.
