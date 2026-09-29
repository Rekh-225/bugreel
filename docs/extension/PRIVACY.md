# BugReel Recorder privacy policy

**Status:** finalized draft for BugReel Recorder version 0.1.0, prepared for a hosted privacy page and the Chrome Web Store privacy fields. Items marked **[OWNER]** must be completed by the extension owner before publication. Every statement describes what the shipped code does; the referenced behaviour is exercised by the automated test suite in `apps/extension/tests` and `packages/core/tests`.

**Developer / data controller:** Rehan Khaliq **[OWNER: add legal name or entity, postal address if required in your jurisdiction, and a contact email]**
**Contact for privacy questions:** **[OWNER: email address]** or <https://github.com/Rekh-225/bugreel/issues>
**Effective date:** **[OWNER: date of publication]**

## 1. What BugReel Recorder does

BugReel Recorder helps developers and testers document a software bug. You choose one browser tab, press **Start recording**, reproduce the problem, press **Stop**, review what was captured, and export files (a Markdown report, a JSON recording, an editable Playwright test draft, and optionally a screenshot). The extension has no server, account, analytics, or telemetry, and it makes no network requests of its own. All processing and storage happen inside your Chrome profile.

Processing data locally is still handling user data. This policy therefore describes everything the extension reads, stores, and lets you export, even though nothing is transmitted to us or to anyone else.

## 2. What is collected, and when

Collection happens only between **Start** and **Stop** (or an automatic interruption), only for the tab you selected, and only for that tab's main frame unless stated otherwise.

| Data | Collected | Details |
| --- | --- | --- |
| **Interactions** | Yes | Clicks, form submissions, select changes, and typing events on the recorded page, with the element's tag, role, accessible label, placeholder, test ID, name, and visible text (truncated to 120 characters and redacted), the sanitized page URL, and a timestamp. |
| **Typed text** | Off by default; optional per session | When you enable *Record typed text for this session*, the text of ordinary fields is stored. Password fields and fields identified as sensitive (email, phone, payment, identification numbers, one-time codes, usernames, and fields marked `data-private`) are **never read**: the extension decides from the field's attributes before touching its value, and a placeholder is stored instead. Values are never read while recording is paused or after Stop. |
| **Navigation** | Yes | Sanitized URLs the tab visits within the same site (full loads, reloads, and in-page route changes) and whether a step caused them. Navigating to a different site ends the recording. |
| **Console errors, assertion failures, and uncaught exceptions** | Yes, main frame only | The message text (truncated to 1,000 characters), whether it came from `console.error` or `console.assert`, up to five stack frames, and the script location, after redaction. Messages from embedded frames are counted but not stored. |
| **Failed network requests** | Yes, main frame only | Method, sanitized URL, HTTP status or network error text, and resource type for responses with status 400–599 and for transport failures **initiated by the main frame**, including requests to other origins. Request and response **bodies, headers, and cookies are not read**. Requests from embedded frames are counted but not stored. |
| **Screenshot** | Only when you press *Capture screenshot* | One PNG of the visible area of the tab. **A screenshot shows everything on screen, including embedded frames and any personal or confidential text, and its pixels are not redacted.** It is excluded from exports until you explicitly tick *Include screenshot in export*, and you can discard it at any time. |
| **Your report text** | Yes | The title, expected behaviour, actual behaviour, and notes you type in the review screen. |
| **Session metadata** | Yes | Start and end time, the site origin, the viewport size, the Chrome major version, why a recording ended, and counts of stored, dropped, and out-of-scope events. |

The extension does **not** collect browsing history outside the recorded tab and session, bookmarks, cookies, local storage or session storage contents, request or response bodies, HTTP headers, clipboard contents, audio, video, location, or anything from other tabs, windows, or extensions.

## 3. How the data is protected

- **Value policy before any read.** Whether a field's value may be transmitted is decided from element metadata before the value is accessed. Sensitive and not-recorded fields are never read, compared, hashed, or cached.
- **Sanitization.** Before storage, URLs have credentials removed and secret-looking path segments, query values, and fragment values replaced with `REDACTED`; single-page-app hash routes are preserved. Message text passes through conservative rules that remove tokens, bearer credentials, key/value secrets, email addresses, and long numbers. Element labels that redaction would alter are not used as selectors. This is best-effort filtering: it **cannot guarantee that every secret is removed**, and it does not apply to screenshot pixels. Review exports before sharing them.
- **Scope.** Only the selected tab's main frame is recorded. Evidence that cannot be attributed to the main frame is discarded rather than stored.
- **Transient data.** Raw URLs and events from Chrome's debugging protocol are processed in memory; the coordination state kept for the active recording holds only the sanitized current URL and a session-salted SHA-256 digest of the raw URL used to detect that the page changed while paused.
- **Isolation.** The capture script runs in an isolated JavaScript world; web pages cannot see or call it. Captured text is displayed as text and escaped into string literals or comments in generated files. Content from web pages is never executed.

## 4. Where data is stored, and for how long

All data is stored locally in the extension's IndexedDB database and `chrome.storage` inside your Chrome profile. It is not synchronized or uploaded. Up to 50 sessions are kept until you delete them; deleting a session removes its steps, evidence, notes, and screenshot in one operation. Uninstalling the extension removes all of its storage. Chrome's own profile sync does not include extension IndexedDB or `chrome.storage.session`.

## 5. How the data is used and shared

The data is used only to show you the review screen and to generate the files you export. The extension never transmits data. When you press an export button, Chrome saves a Markdown, JSON, TypeScript, or PNG file to your downloads folder; what you do with those files is entirely under your control. We receive nothing.

## 6. Prominent disclosure and consent

Before the first recording, the extension shows an in-product notice describing the debugger permission and the data handling above and requires you to press **I understand**. Each recording starts only when you press **Start recording**; typed-text recording is a per-session opt-in; screenshots require an explicit click and a second explicit opt-in to be exported.

## 7. Permissions

- **debugger** — needed to capture console errors, failed requests, navigation, and screenshots, and to inject the capture script into the recorded tab. Chrome shows "Access the page debugger backend" and "Read and change all your data on all websites" for it. BugReel attaches only to the tab you select, only after you press Start, and detaches on Stop or interruption; Chrome displays a banner in the tab while attached, and cancelling it ends the recording. While recording, the extension adds a small, non-interactive "BugReel recording" indicator element to the page (hidden during screenshots) and runs its capture script in an isolated world; it does not otherwise change page content or traffic. This permission cannot be made optional.
- **storage** — coordination state for the active recording and the onboarding flag.
- **sidePanel** — the recording controls, review screen, history, and export buttons.

No host permissions are requested, and `activeTab`, `scripting`, `tabs`, `cookies`, `history`, `downloads`, and `webRequest` are not used.

## 8. Remote code

All executable code ships inside the extension package. The capture script is a packaged file evaluated in an isolated world of the recorded tab. No code is downloaded or evaluated from the network.

## 9. Children

BugReel Recorder is a developer tool and is not directed at children.

## 10. Changes

This policy is updated whenever the extension's data handling changes; the version it describes is stated at the top. **[OWNER: describe how users will be notified, e.g. the store listing changelog and this page.]**
