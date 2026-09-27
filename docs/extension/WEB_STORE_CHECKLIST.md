# Chrome Web Store submission checklist

Status: **not submitted**. This checklist prepares a future submission of BugReel Recorder; nothing in the repository publishes automatically.

## Build artefacts

- [ ] `npm ci && npm run ext:package` on a clean checkout; confirm `apps/extension/release/bugreel-extension-<version>.zip` matches `apps/extension/dist` (the packaging test does this).
- [ ] Bump `version` in `package.json` (the build copies it into `manifest.json`).
- [ ] Verify the ZIP contains only `manifest.json`, `background.js`, `content.js`, `sidepanel.html`, `sidepanel.js`, `assets/*.css`, `chunks/*.js`, and `icons/*.png`; no `.map`, `.ts`, `.env`, or test files.
- [ ] Load the ZIP contents unpacked in a fresh Chrome profile and run through the [first-use guide](../../apps/extension/README.md#first-use).

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
- [ ] Data usage disclosure: check "Website content" (interactions, console/network metadata, optional screenshot) and "Personally identifiable information" only if typed-value recording is considered PII collection; state that data is stored locally, not sold, not transferred, and not used for unrelated purposes.
- [ ] Certify compliance with the Developer Program Policies and the Limited Use requirements.
- [ ] Host the privacy policy at a public URL and link it (the draft is [PRIVACY.md](PRIVACY.md)).

## Policy review points to be ready for

- [ ] The `debugger` permission triggers manual review. Prepare a short reviewer note describing when the debugger attaches (Start), what it reads (Runtime, Network, Page events; screenshot on request), that it never modifies pages or traffic, and that the capture script is `content.js` inside the package.
- [ ] Confirm no obfuscation: the bundle is minified but not obfuscated; keep it that way (Vite `minify: true` only).
- [ ] Confirm the extension works without an account and without any network access.
- [ ] Confirm `minimum_chrome_version` (120) is still appropriate.
- [ ] Add a test account or fixture instructions if reviewers need a page to record; the fixture server in `apps/extension/tests/fixtures/server.ts` can be run locally but is not hosted.

## Before clicking Publish

- [ ] Draft status confirmed: the listing and the extension never say "reproduced", "verified", or "passed" about an exported test.
- [ ] `npm run typecheck`, `npm run build`, `npm test`, and `npm run test:extension` pass on the release commit.
- [ ] Tag the release commit and attach the ZIP to a GitHub release for traceability.
- [ ] Choose visibility (unlisted for a first round is reasonable) and note that Web Store review can take several days.
