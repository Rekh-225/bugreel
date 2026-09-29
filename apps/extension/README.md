# BugReel Recorder (Chrome extension)

Record a bug in one Chrome tab, review what was captured, and export a Markdown report, a versioned JSON recording, and an editable Playwright draft. Everything stays in your browser profile.

This is the first usable release (0.1.0). It is a **separate capture surface** from the local BugReel application in the repository root; it does not replay tests, and it never claims that a bug was reproduced.

- [Build and install](#build-and-install)
- [First use](#first-use)
- [What gets captured](#what-gets-captured)
- [Supported scenarios](#supported-scenarios)
- [Known limitations](#known-limitations)
- [Architecture](#architecture)
- [Permissions](#permissions)
- [Data handling, storage, and limits](#data-handling-storage-and-limits)
- [Export formats](#export-formats)
- [Development and testing](#development-and-testing)
- [Related documents](#related-documents)

## Build and install

Requirements: Node.js 22, npm, and desktop Chrome 120 or newer (see [Browser versions](#browser-versions)). The commands below work in Windows PowerShell or cmd, macOS, and Linux shells.

The extension lives on the `feature/chrome-extension` branch until it is merged; the default branch may not contain `apps/extension` yet. Clone that branch explicitly:

```bash
git clone --branch feature/chrome-extension https://github.com/Rekh-225/bugreel.git
cd bugreel
npm ci
npm run ext:build          # writes apps/extension/dist
npm run ext:package        # also writes apps/extension/release/bugreel-extension-<version>.zip
```

Already have a clone? `git fetch origin && git checkout feature/chrome-extension` before building.

Load the unpacked build:

1. Open `chrome://extensions`.
2. Turn on **Developer mode** (top right).
3. Click **Load unpacked** and choose the `apps/extension/dist` folder (on Windows, e.g. `C:\path\to\bugreel\apps\extension\dist`).
4. Chrome shows the permission warnings **"Read and change all your data on all websites"** and **"Access the page debugger backend"**. Both come from the `debugger` permission; see [Permissions](#permissions).
5. Pin the BugReel icon from the extensions menu so the recording badge is visible.

Google Chrome no longer side-loads extensions from the `--load-extension` command-line flag (verified against Chrome 153: the flag is ignored), so **Load unpacked** is the only way to install a development build in Chrome. The automated tests use Playwright's Chromium build, which still honours the flag.

The ZIP in `apps/extension/release/` contains exactly the files in `dist/` and is what a Chrome Web Store submission would upload. It contains no source maps, TypeScript, tests, or environment files.

For a synthetic page to test against, run `npm run ext:demo` and open <http://127.0.0.1:4180/> (see [Demo site](#demo-site)).

After changing source, run `npm run ext:build` again and press the reload icon on the BugReel card in `chrome://extensions`.

## First use

1. Open the page where the bug happens (an `http://` or `https://` page).
2. Click the BugReel toolbar icon. The side panel opens. On first use it explains the permission warning and how data is handled; click **I understand**.
3. The panel shows the current tab. Optionally enable **Record typed text for this session** (off by default; see [Data handling](#data-handling-storage-and-limits)).
4. Click **Start recording**. Chrome shows a banner "BugReel Recorder started debugging this browser"; a small "BugReel recording" pill appears in the page and the toolbar badge shows **REC**.
5. Reproduce the bug in that tab. Use **Pause** for anything you do not want recorded (the export will show a gap) and **Capture screenshot** when the failure is visible.
6. Click **Stop**. The review screen opens.
7. Describe the **expected** and **actual** behaviour, untick steps or evidence that are not relevant, and optionally mark one console or network item as the **failure signature**. Check the screenshot and tick **Include screenshot in export** only if it is safe to share.
8. Export the **Markdown report**, **JSON recording**, **Playwright draft**, and **Screenshot**. Files download to your normal downloads folder.
9. Delete the session from the review screen or from **Session history** when you no longer need it.

Pressing **Cancel** on Chrome's debugging banner, closing the tab, or navigating to a different site ends the recording; the session is kept and marked *Interrupted* with an explanation.

## What gets captured

| Category | Captured | Notes |
| --- | --- | --- |
| Clicks | Buttons, links, checkboxes, radios, submit inputs, and other interactive elements | Clicks that only focus a text field are dropped during normalization. |
| Typing | Text-like `<input>` types and `<textarea>` | Repeated keystrokes become one *fill* step. Values are omitted unless value recording is on; password and sensitive fields are always omitted. |
| Selects | `<select>` changes | Option values follow the same value-recording rule. |
| Form submission | Submit clicks and Enter in a field | Enter becomes a `press('Enter')` step; a submit click is not duplicated. |
| Navigation | Full-page loads, reloads, redirects, and same-origin SPA route changes | Navigations caused by a step become `waitForURL`; typed navigations become `goto`. |
| Console | `console.error` and `console.assert` failures, uncaught exceptions — main frame only | Message plus up to five stack frames, redacted and bounded. The console type (`error`/`assert`) is stored so the draft listens for the right message type. |
| Network | Responses with status 400–599 and transport failures initiated by the main frame | Method, URL (sanitized), status, resource type, or error text. No bodies, headers, or cookies. Requests from embedded frames are counted as out of scope, not stored. |
| Screenshot | One PNG of the visible tab, on explicit request | Preview and discard controls; pixels are not redacted. |
| Unsupported steps | File inputs, rich-text editors, embedded frames, drag and drop, Escape, web components, elements without a reliable selector | Reported as "not replayable" and inserted as comments in the draft. |

Selectors are chosen in this order: `data-testid` (or `data-test-id`, `data-test`, `data-cy`, `data-qa`), ARIA role plus accessible name, form label, placeholder, stable `id`, `name` attribute, and finally a positional CSS path marked *low-confidence*.

## Supported scenarios

Verified by the automated suite in `apps/extension/tests` against Chromium with the built extension loaded:

- A multi-step reproduction with typing, a select, a checkbox, a click that triggers an HTTP 500 and a console error, an explicit screenshot, review, and all four exports.
- Same-origin full-page navigation and SPA (`history.pushState`) navigation without duplicate listeners, including a service-worker restart mid-recording.
- Pause and resume with an explicit recording gap; actions during the pause are excluded and the draft is marked `test.fixme`.
- Repeated start/stop cycles on the same tab with isolated sessions and no leaked events.
- Visual/behavioural bugs with no console or network evidence.
- Removing steps and evidence, and discarding the screenshot, before export.
- Cross-origin navigation, tab close, and browser or extension restart, each marked *Interrupted* with an explanation.
- Restricted pages (`chrome://`, the Chrome Web Store, `file://`, `about:blank`) refused with an explanation.
- Deleting a session removes its steps, evidence, review, and screenshot.
- An exported draft runs under the Playwright CLI once its `BUGREEL_VALUE_*` variables are set (this proves the generator emits working code; BugReel itself never runs drafts).
- Sensitive-field privacy: password, email, identifier, and recording-off text fields whose value getters throw and log every access are typed into, blurred, debounced, paused over, and stopped over without a single value read; recording-on ordinary fields are read once and never duplicated.
- Coordination state and IndexedDB never contain a synthetic secret placed in a URL's query, fragment, or SPA route, including the page where recording resumed after a pause.
- Same-process iframe errors, exceptions, and requests are excluded while main-frame ones (including cross-origin destinations) are kept, across navigation and a worker restart.
- Exported HTTP and transport drafts pass against the recorded origin and fail when only a decoy origin serves the same path, method, and status; a `console.assert` draft listens for `assert` messages and passes with the captured text.
- The synthetic demo site (`npm run ext:demo`) records end to end with sensitive values omitted and frame errors excluded.

## Known limitations

- **One tab, main frame only — for steps and diagnostics.** Interactions inside iframes (same-origin or cross-origin) are not recorded; the frame interaction is reported as unsupported. Console errors, exceptions, and failed requests are kept only when their execution context or initiating frame is the main frame; everything else (embedded frames, contexts that cannot be attributed) is counted as *out of scope* and not stored. Requests the **main frame** makes to other origins are kept, because scope follows the initiating frame, not the destination. **Screenshots are the exception:** a visible-tab screenshot shows whatever is on screen, including embedded frames and any sensitive text, so it does capture frame content.
- **Shadow DOM.** Clicks inside web components are reported as unsupported rather than guessed.
- **Selectors are best effort.** Role and label names are computed with a simplified accessible-name algorithm; a mismatch makes the draft fail with a locator timeout rather than click the wrong element. Positional CSS fallbacks are flagged.
- **Redaction is heuristic.** URL, message, and label redaction is conservative but cannot guarantee that every secret is detected. Review exports before sharing. Screenshots are never redacted.
- **The recording indicator is injected into the page.** While recording, BugReel adds a small `<bugreel-recording-indicator>` element (closed shadow root, `pointer-events: none`) to the page and runs its capture script in an isolated world. It does not change page content, traffic, or behaviour beyond that, but "does not touch the page" would be false; the indicator is hidden while a screenshot is taken.
- **Recording starts from the current page state.** The draft opens the start URL in a fresh browser context; sign-in state, cookies, and storage that existed before recording are not captured. Configure authentication (for example Playwright `storageState`) yourself.
- **Requests that started before recording** (or before a background-worker restart) are not reported, because their method is unknown.
- **Keyboard shortcuts** other than Enter in a field are not replayed; Escape is reported as unsupported.
- **Autofill.** If value recording is on, browser autofill can populate non-sensitive fields with personal data. Fields with `autocomplete` hints for names, addresses, emails, phone numbers, and payment data are treated as sensitive, but review typed values before sharing.
- **Debugger side effects.** While recording, Chrome shows its debugging banner, DevTools may show BugReel's CDP session, and some enterprise policies (`runtime_blocked_hosts`, `DisableScreenshots`, DLP) block attaching.
- **No replay, cloud sync, accounts, telemetry, or sharing links.** Exports are files you handle yourself.
- Back/forward-cache restores of documents loaded before the session started are not instrumented.

## Architecture

```text
apps/extension/src
├── background/            Module service worker: recording coordination and diagnostics
│   ├── recorder.ts        attach, inject, CDP events, pause/resume/stop, screenshot, recovery
│   ├── transform.ts       validation of capture payloads and CDP events -> stored evidence
│   └── lifecycle.ts       pure state rules (valid commands, interruptions, gaps, orphans)
├── content/capture.ts     Capture script bundled as one classic IIFE (content.js)
├── shared/                IndexedDB layer, types, limits, URL recordability
└── sidepanel/             React side panel: onboarding, controls, review, history, export
packages/core/src          Portable model, normalization, sanitization, schema, generators
```

**Capture script injection.** Chrome grants `activeTab` only for toolbar, context-menu, shortcut, or omnibox gestures, not for a button inside the side panel, and revokes it on cross-origin navigation; `chrome.scripting` would therefore need host permissions. Because the `debugger` permission is required anyway for diagnostics and screenshots, the worker injects the bundled `content.js` into a **dedicated isolated world** of the selected tab's main frame (`Page.createIsolatedWorld` for the current document and `Page.addScriptToEvaluateOnNewDocument` with a `worldName` for later documents). The script reports through a per-session `Runtime.addBinding` binding that exists only in that world, so page scripts cannot see or call it. This is the only executable code BugReel evaluates in pages, and it ships inside the package.

**Validation.** Every payload is checked in the worker: the binding name, the execution context (current main-frame isolated world, or the previous one for 1.5 s to accept flushes during navigation), a per-document nonce, the session ID and secret token, the page origin, payload size (16 KB), and structure. Typed values are dropped again in the worker when value recording is off.

**Value policy before any read.** The capture script decides from element metadata (type, autocomplete, name, label, data attributes, masked text) whether a value may be transmitted *before* it touches `element.value`. Password, sensitive, and not-recorded fields are never read, not even to compare, cache, or hash them; blur-time duplicates are suppressed with a per-field "edited since last report" flag instead. Nothing is read while paused or after Stop. The privacy tests install value getters that throw and record every access to prove this.

**Diagnostic scope.** The worker maps every execution context to its frame (`Runtime.executionContextCreated/Destroyed/executionContextsCleared`, persisted with the coordination state so it survives worker restarts) and keeps console, exception, and network evidence only for the main frame; `Network.requestWillBeSent` is filtered on its `frameId`. Anything unattributable is counted as out of scope, never stored. If the map cannot be reconstructed after a restart, evidence is dropped conservatively rather than broadened.

**Persistence.** Each captured record is appended to IndexedDB immediately. Coordination state (tab, session, token, binding, context IDs, frame map, pause state) lives in `chrome.storage.session`, which survives worker restarts but is cleared by Chrome on browser or extension restart. Raw URLs from CDP events are transient: the coordination state keeps only the sanitized current URL plus a session-salted SHA-256 digest of the raw URL, which resume uses to detect that the page changed while paused without retaining credentials, secret query values, or fragments. On startup the worker checks whether its debugger session still exists; if not, the session is marked interrupted. Sessions found in a recording state with no live coordination state are marked interrupted with the *browser-restart* reason. Recording is never resumed automatically.

**Events processed in order.** All CDP events and commands run through one serialized queue, so a Stop cannot overtake the typing flushed by the page, and the same document nonce cannot be reused after a navigation.

**Traffic is never blocked.** The extension only listens to `Network` events; it does not use `Fetch` interception or `declarativeNetRequest`, and it requests `Network.enable` with zero buffer sizes so Chrome does not retain bodies for it.

## Permissions

| Permission | Why | Install warning |
| --- | --- | --- |
| `debugger` | Attach to the selected tab to capture console errors, exceptions, failed requests, HTTP error metadata, navigation events, and screenshots, and to inject the capture script. Attaches only after **Start**, only to that tab, and detaches on Stop or interruption. | "Access the page debugger backend" and "Read and change all your data on all websites". Chrome does not allow this permission to be optional, and a diagnostics toggle would not remove the installed permission, so BugReel does not offer one. |
| `storage` | `chrome.storage.session` for coordination state and `chrome.storage.local` for the onboarding flag. | None. |
| `sidePanel` | The recording, review, and export interface. | None. |

Not requested: host permissions, `activeTab`, `scripting`, `tabs`, `cookies`, `history`, `downloads`, `webRequest`, `unlimitedStorage`. Tab titles and URLs shown in the panel come from `chrome.debugger.getTargets()`, which the `debugger` permission already allows; there is no `externally_connectable` entry, no content scripts declared in the manifest, and no web-accessible resources.

The tab and origin are enforced in code: CDP events from other tabs are ignored, payloads from other origins are rejected, and a navigation to a different origin ends the recording.

## Data handling, storage, and limits

- All data stays in the Chrome profile's IndexedDB (`bugreel` database) and `chrome.storage`. The extension makes no network requests of its own. Local processing is still handling of user data (page content, interactions, URLs, diagnostics, optional typed text, screenshots) and is disclosed as such in the [privacy disclosure](../../docs/extension/PRIVACY.md).
- Typed values are **off by default**. When on, values are still omitted for password fields (`type=password`, `autocomplete=current-password/new-password`, masked text), `email`, `tel`, and `hidden` inputs, fields with payment, name, address, one-time-code, or username autocomplete hints, fields whose name, id, label, or placeholder suggests secrets or identifiers, and anything inside `[data-private]`, `[data-sensitive]`, or `[data-bugreel-private]`. Omitted values become `BUGREEL_VALUE_n` placeholders in the draft and are listed under *Required configuration*.
- Request and response bodies, request and response headers, cookies, and page storage are never read. URLs are sanitized before storage: credentials are removed, secret-looking path segments, query values, and fragment values are replaced with `REDACTED`, while SPA hash routes are preserved. Console and exception text is bounded (1,000 characters, five stack frames) and passed through conservative redaction of tokens, emails, key/value secrets, card-like numbers, and embedded URLs. Element labels used as selectors are skipped when redaction would change them.
- Screenshots are captured only when you click **Capture screenshot**, are stored as PNG blobs, are excluded from export until you tick **Include screenshot in export**, and can be discarded at any time. Text redaction does not apply to image pixels, and a visible-tab screenshot includes embedded frames and any sensitive text that is on screen.
- Deleting a session removes its record, all events, its review text, and its screenshot in one transaction.
- Captured text is rendered as text in the panel (React escaping) and is escaped into string literals or comments in generated source. Nothing from a page is ever executed.

Limits (see `apps/extension/src/shared/limits.ts`):

| Limit | Value | Behaviour when reached |
| --- | --- | --- |
| Stored sessions | 50 | Start is refused until sessions are deleted. |
| Steps per session (interactions and navigations) | 1,000 | Recording stops and the session is marked *Interrupted: limit reached*. |
| Console/exception items | 300 | Further items are counted as dropped. |
| Network items | 300 | Further items are counted as dropped. |
| Unsupported-step notes | 200 | Further items are counted as dropped. |
| Capture payload | 16 KB | Larger payloads are rejected. |
| Screenshot | 8 MB, one per session | Capture fails with a message; capturing again replaces the previous screenshot. |
| Message text | 1,000 characters | Truncated. |
| URL length | 2,048 characters | Truncated and flagged as redacted. |

If IndexedDB reports a quota error, the recording stops and the session is marked *Interrupted: storage error*.

## Export formats

All exports are generated from one validated **schema v1 recording** (`packages/core/schema/bugreel-recording-v1.schema.json`, mirrored by `validateRecording()` in `packages/core/src/recording.ts`). The recording contains the schema version, session metadata and status (including interruption reasons), sanitized target information, normalized actions, the selected evidence, expected and actual behaviour, screenshot metadata, unsupported steps, recording gaps, required configuration, and the Playwright draft status.

- **Markdown report** (`bugreel-<date>-<id>-report.md`): an *unverified* banner, metadata table, expected/actual/notes, ordered steps with gap and unsupported markers, selected evidence, screenshot disclosure, required configuration, and draft status. Untrusted text is escaped so it cannot inject links, images, or HTML.
- **JSON recording** (`....recording.json`): the schema v1 document above.
- **Playwright draft** (`....spec.ts`): a `@playwright/test` file whose header says `STATUS: UNVERIFIED DRAFT`. Steps are `test.step` calls using Playwright locators. Omitted values are read with `requiredValue('BUGREEL_VALUE_n')`, which throws until the environment variable is set. If a failure signature was selected, a `waitForResponse`, `requestfailed`, `console`, or `pageerror` assertion checks that the recorded failure occurs again; it passes **while the bug is present**. Network signatures match the recorded **origin**, pathname, method, and (for HTTP) status, and observation starts immediately before the step that triggered the failure, so an unrelated origin serving the same path or an earlier failure cannot satisfy it. A network URL whose origin or path was redacted produces no assertion (placeholders are never executable). Console signatures listen for the recorded console type (`error` or `assert`). Otherwise the draft ends with a `TODO` comment quoting the reported behaviour. Gaps insert `test.fixme` and `RECORDING GAP` comments; unsupported steps become comments. The viewport recorded at start is applied with `test.use`.
- **Screenshot** (`...-screenshot.png`): only when included in the export.

Examples exported from the fixture site are in [`docs/extension/examples`](../../docs/extension/examples).

## Development and testing

```bash
npm run ext:build          # production build into apps/extension/dist
npm run ext:package        # build + ZIP into apps/extension/release
npm run typecheck          # app and extension
npm run test:extension     # builds, then runs packages/core and apps/extension tests
BUGREEL_EXTENSION_HEADED=1 npm run test:extension   # watch the browser
```

The extension suite uses Playwright's persistent Chromium context with `--load-extension` and runs headless (`channel: 'chromium'`). Because Playwright cannot click the browser toolbar, the side panel page is opened as a tab with `sidepanel.html?tab=<tabId>`, which pins the tab to record; that query parameter is also what the tests use to select the fixture tab. A deterministic fixture site is served from a random `127.0.0.1` port and reached as `http://localhost:<port>` to simulate a different site. Test coverage is listed under [Supported scenarios](#supported-scenarios); unit tests cover normalization, schema validation (against both validators), sanitization and placeholders, source escaping (including a hostile-input test that parses the generated file), export generation, payload validation, lifecycle rules, and packaging.

The build refuses to package source maps, TypeScript, `.env` files, or any remote script reference.

`apps/extension/tests/selection.spec.ts` drives the unpinned target-selection logic (no `?tab=`: the panel follows the active tab of its window and ignores other windows) by switching tabs with `chrome.tabs.update`. That is the same code path the real side panel uses, but it is **not** proof that the toolbar icon or Chrome's side-panel surface work; those need the manual test plan below.

## Demo site

`npm run ext:demo` serves a deterministic, fully synthetic demo shop at <http://127.0.0.1:4180/> (also reachable as <http://localhost:4180/>, which counts as a different site for the cross-origin case). It has ordinary inputs, sensitive inputs (password, email, card number, one-time code), a checkout that returns HTTP 500 and logs `console.error`, a `console.assert` failure, an uncaught exception, a 404, a transport failure, a full-page navigation, an SPA route change, an embedded frame with its own error button, a rich-text editor, and a file input. No accounts, internal APIs, or paid services are involved. `apps/extension/tests/demo.spec.ts` records the same flows against it in CI. Override the port with `BUGREEL_DEMO_PORT`.

## Browser versions

- `minimum_chrome_version` is **120**. APIs used and the Chrome version that introduced them: `chrome.sidePanel` (114) and `setPanelBehavior` (116), `chrome.storage.session` (102), debugger sessions keeping the service worker alive (118), `chrome.debugger` flat sessions are not used. 120 leaves margin above all of these.
- **Automated tests:** Playwright's bundled Chromium 153 (Playwright 1.63, build 1243), headless, on Windows 11, with `--load-extension`.
- **Google Chrome 153.0.8010.53 (Stable, 64-bit) is installed on the development machine**, but the real toolbar and side-panel surface have **not** been manually verified in this pass because branded Chrome cannot be driven to *Load unpacked* by automation (the native file dialog cannot be scripted and the `--load-extension` flag is ignored). See [docs/extension/MANUAL_TEST_PLAN.md](../../docs/extension/MANUAL_TEST_PLAN.md) for the pending plan and how to record results.

## Related documents

- [Manual test plan and status](../../docs/extension/MANUAL_TEST_PLAN.md)
- [Privacy disclosure (finalized draft)](../../docs/extension/PRIVACY.md)
- [Store listing text, data disclosures, and reviewer instructions](../../docs/extension/STORE_LISTING.md)
- [Chrome Web Store submission checklist](../../docs/extension/WEB_STORE_CHECKLIST.md)
- [Example exports](../../docs/extension/examples)
- [Local BugReel application](../../README.md)
