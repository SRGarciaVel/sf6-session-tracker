# M2E: real SF6 character portraits, asset source and licensing gate

**Type:** source and licensing feasibility only. No images, code, dependencies or configuration
are changed.

| Item                              | Value                                                                                            |
| --------------------------------- | ------------------------------------------------------------------------------------------------ |
| Base                              | `main` at `6630b69` (M2D #85 merged)                                                             |
| Licensing sources checked         | **2026-10-27, 01:23–01:27 UTC** (2026-10-26, 22:23–22:27 local UTC−3), from the fetch timestamps |
| OBS / Render sources checked (§7) | **2026-10-27, after 01:38 UTC**                                                                  |

Pages were read directly (HTTP fetch of the official pages, and the Wikimedia and YouTube
metadata). No image was downloaded.

> This is a technical and policy assessment for the repository owner. **It is not legal advice.**
> SST has no licence, partnership or endorsement from Capcom.

## 1. Executive summary: NO-GO

**NO-GO: source authorization not established.** No source was found whose terms or written
authorization clearly cover the intended use: displaying SF6 fighter portraits in SST's OBS
overlays, **bundling the image files in a public MIT repository** and **distributing them with an
application that may be commercialized**.

- **Directly verified official sources** (primary pages read) reserve these rights or exclude
  them:
  - Capcom website terms (USA and global);
  - Fan Content Guidelines;
  - Video Policy.
- **Secondary, unverified context (not used as evidence):** the 2026 Japan Community Tournament
  Guidelines are known only from secondary reporting; the primary page was not retrieved. As
  reported, they concern tournaments, not software assets (row E).
- **The licensing route is a paid business process.** Capcom's official **License Business
  website** offers licences only by contract (inquiry, contract, design approval, royalties). It
  declines «personal/private… community» uses.
- **New lead: Capcom France on YouTube.** Some **Capcom France YouTube videos are marked CC BY**
  (verified on YouTube). It is the only formal free licence found. It stays **unresolved**:
  - it is unclear whether the subsidiary has the authority, and the intent;
  - each video must be verified separately, and Commons' own template warns about this;
  - guest characters are third-party IP;
  - it yields trailer frames, not portraits;
  - it contradicts Capcom's other published terms.

  The project's precautionary standard (audit §5, «unverified ⇒ not bundled») is not met.

**What stays in force:** the M2D SST-native identity plate (#85) remains the only shipped
identifier. No real portraits are implemented until §4 is satisfied.

**Alternative evaluated (§7–§8): user-provided portraits.** This is not a substitute for the
permission above if SST itself distributes Capcom artwork. The lowest-risk direction is
**local-only images inside OBS**: no server storage and no CSP, schema or SSE change. It is gated
on a real-OBS prototype, because its key premise is verified in code but not yet in a running
OBS.

## 2. Decisions from the previous audit that remain in force

From `character-portraits-audit.md` (#84), `docs/creator-overlays.md`, `docs/brand/NOTICE.md`,
`next.config.ts` and `docs/entitlements.md`:

- **SST ships no official Capcom assets** (`creator-overlays.md`). No remote images in OBS, and
  the CSP is `img-src 'self' data: blob:`.
- The repository is **public and MIT-licensed**: committing an image file redistributes it.
- A `creator_beta` plan exists and commercialization is planned (RFC 0001). The intended use must
  therefore be assessed as **potentially commercial**.
- The overlay's fighter is `ratingParts().characterKey`. The M2D plate is the fallback for any
  character without an authorized asset.
- **Already established, not repeated here** (audit §5): the Fan Content Guidelines exclude «as
  is» use and monetization, and the Video Policy forbids distributing game components «as
  separate content».

The questions that blocked implementation (audit §12.1–2) were: _is there a licence covering SF6
portraits in a third-party tool, including redistribution and a commercial future?_ This document
answers them.

## 3. Candidate sources

The columns are: displaying the portraits; redistributing the files in a public repository;
possible commercial use; modification (crop, resize, convert); and roster coverage.

| #   | Source (canonical URL)                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | Official?                   | Applicable terms (verified)                                                                                                                                                                                                                                                                                                                                                                                                                      | Display                  | Redistribute in public repo | Commercial   | Modify                                                         | Full roster                                                                           | Verdict                                          |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------ | --------------------------- | ------------ | -------------------------------------------------------------- | ------------------------------------------------------------------------------------- | ------------------------------------------------ |
| A   | Capcom USA site terms, [capcomusa.com/terms](https://www.capcomusa.com/terms/) (last updated Apr 29, 2022)                                                                                                                                                                                                                                                                                                                                                                             | yes                         | personal, non-commercial viewing only; _«You do NOT have our permission to distribute the Content, publicly display it, charge any fee or otherwise commercialize it … construct a database with it»_                                                                                                                                                                                                                                            | ✗                        | ✗                           | ✗            | ✗ («create derivative works … without our express permission») | —                                                                                     | **NO**                                           |
| B   | Capcom global terms, [capcom-games.com/en/terms](https://www.capcom-games.com/en/terms/). The server-rendered `streetfighter.com` footer links here (and to `/en/legal/tm/`). That indicates these terms govern the SF6 website, but it **does not by itself establish the contractual scope of every Buckler's Boot Camp page or CDN-served image**: Buckler or CFN may have their own terms (account and game terms, not retrieved). Nothing found grants redistribution either way. | yes                         | _«any duplication, adaptation, translation, modification, screening, distribution, sale, public transmission … without permission from Capcom is strictly prohibited»_                                                                                                                                                                                                                                                                           | ✗                        | ✗                           | ✗            | ✗                                                              | —                                                                                     | **NO**                                           |
| C   | [Fan Content Guidelines](https://www.capcom-games.com/en/fan-content-guidelines/) (Nov 4, 2025)                                                                                                                                                                                                                                                                                                                                                                                        | yes                         | «as is» use without creative input is not covered; no monetization; third-party IP is excluded; Capcom may revoke at will (audit §5.1)                                                                                                                                                                                                                                                                                                           | ✗ for official art       | ✗                           | ✗            | n/a                                                            | —                                                                                     | **NO**                                           |
| D   | [Video Policy](https://www.capcomusa.com/video-policy/) (Mar 15, 2021)                                                                                                                                                                                                                                                                                                                                                                                                                 | yes                         | game footage only; _«may not split our game content into components … and distribute such components»_; not a licence for derivative works                                                                                                                                                                                                                                                                                                       | ✗                        | ✗                           | ✗            | ✗                                                              | —                                                                                     | **NO**                                           |
| E   | Community Tournament Guidelines, Japan (Apr 28, 2026)                                                                                                                                                                                                                                                                                                                                                                                                                                  | yes                         | scope: Japan-based, non-profit **tournaments**. Primary page not retrieved; known only via [saiganak.com](https://saiganak.com/en/news/capcom-community-tournament-guidelines/)                                                                                                                                                                                                                                                                  | n/a                      | n/a                         | n/a          | n/a                                                            | —                                                                                     | **not applicable** (events, not software assets) |
| F   | Official press / streamer / creator kit                                                                                                                                                                                                                                                                                                                                                                                                                                                | —                           | **none found publicly** (searched); press portals are not public licences                                                                                                                                                                                                                                                                                                                                                                        | —                        | —                           | —            | —                                                              | —                                                                                     | **not found**                                    |
| G   | **Capcom France YouTube videos marked CC BY**, e.g. [«Trailer de gameplay de Yasmine»](https://www.youtube.com/watch?v=kmWdqwfTTtk)                                                                                                                                                                                                                                                                                                                                                    | Capcom subsidiary channel   | YouTube shows **«Creative Commons Attribution license (reuse allowed)»** with `ownerChannelName: "Capcom France"` (verified 2026-10-27). [YouTube Help](https://support.google.com/youtube/answer/2797468) links CC BY 4.0. Commons lists 70 SF6 videos from the channel ([category](https://commons.wikimedia.org/wiki/Category:Videos_by_Capcom_France)).                                                                                      | ✓ _if valid_             | ✓ _if valid_ (attribution)  | ✓ _if valid_ | ✓ _if valid_ (indicate changes)                                | **no**: guest characters are third-party IP; some fighters have no dedicated CC video | **UNRESOLVED** (§3.1)                            |
| H   | Wikimedia Commons stills, e.g. [File:Street Fighter 6 gameplay.jpg](https://commons.wikimedia.org/wiki/File:Street_Fighter_6_gameplay.jpg) (CC BY 3.0, «extracted from» the Yasmine trailer)                                                                                                                                                                                                                                                                                           | third-party                 | inherits G                                                                                                                                                                                                                                                                                                                                                                                                                                       | same as G                | same as G                   | same as G    | same as G                                                      | no                                                                                    | **UNRESOLVED** (inherits G)                      |
| I   | Wikimedia Commons event photos (e.g. Tokyo Game Show 2023 booths, CC BY 4.0 «own work»)                                                                                                                                                                                                                                                                                                                                                                                                | third-party                 | the photographer's licence covers the photo, not the Capcom artwork it depicts                                                                                                                                                                                                                                                                                                                                                                   | ✗ for crops of the art   | ✗                           | ✗            | ✗                                                              | no                                                                                    | **NO**                                           |
| J   | Fan wikis, e.g. Street Fighter Wiki ([File:SF6-AKI.jpg](https://streetfighter.fandom.com/wiki/File:SF6-AKI.jpg))                                                                                                                                                                                                                                                                                                                                                                       | third-party                 | the file page carries **no licence template or category** (API, 2026-10-27); an uploader cannot license Capcom's art. Fandom's licensing page could not be retrieved.                                                                                                                                                                                                                                                                            | ✗                        | ✗                           | ✗            | ✗                                                              | —                                                                                     | **NO**                                           |
| K   | Fan art / commissioned «SST-style» illustrations of SF6 fighters                                                                                                                                                                                                                                                                                                                                                                                                                       | third-party                 | still derivative works of Capcom characters: bound by C (no commercial use, revocable) and needs each artist's licence                                                                                                                                                                                                                                                                                                                           | ✗ without Capcom         | ✗                           | ✗            | —                                                              | —                                                                                     | **NO** without a Capcom licence                  |
| L   | Game files, Buckler / CDN images, asset dumps                                                                                                                                                                                                                                                                                                                                                                                                                                          | —                           | forbidden by this task's constraints and by A and B                                                                                                                                                                                                                                                                                                                                                                                              | ✗                        | ✗                           | ✗            | ✗                                                              | —                                                                                     | **excluded**                                     |
| M   | **Capcom License Business website**, [capcom-games.com/license/en](https://www.capcom-games.com/license/en/)                                                                                                                                                                                                                                                                                                                                                                           | **yes (licensing channel)** | licences by contract only: inquiry form, then CAPCOM licensing form, contract, design check, approval; fees or royalties «depending on various conditions». _«We are unable to license out our IPs to personal/private events (such as … community events), whether … for profit/non-profit»_ ([Q&A](https://www.capcom-games.com/license/en/qa/)). _«as long as CAPCOM has the ownership of the character»_. SF6 licensees are actively sought. | ✓ _only with a contract_ | per contract                | per contract | per contract                                                   | Capcom-owned characters only                                                          | **the route to GO** (§4)                         |

### 3.1 Why source G (Capcom France CC BY) is unresolved, not a GO

**Verified:**

- the video exists on a channel named Capcom France;
- YouTube displays the CC BY licence for it;
- Commons hosts derived stills and video copies under that licence.

**Unresolved:**

1. **Authority and intent.** A YouTube CC BY label is the uploader's **statement**. It is **not
   verified authority** to license all the underlying intellectual property: characters, designs,
   music and guest IP. A Commons deletion request on the same channel's CC BY releases
   ([DR, kept, March 2025](https://commons.wikimedia.org/wiki/Commons:Deletion_requests/File:Phoenix_Wright_in_Phoenix_Wright_Ace_Attorney.png))
   was **contested**: one participant called it «99.9% certain … a mistake», and others answered
   that Capcom is bound by its subsidiary. That is a community judgement, not a legal ruling. It
   is unknown whether Capcom France (a subsidiary) is authorized to license imagery owned by
   CAPCOM Co., Ltd. under CC BY. YouTube places this on the uploader: «if the content is
   licenseable». The CC BY marking also conflicts with Capcom's own published terms (A, B, D).
2. **Per-video verification.** The Commons template itself states: _«This template does not apply
   to all videos on the Capcom France channel. It must be verified that the source video actually
   has the licence.»_ A licence can also be removed from a page in the future. CC licences are
   irrevocable for copies already obtained, but proving which version applied then becomes SST's
   burden.
3. **Third-party characters.** SF6 includes guests whose rights are not Capcom's: **Terry
   Bogard** and **Mai Shiranui** (SNK) and **Tifa Lockhart** (Square Enix, «Year 4» trailer). Capcom
   France cannot license them, and Capcom's guidelines exclude third-party IP (C §III). The M (Q&A)
   page is limited to characters Capcom owns.
4. **Quality and coverage.** These are trailer frames with motion, effects and UI. A portrait would
   need cropping (allowed under CC BY with «indicate changes»). Consistency across fighters is not
   guaranteed, and several fighters (for example Ryu, Ken, Jamie, Kimberly, JP, Juri, Dee Jay,
   Manon, Marisa, Dhalsim, Blanka, A.K.I.) have no dedicated CC BY video in the Commons
   catalogue. That is not proof that none exists, but each one would need its own verified source.
5. **Trademarks and endorsement.** CC licences do not grant trademark rights, and CC BY forbids
   implying endorsement. Attribution would have to avoid suggesting any Capcom affiliation
   (`NOTICE.md`).

**Conclusion for G:** promising, but not «clear coverage». Bundling these frames would conflict
with the project's precautionary rule. It needs the written confirmation in §4.

## 4. Permissions confirmed vs unresolved, and the required authorization

**Confirmed:**

- No Capcom website, fan or video policy grants redistribution or commercial use of character
  art (A–D).
- Capcom runs an official, contract-based licensing channel for SF6 (M).
- Some Capcom France YouTube videos display CC BY (G).

**Unresolved:**

- the validity and scope of G (§3.1);
- whether Capcom's licensing team would license an individual open-source project at all. The
  M Q&A addresses businesses and declines community uses; SST has no company entity documented in
  this repository.

**Required before any GO.** Written authorization from CAPCOM Co., Ltd. (or an entity it confirms
in writing) that explicitly covers:

1. **Which assets:** an agreed set of SF6 character portrait images, by character list. This
   could be Capcom-supplied files or frames from named CC BY videos.
2. **Use:** display in SST's OBS browser-source overlays and its dashboard preview.
3. **Redistribution:** storing the image files in SST's **public source repository** (currently
   MIT for code, with an explicit carve-out that the images are _not_ MIT) and serving them from
   SST's servers.
4. **Commercial use:** a free tier and paid plans (Creator) of the service.
5. **Modifications:** resize, crop, format conversion and theme framing. No other alteration.
6. **New characters:** future roster additions, or a defined update process.
7. **Notices:** the required copyright and trademark notice, the attribution text, and the
   «not affiliated / not endorsed» wording.
8. **Term, territory and revocation:** the takedown procedure SST must follow.
9. **Guests** (Terry, Mai, Tifa and any future guest): **separate** written permission from each
   rights holder (SNK, Square Enix), or explicit exclusion. Excluded guests keep the M2D plate.

**Channel:**

- the Capcom Licensing Business Inquiry Form, linked from
  [capcom-games.com/license/en](https://www.capcom-games.com/license/en/) (Contact Us);
- or the email it offers when the form fails, `license-asia@capcom.com`. Its template asks for:
  name, company, company URL, IP or title, characters, purpose and territories.

**For source G specifically:** written confirmation from Capcom (licensing) that the CC BY marking
on Capcom France's SF6 videos is authorized, and that it covers extracting character stills for
the uses in points 2–5.

The repository owner must decide whether to apply. It is a business negotiation with likely fees
or royalties and approvals, and an entity may be required. Until then the decision stays
**NO-GO**.

## 5. Contingent implementation scope (only after written authorization)

This would be a separate, narrow PR. **Do not start without the signed authorization stored
outside the public repository and summarized in `docs/brand/`.**

- **Assets:** local, versioned files under `public/portraits/sf6/<characterKey>.<hash>.webp`.
  - fixed dimensions, for example 160×160, with explicit `width`/`height`;
  - each file ≤ 15 KB;
  - a `LICENSE-PORTRAITS.md` beside them that states the grant and excludes the files from MIT;
  - no remote URLs, no CSP change.
- **Mapping:** one pure module, `domain/overlay/portraits.ts`, mapping
  `characterKey → { src, width, height }` deterministically, only for authorized keys.
  - Selection reuses `ratingParts().characterKey`.
  - Unknown, guest or missing keys, and `random`, fall back to the M2D plate.
- **Rendering:** the existing `IdentityPlate` slot in all six themes shows the portrait when
  `identityPlate === "auto"` and an asset exists. Otherwise it shows the typographic or vector
  plate.
  - The character name stays visible text.
  - Same sizes and slots as M2D, so no new layout risk.
  - The image is `alt=""` (the name is adjacent), `decoding="async"`, and `onError` falls back to
    the plate.
- **Defaults:** no change to `identityPlate`. A portrait only replaces the plate's glyphs inside
  the same slot, so stored `off` overlays stay off. Any default change needs separate review.
- **Untouched:** no database field, schema, SSE, Companion, network request or runtime image
  service.

**Acceptance criteria:**

1. For active, pinned, rotated and idle cases, the portrait shown is that of
   `ratingParts().characterKey`. It is never stale after a character change, verified through
   real Companion sync in Chromium.
2. Unknown, guest, `random`, missing-asset and failed-load cases show the M2D plate; no broken
   image is ever rendered.
3. The six themes at every supported canvas keep the M2D matrix guarantees: no overflow, metrics
   identical, scale ≥ 0.85.
4. The OBS page loads only same-origin portrait files: at most one request per character shown,
   cacheable, immutable. No other new request. Reduced motion changes nothing; there is no
   animation.
5. The repository contains only authorized files, their licence file and the notice wording
   approved in the authorization. The README and NOTICE do not claim endorsement.

## 7. Alternative: user-provided portraits (evaluation only)

The idea: SST never ships or chooses portrait images. Each streamer may provide their own, and
the typographic plate stays the fallback for every character without one (missing, unknown,
`random`, unconfigured). Nobody has to upload the whole roster.

**What it does not solve.** It is **not a licence**. It reduces what SST itself distributes; it
does not make Capcom artwork free to use. If SST stores, serves or displays the files (B), SST
takes part in hosting and transmitting them. Either way the streamer remains responsible for the
images they choose. SST must not supply, recommend or link sources of Capcom art. That is a
policy position, not legal advice.

### 7.1 Facts about SST and OBS that shape the options

Verified on 2026-10-27, from code and primary documentation.

| #   | Fact                                                                                                                                                                                                                                                                                                                                                                            | Source                                                                                                                                                                                                                                                                                                                           |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| V1  | The overlay CSP allows images only from `'self' data: blob:`                                                                                                                                                                                                                                                                                                                    | `next.config.ts:22`                                                                                                                                                                                                                                                                                                              |
| V2  | The OBS page and the dashboard are the **same origin** (`/overlay/[token]` and `/dashboard/...` in one Next.js app)                                                                                                                                                                                                                                                             | `src/app/(overlay)`, `src/app/(app)`                                                                                                                                                                                                                                                                                             |
| V3  | The OBS stream sends the **full** `{ config, live }` on every `state` event, and compares serialized configs for changes                                                                                                                                                                                                                                                        | `src/app/api/overlay/[token]/stream/route.ts:74–80`                                                                                                                                                                                                                                                                              |
| V4  | `overlay.config` (jsonb) has **no size constraint**; only presets are capped at 8 KB                                                                                                                                                                                                                                                                                            | `src/server/db/schema.ts` (overlay vs `creator_overlay_preset_config_ck`)                                                                                                                                                                                                                                                        |
| V5  | There is **no file or object storage**: no Supabase Storage, S3 or upload code, and no storage env vars in `.env.example`                                                                                                                                                                                                                                                       | repository grep; `package.json`; `.env.example`                                                                                                                                                                                                                                                                                  |
| V6  | Production is a Render **Free** Web Service. Render's filesystem is **ephemeral by default**, and persistent disks attach only to **paid** services                                                                                                                                                                                                                             | `docs/deploy-render.md`; [Render: Disks](https://render.com/docs/disks)                                                                                                                                                                                                                                                          |
| V7  | **OBS Browser Sources** are created with no request context (`CreateBrowserSync(…, nullptr)`), so they use CEF's **global** context. Its `cache_path` / `root_cache_path` is OBS's own module config folder (`plugin_config/obs-browser`), which holds `Default/Local Storage` and `Session Storage`. That is a **persistent profile separate from the user's normal browser**. | [obs-browser `obs-browser-plugin.cpp`](https://github.com/obsproject/obs-browser/blob/master/obs-browser-plugin.cpp) (`settings.cache_path = conf_path_abs`; master `85c7f26`, 2026-10-20), [`obs-browser-source.cpp`](https://github.com/obsproject/obs-browser/blob/master/obs-browser-source.cpp)                             |
| V8  | **Custom Browser Docks** (`AddExtraBrowserDock`) are created with `create_widget(dock, url, nullptr)`, so they **also use the global context**. Only service integrations (Twitch, YouTube, Restream) use the per-OBS-profile `panel_cookies` context (`obs_profile_cookies_<id>`).                                                                                             | [obs-studio `OBSBasic_Browser.cpp`](https://github.com/obsproject/obs-studio/blob/master/frontend/widgets/OBSBasic_Browser.cpp) (line ~122), [obs-browser `browser-panel.cpp`](https://github.com/obsproject/obs-browser/blob/master/panel/browser-panel.cpp) (`create_widget`: a null cookie manager means the default context) |

**Inferences** (they follow from V2, V7 and V8, but **need a real-OBS prototype**):

- I1: a Custom Browser Dock and a Browser Source loading the same SST origin share
  `localStorage` / IndexedDB;
- I2: that storage survives OBS restarts and the source's «Refresh cache of current page»;
- I3: it is shared by every overlay of that origin, and across OBS scene collections and profiles;
- I4: it is **not** shared with Chrome, Edge or Firefox, nor with other streaming apps
  (Streamlabs, XSplit, Meld) or another machine.

### 7.2 A. Local-only images (never sent to SST)

- **How it would work.** The streamer opens an SST «portraits» page **inside OBS as a Custom
  Browser Dock** (V8), picks an image per character, and the page stores the file (a Blob) in
  IndexedDB keyed by `characterKey`. The overlay in the Browser Source reads the same IndexedDB
  (I1) and renders a `blob:` URL (allowed by V1) inside the existing M2D plate slot. With no image,
  it shows the plate.
- **Persistence and multiple overlays:** see I2 and I3. One set of images serves every overlay.
- **What does not work:**
  - Images added in the normal browser dashboard **are not visible in OBS** (I4), and the
    dashboard preview in a normal browser would show the plate.
  - Not portable across machines or OBS reinstalls. Deleting `plugin_config/obs-browser` loses
    them.
  - Other broadcasting apps are unverified.
- **Do not assume:** browser file paths (`file://`) are not readable from an `https` page;
  `localStorage` is too small and string-only for images; quota and eviction behaviour inside CEF
  is unverified.
- **Security and privacy.** The images never leave the machine and there is no server attack
  surface. Pages on the SST origin can read the store, so the store should be limited to decoded
  image blobs with type and size checks and no SVG.
- **Contracts.** No change to the CSP, schema, SSE or server. The overlay gains a client-only read.

### 7.3 B. Images stored by SST

- **Storage options:**
  - the existing Postgres (Supabase) as `bytea` in a new per-user table;
  - or object storage (Supabase Storage or another) that is **not configured today** (V5) and
    would add credentials, a dependency and costs.
  - The local disk is ruled out (V6).
- **Scope:** per **user**, keyed by `characterKey`, so it is reused by every overlay and every
  device of that user.
- **Access:**
  - upload and delete only as the authenticated owner (the existing session and the
    `authorizedPlayer` pattern);
  - reads through a same-origin route scoped to the overlay's public token, so files are
    reachable only for that overlay's owner;
  - IDOR tests like the existing ones.
- **Validation:**
  - an allow-list of PNG, WebP and JPEG, checked by magic bytes; no SVG;
  - a size cap (for example ≤ 128 KB) and a dimension cap;
  - strip metadata (EXIF can contain location);
  - ideally server-side re-encoding. That likely needs an image library, which would be a new
    dependency to review.
- **Quotas and costs:** a cap of one image per character per user, a total cap per account, and
  rate limits on uploads. Database size and egress count against the Supabase and Render plans.
- **Deletion:** per image, on account deletion (FK cascade), and on a takedown request.
- **Transport:** **never through SSE** (V3 would resend it on every update). At most, the payload
  carries a small `characterKey → content hash` map; the overlay fetches
  `/…/portrait/<hash>` with `Cache-Control: public, immutable`. That is an **additive** change
  to the payload contract, needing its own review.
- **Moderation and legal:** SST would be hosting and serving third-party content shown on live
  streams. It needs:
  - terms for uploaded content;
  - a takedown or notice-and-action process, and a designated contact where the law requires
    one;
  - abuse handling (offensive images).

  This is the option with the most legal and operational exposure. **It needs legal and
  operational review before any implementation.**

### 7.4 C. External image URLs

- **Contracts:** it requires relaxing V1 (`img-src`) for the OBS surface.
- **Reliability:** the remote host can block hotlinking (the overlay sends `no-referrer`), go
  down, move or change the image.
- **Privacy:** every OBS load contacts the third-party host from the streamer's machine (IP and
  timing leak).
- **Security:** tracking pixels, content swapped after setup, mixed content. A server-side proxy
  would add SSRF risk.
- **Legal:** it moves no responsibility away from the streamer, and SST would be
  configuring the display of material it never checked.
- **Verdict:** not a good default; not recommended.

## 8. Comparison and recommended next step

|                              | Bundled by SST (§3–5)       | A. Local-only in OBS                                                         | B. Stored by SST                                                                 | C. External URLs                             |
| ---------------------------- | --------------------------- | ---------------------------------------------------------------------------- | -------------------------------------------------------------------------------- | -------------------------------------------- |
| Legal / IP (not a guarantee) | **NO-GO** without a licence | SST neither stores nor distributes; the streamer's choice                    | SST hosts and serves third-party art: highest exposure, needs takedown and terms | SST configures the display; it hides nothing |
| OBS architecture fit         | same-origin static files    | fits V1, V2 (`blob:`) with no server, SSE or schema change; depends on I1–I3 | new table, routes and payload map; additive contract change                      | needs a CSP change                           |
| Persistence and portability  | everywhere                  | one OBS install only; not the web dashboard                                  | every device                                                                     | every device, if the host stays up           |
| Complexity and cost          | low after a licence         | low to medium: one dock page + IndexedDB, and docs for the dock workflow     | high: storage, validation, quotas, moderation, legal                             | low code, high risk                          |
| Security and privacy         | good                        | best (nothing leaves the machine)                                            | upload surface, metadata, abuse                                                  | IP leak, tracking, content swap              |
| UX                           | automatic                   | manual, in an OBS dock; partial roster is fine (plate fallback)              | manual, in the normal dashboard                                                  | manual and fragile                           |

**Recommendation.** If the owner wants user-provided portraits, pursue **A (local-only) as a
time-boxed prototype first**, not as a shipped feature. The prototype is a separate PR and a
manual test in real OBS, Windows and macOS. It must prove I1–I3:

- dock and source share IndexedDB on the SST origin;
- the images survive an OBS restart and «Refresh cache of current page»;
- multiple overlays all see them;
- `blob:` images render in the Browser Source.

It should also confirm the dock workflow is acceptable to streamers.

- **If the prototype fails**, or the dock workflow is rejected, revisit B, but **only after a
  legal and operational review**.
- **C should not be pursued.**
- **In every case:**
  - the M2D plate stays the fallback;
  - the overlay's character remains `ratingParts().characterKey`;
  - nothing is required per character;
  - SST does not supply, recommend or link Capcom art.

## 9. Documentation checks

Documentation-only change: this file. §7–§8 evaluate user-provided portraits; nothing is
implemented.

- No other document contradicts it. `creator-overlays.md` («SST ships no official Capcom
  assets») and the audit remain accurate under NO-GO.
- Commands run: `npx prettier --check design/phase-m2/character-portraits-licensing-gate.md`,
  `git diff --check`, and `pnpm check` to confirm nothing else changed. Results are in the PR.
