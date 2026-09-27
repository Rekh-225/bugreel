# BugReel Recorder privacy disclosure (draft)

This draft describes what the BugReel Recorder Chrome extension version 0.1.0 actually does. It is written to be pasted into the Chrome Web Store privacy fields and a hosted privacy page after review by the project owner. Statements below are checked by the automated test suite where noted.

## Summary

BugReel Recorder records a bug reproduction in **one browser tab you choose**, only **after you press Start**, and stores the result **only inside your Chrome profile**. It has no server, account, analytics, or telemetry, and it makes no network requests of its own. You decide what to export, and exports are ordinary files saved by your browser.

## Data the extension collects while recording

Collection happens only between **Start** and **Stop** (or an interruption) and only for the selected tab's main frame:

- **Interactions:** clicks, form submissions, select changes, and typing events, together with the element's tag, role, label, placeholder, test ID, name, and visible text (truncated and redacted), plus the sanitized page URL and a timestamp.
- **Typed values:** *not collected by default*. If you enable "Record typed text for this session", values of ordinary text fields are stored. Password fields and fields identified as sensitive (email, phone, payment, identity, one-time codes, usernames, and fields marked private) are never stored; a placeholder is recorded instead.
- **Navigation:** the sanitized URLs the tab visits within the same site and whether a step caused the navigation.
- **Console errors and uncaught exceptions:** the message text (truncated to 1,000 characters), up to five stack frames, and the script location, after redaction.
- **Failed requests:** method, sanitized URL, HTTP status or network error text, and resource type for responses with status 400–599 and transport failures. Request and response **bodies, headers, and cookies are not collected**.
- **Screenshot:** one image of the visible tab, **only when you click Capture screenshot**. Image pixels are not redacted.
- **Report text you type:** title, expected behaviour, actual behaviour, and notes.
- **Session metadata:** start and end time, the site origin, the viewport size, the Chrome major version, and why a recording ended.

The extension does **not** collect browsing history, bookmarks, cookies, local storage contents, form data outside the recorded tab, clipboard contents, audio, video, location, or any information from other tabs, frames, or extensions.

## Sanitization and redaction

Before anything is stored, URLs have credentials removed and secret-looking path segments, query values, and fragment values replaced with `REDACTED`. Message text is passed through conservative rules that remove tokens, bearer credentials, key/value secrets, email addresses, and long numbers. Element labels that redaction would alter are not used. This is best-effort filtering: it reduces accidental disclosure but **cannot guarantee that every secret is removed**, and it does not apply to screenshot pixels. Review exports before sharing them.

## Where data is stored

All data is stored locally in the extension's IndexedDB database and `chrome.storage` inside your Chrome profile. Nothing is synchronized or uploaded. Up to 50 sessions are kept; you can delete any session at any time, which removes its steps, evidence, notes, and screenshot in one operation. Uninstalling the extension removes its storage.

## Sharing

The extension never transmits data. When you click an export button, Chrome saves a Markdown, JSON, TypeScript, or PNG file to your downloads folder. What happens with those files is entirely under your control.

## Permissions

- **debugger** – Required to capture console errors, failed requests, navigation, and screenshots, and to inject the capture script into the recorded tab. Chrome shows the warnings "Access the page debugger backend" and "Read and change all your data on all websites" for this permission. BugReel attaches the debugger only to the tab you select, only after you press Start, and detaches when you stop or when the recording is interrupted. While attached, Chrome displays a banner in the tab; cancelling it ends the recording. This permission cannot be made optional.
- **storage** – Keeps coordination state for the active recording and remembers that you have seen the onboarding notice.
- **sidePanel** – Shows the recording controls, review screen, history, and export buttons.

The extension requests no host permissions and does not use `activeTab`, `scripting`, `tabs`, `cookies`, `history`, `downloads`, or `webRequest`.

## Remote code

All executable code ships inside the extension package. The capture script is a file in the package that the extension evaluates in an isolated JavaScript world of the recorded tab. No code is downloaded or evaluated from the network, and content from web pages is never executed.

## Children

The extension is a developer tool and is not directed at children.

## Changes and contact

This document must be updated whenever the extension's data handling changes. Report concerns through the repository issue tracker: https://github.com/Rekh-225/bugreel/issues
