# Example exports

These files were exported by the BugReel Chrome extension from a real recording of the test fixture site (`apps/extension/tests/fixtures/server.ts`, served on a fixed port for stable URLs). Regenerate them with `npm run ext:examples`.

- [`example-report.md`](example-report.md) – Markdown report.
- [`example.recording.json`](example.recording.json) – schema v1 JSON recording (validates against `packages/core/schema/bugreel-recording-v1.schema.json`).
- [`example.spec.ts`](example.spec.ts) – the unverified Playwright draft. Note the `requiredValue` placeholders for the omitted coupon, password, and select values, and the failure-signature assertion that passes while the bug is present.

The screenshot is not committed; the JSON records its metadata (`screenshot.fileName`, size, and `pixelsRedacted: false`).

The scenario: typing a coupon and a password (typed-value recording off), choosing a size, accepting terms, and clicking **Checkout**, which returns HTTP 500 and logs a console error containing an email address that the redaction replaced with `[REDACTED:email]`.
