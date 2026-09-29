# Chrome Web Store listing materials (local draft)

Prepared for BugReel Recorder 0.1.0. **Not submitted.** Everything here stays in the repository until the owner decides to publish; see [WEB_STORE_CHECKLIST.md](WEB_STORE_CHECKLIST.md) for the gating conditions (including the pending manual Chrome verification).

## Listing text

**Name:** BugReel Recorder

**Summary (≤132 characters):**
Record a bug in one tab, review the evidence, and export a report, a JSON recording, and an editable Playwright draft. Local only.

**Category:** Developer Tools · **Language:** English

**Detailed description:**

BugReel Recorder helps developers and testers turn "it broke when I clicked checkout" into a precise bug report.

Choose a tab, press Start, reproduce the problem, press Stop. BugReel captures the steps you took (clicks, typing, form submissions, navigation), the console errors and failed network requests that happened in that tab, and, only when you ask, a screenshot. Then you review everything, describe the expected and actual behaviour, remove anything irrelevant, and export:

• a Markdown bug report,
• a versioned JSON recording,
• an editable Playwright test draft.

Honest by design
• The Playwright draft is labelled UNVERIFIED. BugReel never runs it and never claims the bug was reproduced.
• Typed text is not recorded unless you turn it on for a session. Password fields and fields that look sensitive are never read.
• Request and response bodies, headers, cookies, and page storage are never collected. URLs and messages are redacted on a best-effort basis.
• Screenshots are taken only on request, are shown to you first, and are excluded from exports until you include them.
• Everything stays in your Chrome profile. No account, no server, no analytics.

Why the debugger permission?
BugReel uses Chrome's debugger API to see console errors, failed requests, and navigation in the tab you selected and to take screenshots. Chrome therefore warns that the extension can "read and change all your data on all websites" and "access the page debugger backend". BugReel attaches only to the tab you pick, only after you press Start, and detaches when you stop. Chrome shows a banner while it is attached.

Scope and limits
• One tab and its main frame. Embedded frames are not recorded (but appear in screenshots).
• Recording stops if the tab moves to a different site.
• Not for chrome:// pages, the Chrome Web Store, or local files.

Open source: https://github.com/Rekh-225/bugreel

## Privacy tab entries

**Single purpose:** Record a bug reproduction in one browser tab and export a report, a JSON recording, and an unverified Playwright test draft for developers.

**Permission justifications**

| Permission | Justification to enter |
| --- | --- |
| `debugger` | Attaches to the single tab the user selects, only after the user presses Start, to capture console errors and assertion failures, uncaught exceptions, failed or 4xx/5xx requests (metadata only, no bodies or headers), navigation, and on-request screenshots, and to inject the packaged capture script into an isolated world of that tab. Detaches on Stop or interruption. No other API provides these diagnostics without host permissions. |
| `storage` | Keeps the coordination state of the active recording (`chrome.storage.session`) and the flag that the onboarding notice was accepted (`chrome.storage.local`). |
| `sidePanel` | Hosts the recording controls, review screen, session history, and export buttons. |

**Host permissions:** none requested.

**Remote code:** No, I am not using remote code. All code is in the package; the capture script is the packaged `content.js`, evaluated in an isolated world of the recorded tab through the debugger API.

**Data usage — categories to tick** (Chrome Web Store dashboard "Privacy practices" list; confirm the labels against the dashboard at submission time). Per the Chrome Web Store User Data FAQ, handling includes local-only processing and storage, so these are declared even though nothing is transmitted:

| Dashboard category | Declare? | Why |
| --- | --- | --- |
| Personally identifiable information | **Yes** | If the user enables typed-text recording, ordinary text fields may contain names or other identifiers; a screenshot can show any personal information on screen; report text is free-form. Password and sensitive fields are never read. |
| Health information | No | Not targeted, but a screenshot or typed text on a health site could contain it. Declare if the owner prefers the conservative reading. |
| Financial and payment information | No (never read) | Payment fields (`cc-*` autocomplete, card-like names) are never read. A screenshot could still show payment details on screen; keep the screenshot consent wording prominent. |
| Authentication information | No (never read) | Passwords and one-time codes are never read; cookies and headers are not collected. Screenshots could show authentication UI. |
| Personal communications | No | Not collected unless present in a screenshot or typed into an ordinary field with value recording on. |
| Location | No | Not collected. |
| Web history | **Yes** | Sanitized URLs of the pages the recorded tab visits during a session are stored (the FAQ counts "domains or URLs the browser interacts with" as web browsing activity). Only for the selected tab between Start and Stop. |
| User activity | **Yes** | Clicks, keystroke events (as fill steps), form submissions, and network-error monitoring in the recorded tab. |
| Website content | **Yes** | Element labels and visible text of interacted elements, console messages, request URLs, and optional screenshots. |

**Certifications to tick:** I do not sell or transfer user data to third parties, outside of the approved use cases · I do not use or transfer user data for purposes unrelated to the item's single purpose · I do not use or transfer user data to determine creditworthiness or for lending purposes.

**Privacy policy URL:** host [PRIVACY.md](PRIVACY.md) at a public URL after completing the **[OWNER]** fields.

## Reviewer notes and demo instructions

Enter in the "Notes for reviewers" field (adapt paths):

> BugReel Recorder is a local-only developer tool. It needs the `debugger` permission to read console errors, failed requests, and navigation in the one tab the user selects, and to take screenshots on request. It attaches only after the user presses Start, detaches on Stop, requests no host permissions, makes no network requests, and executes no remote code (the capture script is `content.js` inside the package, evaluated in an isolated world). While recording it adds a small non-interactive indicator element to the page; it does not otherwise modify pages or traffic.
>
> To test without any account: clone https://github.com/Rekh-225/bugreel (branch `feature/chrome-extension`), run `npm ci && npm run ext:demo`, and open http://127.0.0.1:4180/ . The demo shop is fully synthetic: type anything into the ordinary and "sensitive" fields, click "Checkout" (HTTP 500 + console.error), "Fail an assertion", "Load a missing resource", and "Break the connection", then click the BugReel toolbar icon → Start recording before the clicks and Stop afterwards. Review the session, tick a failure signature, and export. The exported files show placeholders for the password/email/card fields and omit the embedded frame's error.
>
> Alternatively any public http(s) page works; nothing is sent anywhere.

## Store screenshots

`npm run ext:store-shots` regenerates `docs/extension/store/*.png` (1280×800) from the side-panel page loaded as a tab in Playwright's Chromium against the synthetic demo site. They are real captures of the extension's panel UI, but **not** captures of Chrome's side-panel chrome (frame, toolbar); take those manually from desktop Chrome once the manual test plan has been executed.

## Do not claim

- That BugReel "collects no data" (it handles user data locally).
- That it "never modifies pages" (it injects an indicator and an isolated-world script).
- That screenshots exclude embedded frames or sensitive text.
- That the debugger permission review has a known duration or outcome.
- That any exported test was verified, passed, or reproduced the bug.
