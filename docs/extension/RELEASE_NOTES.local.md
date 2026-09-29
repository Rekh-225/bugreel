# BugReel Recorder 0.1.0 — local verification build (2026-09-28)

Build produced during the correctness/privacy/Chrome verification pass. Not published anywhere (no Chrome Web Store submission).

| Field | Value |
| --- | --- |
| Artifact | `C:\Users\rehan\Desktop\bugreel\apps\extension\release\bugreel-extension-0.1.0.zip` |
| Size | 108,425 bytes |
| SHA-256 | `36d1b93e0930715c5ce21ae391115671b36e7e074564539c18d635b450ee1785` |
| Unpacked build | `C:\Users\rehan\Desktop\bugreel\apps\extension\dist` (identical to the ZIP contents, verified with `Expand-Archive` + `diff -r`) |
| Manifest | `manifest.json` at the archive root, version 0.1.0 (= `package.json` = `apps/extension/manifest.json`), `minimum_chrome_version` 120, permissions `debugger`, `storage`, `sidePanel`, no host permissions |
| Contents | `manifest.json`, `background.js`, `chunks/limits-*.js`, `content.js`, `sidepanel.html`, `sidepanel.js`, `assets/sidepanel-*.css`, `icons/icon-{16,32,48,128}.png` |
| Package checks (`npm run ext:inspect`) | no source maps, TypeScript, `.env`, test, or fixture files; no remote script references; no `eval`/`new Function`; no credential-like strings; only relative imports |
| Source | branch `feature/chrome-extension`: commit `b4da428` plus the verification-pass changes committed after it (see `CONTEXT.md`, session 3) |

Reproduce: `npm ci && npm run ext:package && npm run ext:inspect`. The build is deterministic apart from Vite chunk hashes, which depend on content only.

## Verification status

- Automated: `npm run typecheck` ✓ · `npm run build` ✓ · `npm test` 40 passed, 1 opt-in skipped ✓ · `npm run test:extension` 70 passed, 1 intentionally skipped (store screenshots) ✓ — all on Windows 11 with Playwright Chromium 153 (build 1243).
- Manual in Google Chrome 153.0.8010.53: **pending** — see `MANUAL_TEST_PLAN.md`.
