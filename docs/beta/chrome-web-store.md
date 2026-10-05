# Chrome Web Store (Unlisted): pending manual steps

Nothing has been published. This page lists what is still needed to turn the beta package into
an **Unlisted** Chrome Web Store item (installable only through its link), so testers no longer
need Developer mode.

> Fees, review times and dashboard fields change. Check the official pages linked below when you
> do this instead of trusting numbers written here. This document deliberately quotes none.

## 1. The package is already compatible

`pnpm companion:package:beta` produces the ZIP the store expects:

- `manifest.json` sits at the ZIP root;
- the manifest is MV3 with a valid numeric `version` (the `-beta` suffix is only in the file
  name);
- the code is bundled locally: no remote code, no `eval`, CSP `script-src 'self'`;
- no source maps, `.env` files or TypeScript sources;
- the only tracker origin is `https://sf6-session-tracker-web.onrender.com`.

The same ZIP can be uploaded. Each new upload needs a **higher `version`** in
`apps/companion-extension/manifest.json`.

## 2. Gaps to close before a real submission

| Item                       | Status           | What to do                                                                                                                                                                                                                                                                                                                                 |
| -------------------------- | ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `icons` in the manifest    | **Missing**      | The store requires a 128×128 PNG icon in the package. Add `icons/16.png`, `32.png`, `48.png` and `128.png` and declare them in `icons` and `action.default_icon`. Original artwork only: no Capcom/SF6 logos. The packager already accepts `icons/*.png`. ([icons](https://developer.chrome.com/docs/extensions/reference/manifest/icons)) |
| Store icon and screenshots | Missing          | Prepared in the dashboard, not in the ZIP. Real captures of the popup and the dashboard, with no tokens, emails or pairing codes. ([image requirements](https://developer.chrome.com/docs/webstore/images))                                                                                                                                |
| `homepage_url`             | Done             | Points to the GitHub repository.                                                                                                                                                                                                                                                                                                           |
| Privacy policy URL         | **Missing**      | The extension handles user data (game data, device token), so the dashboard requires a public privacy policy URL. Write one from `docs/companion.md` §7–8 and host it, for example as a tracker page or in the repository.                                                                                                                 |
| Name / trademarks          | Review           | "SF6"/"Street Fighter" are Capcom trademarks. Keep the description clearly unofficial ("not affiliated with Capcom") and check the policies on impersonation and trademarks.                                                                                                                                                               |
| Permissions                | OK, keep minimal | No permission is added for the store. Justify the existing ones (§4).                                                                                                                                                                                                                                                                      |

## 3. Steps (manual, in this order)

1. **Developer account:** register at <https://developer.chrome.com/docs/webstore/register>.
   Registration has a **one-time fee**; check the current amount there. Verify the publisher
   email.
2. **Create the item** in the dashboard (<https://chrome.google.com/webstore/devconsole>) →
   _New item_ → upload `artifacts/sf6-session-companion-vX.Y.Z-beta.zip`.
   Guide: <https://developer.chrome.com/docs/webstore/publish>.
3. **Store listing:**
   - description (ES/EN), stating it is unofficial and needs the Session Tracker plus a Buckler
     login of your own;
   - category;
   - store icon and screenshots;
   - support link (repository Issues).
4. **Privacy** tab (<https://developer.chrome.com/docs/webstore/cws-dashboard-privacy>):
   - single purpose: "send the user's own SF6 match results from Buckler's Boot Camp to their
     SF6 Session Tracker";
   - justify each permission (§4);
   - declare the data types collected and the Limited Use certifications
     (<https://developer.chrome.com/docs/webstore/program-policies/limited-use>);
   - privacy policy URL;
   - declare that there is **no remote code**.
5. **Distribution** (<https://developer.chrome.com/docs/webstore/cws-dashboard-distribution>):
   visibility **Unlisted**; choose regions.
6. **Submit for review.** Times vary; see
   <https://developer.chrome.com/docs/webstore/review-process>. Broad host permissions or data
   handling can lengthen the review.
7. When approved, **share the item link** with testers. Edge and Brave users can install from
   the Chrome Web Store too (in Edge, allow extensions from other stores).

**Moving testers off the unpacked build:** a store install gets a different extension ID, so it
starts with empty storage. Testers remove the unpacked copy, install from the store and pair
again. Their sessions and matches live on the tracker and are not lost.

## 4. Permission justifications (copy into the dashboard)

| Permission                                       | Justification                                                                                                                    |
| ------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------- |
| `https://www.streetfighter.com/6/buckler/*`      | Read the signed-in user's own profile and battle log from Buckler's Boot Camp, with the browser's existing session.              |
| `https://sf6-session-tracker-web.onrender.com/*` | Send the normalized results to the user's Session Tracker account (pairing, state, sync). It is the only tracker origin allowed. |
| `storage`                                        | Keep the device token, pairing state and last-seen match IDs locally.                                                            |
| `alarms`                                         | Check for new matches every 30 s (the MV3 minimum) without keep-alive tricks.                                                    |
| `scripting`                                      | Fallback when Buckler only answers from its own page: run the same read in an open Buckler tab the user opened.                  |

Not requested: `cookies`, `webRequest`, `tabs`, `<all_urls>`, `debugger`.

Policies: <https://developer.chrome.com/docs/webstore/program-policies>.
