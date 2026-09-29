# Manual verification in desktop Google Chrome

**Status: PENDING — not performed.** Nothing below has been executed in Google Chrome by a person yet. Do not treat any row as passed until the *Result* column is filled in by the tester.

## Why this is still pending

- Google Chrome 153.0.8010.53 (Stable, 64-bit) is installed on the development machine, but branded Chrome ignores the `--load-extension` flag (verified on 2026-09-28: launching Chrome 153 with `--load-extension=apps/extension/dist` starts no extension service worker). The only installation path is **Load unpacked** in `chrome://extensions`, which opens a native file dialog that cannot be scripted.
- Chrome's toolbar and side-panel surface cannot be driven by Playwright or the DevTools protocol.
- The automated suite therefore runs in Playwright's Chromium 153 (build 1243), headless, with the panel opened as a tab (`sidepanel.html?tab=<id>`) or, for target selection, as an unpinned tab that follows the active tab (`apps/extension/tests/selection.spec.ts`). This exercises the same code paths but is **not** evidence that the toolbar icon or the side panel work.

## Environment to record

| Field | Value |
| --- | --- |
| Chrome version (`chrome://version`) | e.g. 153.0.8010.53 (Official Build) (64-bit) |
| OS | |
| Extension build | output of `npm run ext:package`, plus the SHA-256 from `docs/extension/RELEASE_NOTES.local.md` |
| Profile | fresh profile created for the test (`chrome://settings/manageProfile` → Add) |
| Tester / date | |

## Setup

1. `git clone --branch feature/chrome-extension https://github.com/Rekh-225/bugreel.git && cd bugreel && npm ci && npm run ext:build`
2. In the fresh Chrome profile open `chrome://extensions`, enable **Developer mode**, click **Load unpacked**, select `apps/extension/dist`. Record the permission warning text Chrome shows.
3. Pin BugReel from the extensions menu.
4. In a terminal: `npm run ext:demo` → <http://127.0.0.1:4180/>.

## Test matrix

Fill *Result* with PASS / FAIL / BLOCKED and a note. Expected behaviour is stated from the automated tests and the code; confirm it, do not assume it.

| # | Area | Steps | Expected | Result |
| --- | --- | --- | --- | --- |
| 1 | Toolbar and side panel | Open the demo tab, click the BugReel toolbar icon. | The side panel opens beside the page (no new tab). First run shows the onboarding notice; **I understand** dismisses it and it does not return after closing/reopening the panel. | |
| 2 | Current-tab selection (no `?tab=`) | With the panel open, read the "Record this tab" card. | Shows the demo tab's title and `http://127.0.0.1:4180/`; Start is enabled. | |
| 3 | Tab switching | Open a second tab (any https site), switch between the two tabs with the panel open. | The card follows the active tab within ~1 s; on a `chrome://` tab Start is disabled with the "does not allow extensions to record chrome://" reason. | |
| 4 | Second window | Open a second browser window with the demo site; open the panel there too. | Each window's panel shows its own active tab. Starting in window 1 then pressing Start in window 2 fails with "A recording is already in progress". | |
| 5 | Start | Click **Start recording** on the demo tab. | Chrome shows "BugReel Recorder started debugging this browser"; a "BugReel recording" pill appears bottom-right in the page; the toolbar badge reads **REC**; the panel switches to the recording view with a running timer. | |
| 6 | Steps and sensitive values | Type in Full name, Coupon code, Password, Email, Card number; choose a Size; tick the terms box. | The live step list shows fills for each field; Password shows "[password omitted]", Email and Card number "[sensitive value omitted]", Full name/Coupon "[value not recorded]" (value recording off). | |
| 7 | Failures | Click Checkout, Fail an assertion, Throw an uncaught exception, Load a missing resource, Break the connection. | Live counts show 3 console errors (error, assert, exception) and 3 network errors (500, 404, transport). | |
| 8 | Frame scope | Click "Log an error inside the frame" and "Click inside the frame". | No new console error is counted; "not replayable" count increases (embedded frame interaction). | |
| 9 | Pause / Resume | Click **Pause**, type in Order notes and click Checkout, click **Resume**, click Continue on… (any button). | Pill says "BugReel paused" then "BugReel recording"; badge shows **II** then **REC**; nothing typed or clicked while paused appears; the review shows one recording gap. | |
| 10 | Navigation | Click "Open the settings view", then "Go to the second page", then "Back to the shop". | Steps show the SPA route change and both full navigations; recording continues on the second page. | |
| 11 | Screenshot | Click **Capture screenshot**, inspect the preview, click **Discard screenshot** → confirm; capture again. | The preview shows the visible tab including the embedded frame; the pill is not in the image; discard removes it; the second capture replaces it. | |
| 12 | Stop and review | Click **Stop**. | Debugging banner disappears, pill removed, badge cleared; the review screen opens with steps, evidence (frame error absent), the screenshot, and the out-of-scope notice. | |
| 13 | Review editing | Fill title/expected/actual; untick one step and one evidence item; mark the HTTP 500 as failure signature; tick "Include screenshot in export". | "Saved locally." appears; the draft status shows an unverified draft with a failure-signature assertion. | |
| 14 | Export | Click each export button. | Four downloads with the `bugreel-<date>-<id>` prefix; the Markdown says "Unverified BugReel recording"; the JSON validates (`npx playwright test -c playwright.extension.config.ts packages/core/tests/recording.spec.ts` can be adapted to the file); the `.spec.ts` header says UNVERIFIED DRAFT and the `waitForResponse` predicate contains `url.origin === "http://127.0.0.1:4180"`. | |
| 15 | Cancel from the banner | Start a new recording, press **Cancel** on Chrome's debugging banner. | The recording ends as *Interrupted* with the debugger-detached explanation; the review opens. | |
| 16 | Cross-origin | Start a recording, click "Leave for a different site". | *Interrupted: navigated to a different site*; steps before the navigation are kept. | |
| 17 | Tab close | Start a recording, close the tab. | *Interrupted: tab was closed*; the panel shows the review. | |
| 18 | History and deletion | Return to Session history. Delete one session with the two-step button. | The list shows all sessions with status badges; deletion removes the entry; `chrome://extensions` → BugReel → *Inspect views: service worker* → Application → IndexedDB shows no events for that ID. | |
| 19 | Restart | Start a recording, quit Chrome completely, reopen it and the panel. | No recording is active; the session is listed as *Interrupted* (browser restart); the extension does not resume recording. | |
| 20 | Reload extension | Start a recording, press the reload icon on the extension card. | Same as 19 (interrupted, not resumed). | |

## Recording the results

Add the completed table, Chrome version, and any deviations to this file (locally) and to the final report. A FAIL in rows 1–5 blocks any Chrome Web Store submission.
