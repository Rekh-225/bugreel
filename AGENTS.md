# BugReel

## Runtime and scope

Local-only Next.js application on http://127.0.0.1:3000. Node 22 and npm are available on the development machine. Recording launches a visible Playwright Chromium browser. Keep the application on port 3000; the target and control-origin checks intentionally use that fixed origin. Do not add arbitrary target URLs, cloud deployment, or authentication to this MVP. The explicitly approved exception to local-only processing is an optional, consent-based Devin handoff; recording and reproduction remain local.

## Commands

- Install locked dependencies: `npm ci`
- Install the browser: `npx playwright install chromium`
- Development: `npm run dev`
- Type checking: `npm run typecheck`
- Production build: `npm run build`
- Presentation server: `npm run start`
- Verification: `npm test`
- Visual snapshots: `npm test -- tests/ui.spec.ts --update-snapshots` after reviewing intentional UI changes. Current pixel baselines are Windows-specific and are compared only on Windows. Functional UI and responsive checks still run on every platform.

Playwright's main test configuration starts the app with the test-only local CDP port 9333. Stop a normal development/presentation server before running the full suite so the test runner can start its own test-enabled server. If reusing a server, it must have `BUGREEL_TEST_CDP_PORT=9333`. This lets workflow tests drive the actual separate recording browser through the dashboard. Do not enable that port for the final presentation server.

Set `BUGREEL_TEST_PRODUCTION=1` when running tests to have Playwright start the production build instead of the development server. Set `BUGREEL_REPLAY_HEADLESS=1` on the application server only if visible replay is unavailable. Recording remains visible.

## Product invariants

- Only successfully applied SAVE20 makes checkout return HTTP 500 with DISCOUNT_CHECKOUT_FAILURE. Typed-but-unapplied SAVE20 and normal checkout succeed.
- Capture HTTP errors with response listeners separately from transport request failures.
- Capture the failure screenshot after the checkout error is visible.
- Normalize typing and submissions before deterministic generation.
- Execute the exact displayed/downloadable test; verify its source hash before launch.
- REPRODUCTION CONFIRMED requires a passing test and matching HTTP, code, and visible-error evidence.
- NOT REPRODUCED requires a completed scenario whose only test failure is the explicit signature mismatch assertion.
- Browser, selector, timeout, worker, or infrastructure failures are REPLAY ERROR, never confirmation.
- The generated test characterizes the existing failure; a passing reproduction test does not mean the application bug is fixed.

## Storage and testing

Completed reports and generated artifacts are saved under gitignored `.bugreel/`. Never commit captured data. Active browser handles live in a process-global server-side manager. One recording or replay runs at a time. Finalized sessions survive server restarts.

The test suite covers healthy/failing checkout, normalization, code generation and real CLI execution, diagnostic capture, complete positive/negative UI workflows, actual selector-error replay, and responsive/visual checks. Demo Store controls use stable data-testid selectors. Keep those selectors intact when polishing the interface.

## Optional agent handoff

Reports with generated tests provide a deterministic Markdown agent packet for copy/download. The packet includes the exact test and current repository context, but not screenshot image bytes, local uncommitted changes, or API credentials. It explicitly distinguishes the commit at handoff time from the unrecorded commit at capture time.

One-click Send to Devin uses the official v3 session API. To enable it, the user must configure `DEVIN_API_KEY` (a service-user API key) and `DEVIN_ORG_ID` in the server environment or an untracked `.env.local`, then restart the server. Optional `DEVIN_MAX_ACU_LIMIT` defaults to 10 and must be an integer between 1 and 100. Never use NEXT_PUBLIC variables for these credentials, commit them, or ask the user to paste them in chat. No credentials are required for copying/downloading the packet.

Sending requires a confirmed reproduction, explicit per-submission consent, the exact reviewed packet hash, and the displayed ACU limit. A sent/pending/uncertain submission must not be automatically retried. A timeout can mean a cloud session already exists. Requests are serialized with local browser tasks to protect persisted session state.

The agent must work on a separate experimental fix branch and must not merge or change main: the Demo Store bug is intentional and must remain available for presentations. A correct fix also needs a healthy-checkout test; a failure-signature mismatch by itself does not prove correctness.

Handoff tests use fake credentials and mocked transports/browser routes. They do not create real Devin sessions. Live API verification requires separate user approval to send evidence and consume account credits.
