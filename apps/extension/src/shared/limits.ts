// Documented storage and collection limits. See apps/extension/README.md#storage-and-limits.
export const MAX_SESSIONS = 50;
export const MAX_INTERACTIONS = 1000;
export const MAX_CONSOLE = 300;
export const MAX_NETWORK = 300;
export const MAX_UNSUPPORTED = 200;
export const MAX_PAYLOAD_BYTES = 16_384;
export const MAX_SCREENSHOT_BYTES = 8 * 1024 * 1024;
export const MAX_PENDING_REQUESTS = 1000;
/** A full-page navigation or SPA route change this soon after an interaction is treated as caused by it. */
export const ACTION_NAVIGATION_WINDOW_MS = 3000;
/** Late events from the previous document (e.g. input flushed on pagehide) are accepted for this long. */
export const PREVIOUS_DOCUMENT_GRACE_MS = 1500;
