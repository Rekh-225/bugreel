# Chrome Web Store submission checklist

Status: **not submitted**. This checklist prepares a future submission of BugReel Recorder; nothing in the repository publishes automatically.

## Build artefacts

- [ ] `npm ci && npm run ext:package` on a clean checkout; confirm `apps/extension/release/bugreel-extension-<version>.zip` matches `apps/extension/dist` (the packaging test does this).
- [ ] Bump `version` in `package.json` (the build copies it into `manifest.json`).
- [ ] Verify the ZIP contains only `manifest.json`, `background.js`, `content.js`, `sidepanel.html`, `sidepanel.js`, `assets/*.css`, `chunks/*.js`, and `icons/*.png`; no `.map`, `.ts`, `.env`, or test files.
- [ ] Load the ZIP contents unpacked in a fresh Chrome profile and run through the [first-use guide](../../apps/extension/README.md#first-use). Note that Google Chrome ignores `--load-extension`; only *Load unpacked* works.
- [ ] Clone instructions point at the revision that contains the extension (`git clone --branch feature/chrome-extension …` until it is merged into the default branch).

## Listing content

- [ ] Name: BugReel Recorder. Short description under 132 characters that does not claim reproduction or verification.
- [ ] Detailed description explaining: one-tab recording, review before export, Markdown/JSON/Playwright exports, that drafts are unverified, and that nothing leaves the browser.
- [ ] Screenshots (1280×800 or 640×400) of onboarding, recording, review, and export. Use the fixture site; do not use real customer pages.
- [ ] Icon 128×128 (`apps/extension/public/icons/icon-128.png`) and promotional tiles if required.
- [ ] Category: Developer Tools. Language: English.

## Privacy tab

- [ ] Single purpose statement: "Record a bug reproduction in one browser tab and export a report, recording, and test draft for developers."
- [ ] Permission justifications, copied from [PRIVACY.md](PRIVACY.md) and the README's [Permissions](../../apps/extension/README.md#permissions) section:
  - `debugger`: capture console errors, failed requests, navigation, screenshots; inject the bundled capture script into the selected tab only after the user presses Start.
  - `storage`: coordination state for the active recording and the onboarding flag.
  - `sidePanel`: the user interface.
- [ ] Remote code: **No, I am not using remote code.** All code is in the package; the capture script is a packaged file evaluated in an isolated world.
- [ ] Data usage disclosure: tick the categories listed in [STORE_LISTING.md](STORE_LISTING.md#privacy-tab-entries) (Website content, User activity, Web history, and Personally identifiable information), confirm the labels against the dashboard, and state that data is stored locally, not sold, not transferred, and not used for unrelated purposes. Local-only handling must still be disclosed (Chrome Web Store User Data FAQ, Q3).
- [ ] Certify compliance with the Developer Program Policies and the Limited Use requirements.
- [ ] Complete the **[OWNER]** fields in [PRIVACY.md](PRIVACY.md), host it at a public URL, and link it.

## Policy review points to be ready for

- [ ] The `debugger` permission is likely to receive closer review; the duration and outcome are not predictable and must not be promised. Use the reviewer note in [STORE_LISTING.md](STORE_LISTING.md#reviewer-notes-and-demo-instructions): when the debugger attaches (Start), what it reads (Runtime, Network, Page events; screenshot on request), that it injects a non-interactive indicator element and an isolated-world capture script but otherwise does not change pages or traffic, and that `content.js` ships inside the package.
- [ ] Confirm no obfuscation: the bundle is minified but not obfuscated; keep it that way (Vite `minify: true` only).
- [ ] Confirm the extension works without an account and without any network access.
- [ ] Confirm `minimum_chrome_version` (120) is still appropriate and record the Chrome versions actually tested (see the README's *Browser versions*).
- [ ] Reviewers can use the synthetic demo site: `npm run ext:demo` (instructions in STORE_LISTING.md). It is not hosted; no test account exists or is needed.

## Before clicking Publish

- [ ] **Manual verification in desktop Google Chrome completed and recorded** in [MANUAL_TEST_PLAN.md](MANUAL_TEST_PLAN.md) (toolbar icon, side panel, current-tab selection, Start/Pause/Resume/Stop, screenshot, export, history, deletion, restart). This is currently PENDING and blocks submission.
- [ ] Draft status confirmed: the listing and the extension never say "reproduced", "verified", or "passed" about an exported test.
- [ ] `npm run typecheck`, `npm run build`, `npm test`, and `npm run test:extension` pass on the release commit.
- [ ] Tag the release commit and attach the ZIP to a GitHub release for traceability, together with its SHA-256.
- [ ] Choose visibility (unlisted for a first round is reasonable). Review time varies and is not documented by Google; do not plan around a specific duration.
