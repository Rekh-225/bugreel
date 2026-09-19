# BugReel

## Runtime and scope

Local-only Next.js application on http://127.0.0.1:3000. Node 22 and npm are available on the development machine. Recording launches a visible Playwright Chromium browser. Keep the application on port 3000; the target and control-origin checks intentionally use that fixed origin. Do not add arbitrary target URLs, cloud deployment, authentication, or external integrations to this MVP.

## Commands

- Install locked dependencies: `npm ci`
- Install the browser: `npx playwright install chromium`
- Development: `npm run dev`
- Type checking: `npm run typecheck`
- Production build: `npm run build`
- Presentation server: `npm run start`
- Verification: `npm test`
- Visual snapshots: `npm test -- tests/ui.spec.ts --update-snapshots` after reviewing intentional UI changes. Current baselines are Windows-specific.

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
