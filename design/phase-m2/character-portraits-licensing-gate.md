# M2E: real SF6 character portraits, asset source and licensing gate

**Type:** source and licensing feasibility only. No images, code, dependencies or configuration
are changed.

| Item          | Value                                |
| ------------- | ------------------------------------ |
| Base          | `main` at `6630b69` (M2D #85 merged) |
| Research date | 2026-10-27                           |

Pages were read directly (HTTP fetch of the official pages, and the Wikimedia and YouTube
metadata). No image was downloaded.

> This is a technical and policy assessment for the repository owner. **It is not legal advice.**
> SST has no licence, partnership or endorsement from Capcom.

## 1. Executive summary: NO-GO

**NO-GO: source authorization not established.** No source was found whose terms or written
authorization clearly cover the intended use: displaying SF6 fighter portraits in SST's OBS
overlays, **bundling the image files in a public MIT repository** and **distributing them with an
application that may be commercialized**.

- **Every official Capcom framework read reserves these rights or excludes them:**
  - website terms (USA and global);
  - Fan Content Guidelines;
  - Video Policy;
  - the 2026 Japan tournament guidelines (reported by secondary sources).
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

| #   | Source (canonical URL)                                                                                                                                                                           | Official?                   | Applicable terms (verified)                                                                                                                                                                                                                                                                                                                                                                                                                      | Display                  | Redistribute in public repo | Commercial   | Modify                                                         | Full roster                                                                           | Verdict                                          |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------ | --------------------------- | ------------ | -------------------------------------------------------------- | ------------------------------------------------------------------------------------- | ------------------------------------------------ |
| A   | Capcom USA site terms, [capcomusa.com/terms](https://www.capcomusa.com/terms/) (last updated Apr 29, 2022)                                                                                       | yes                         | personal, non-commercial viewing only; _«You do NOT have our permission to distribute the Content, publicly display it, charge any fee or otherwise commercialize it … construct a database with it»_                                                                                                                                                                                                                                            | ✗                        | ✗                           | ✗            | ✗ («create derivative works … without our express permission») | —                                                                                     | **NO**                                           |
| B   | Capcom global terms, [capcom-games.com/en/terms](https://www.capcom-games.com/en/terms/). The `streetfighter.com` footer links here, so this covers the SF6 site and Buckler's Boot Camp images. | yes                         | _«any duplication, adaptation, translation, modification, screening, distribution, sale, public transmission … without permission from Capcom is strictly prohibited»_                                                                                                                                                                                                                                                                           | ✗                        | ✗                           | ✗            | ✗                                                              | —                                                                                     | **NO**                                           |
| C   | [Fan Content Guidelines](https://www.capcom-games.com/en/fan-content-guidelines/) (Nov 4, 2025)                                                                                                  | yes                         | «as is» use without creative input is not covered; no monetization; third-party IP is excluded; Capcom may revoke at will (audit §5.1)                                                                                                                                                                                                                                                                                                           | ✗ for official art       | ✗                           | ✗            | n/a                                                            | —                                                                                     | **NO**                                           |
| D   | [Video Policy](https://www.capcomusa.com/video-policy/) (Mar 15, 2021)                                                                                                                           | yes                         | game footage only; _«may not split our game content into components … and distribute such components»_; not a licence for derivative works                                                                                                                                                                                                                                                                                                       | ✗                        | ✗                           | ✗            | ✗                                                              | —                                                                                     | **NO**                                           |
| E   | Community Tournament Guidelines, Japan (Apr 28, 2026)                                                                                                                                            | yes                         | scope: Japan-based, non-profit **tournaments**. Primary page not retrieved; known only via [saiganak.com](https://saiganak.com/en/news/capcom-community-tournament-guidelines/)                                                                                                                                                                                                                                                                  | n/a                      | n/a                         | n/a          | n/a                                                            | —                                                                                     | **not applicable** (events, not software assets) |
| F   | Official press / streamer / creator kit                                                                                                                                                          | —                           | **none found publicly** (searched); press portals are not public licences                                                                                                                                                                                                                                                                                                                                                                        | —                        | —                           | —            | —                                                              | —                                                                                     | **not found**                                    |
| G   | **Capcom France YouTube videos marked CC BY**, e.g. [«Trailer de gameplay de Yasmine»](https://www.youtube.com/watch?v=kmWdqwfTTtk)                                                              | Capcom subsidiary channel   | YouTube shows **«Creative Commons Attribution license (reuse allowed)»** with `ownerChannelName: "Capcom France"` (verified 2026-10-27). [YouTube Help](https://support.google.com/youtube/answer/2797468) links CC BY 4.0. Commons lists 70 SF6 videos from the channel ([category](https://commons.wikimedia.org/wiki/Category:Videos_by_Capcom_France)).                                                                                      | ✓ _if valid_             | ✓ _if valid_ (attribution)  | ✓ _if valid_ | ✓ _if valid_ (indicate changes)                                | **no**: guest characters are third-party IP; some fighters have no dedicated CC video | **UNRESOLVED** (§3.1)                            |
| H   | Wikimedia Commons stills, e.g. [File:Street Fighter 6 gameplay.jpg](https://commons.wikimedia.org/wiki/File:Street_Fighter_6_gameplay.jpg) (CC BY 3.0, «extracted from» the Yasmine trailer)     | third-party                 | inherits G                                                                                                                                                                                                                                                                                                                                                                                                                                       | same as G                | same as G                   | same as G    | same as G                                                      | no                                                                                    | **UNRESOLVED** (inherits G)                      |
| I   | Wikimedia Commons event photos (e.g. Tokyo Game Show 2023 booths, CC BY 4.0 «own work»)                                                                                                          | third-party                 | the photographer's licence covers the photo, not the Capcom artwork it depicts                                                                                                                                                                                                                                                                                                                                                                   | ✗ for crops of the art   | ✗                           | ✗            | ✗                                                              | no                                                                                    | **NO**                                           |
| J   | Fan wikis, e.g. Street Fighter Wiki ([File:SF6-AKI.jpg](https://streetfighter.fandom.com/wiki/File:SF6-AKI.jpg))                                                                                 | third-party                 | the file page carries **no licence template or category** (API, 2026-10-27); an uploader cannot license Capcom's art. Fandom's licensing page could not be retrieved.                                                                                                                                                                                                                                                                            | ✗                        | ✗                           | ✗            | ✗                                                              | —                                                                                     | **NO**                                           |
| K   | Fan art / commissioned «SST-style» illustrations of SF6 fighters                                                                                                                                 | third-party                 | still derivative works of Capcom characters: bound by C (no commercial use, revocable) and needs each artist's licence                                                                                                                                                                                                                                                                                                                           | ✗ without Capcom         | ✗                           | ✗            | —                                                              | —                                                                                     | **NO** without a Capcom licence                  |
| L   | Game files, Buckler / CDN images, asset dumps                                                                                                                                                    | —                           | forbidden by this task's constraints and by A and B                                                                                                                                                                                                                                                                                                                                                                                              | ✗                        | ✗                           | ✗            | ✗                                                              | —                                                                                     | **excluded**                                     |
| M   | **Capcom License Business website**, [capcom-games.com/license/en](https://www.capcom-games.com/license/en/)                                                                                     | **yes (licensing channel)** | licences by contract only: inquiry form, then CAPCOM licensing form, contract, design check, approval; fees or royalties «depending on various conditions». _«We are unable to license out our IPs to personal/private events (such as … community events), whether … for profit/non-profit»_ ([Q&A](https://www.capcom-games.com/license/en/qa/)). _«as long as CAPCOM has the ownership of the character»_. SF6 licensees are actively sought. | ✓ _only with a contract_ | per contract                | per contract | per contract                                                   | Capcom-owned characters only                                                          | **the route to GO** (§4)                         |

### 3.1 Why source G (Capcom France CC BY) is unresolved, not a GO

**Verified:**

- the video exists on a channel named Capcom France;
- YouTube displays the CC BY licence for it;
- Commons hosts derived stills and video copies under that licence.

**Unresolved:**

1. **Authority and intent.** A Commons deletion request on the same channel's CC BY releases
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

## 6. Documentation checks

Documentation-only change: this file.

- No other document contradicts it. `creator-overlays.md` («SST ships no official Capcom
  assets») and the audit remain accurate under NO-GO.
- Commands run: `npx prettier --check design/phase-m2/character-portraits-licensing-gate.md`,
  `git diff --check`, and `pnpm check` to confirm nothing else changed. Results are in the PR.
