const RESTRICTED_HOSTS = ['chromewebstore.google.com', 'chrome.google.com'];

/** Whether a tab URL can be recorded, with a user-facing explanation when it cannot. */
export function recordability(url: string | null | undefined): { supported: true } | { supported: false; reason: string } {
  if (!url) return { supported: false, reason: 'BugReel cannot read this tab. Open a regular http:// or https:// page and try again.' };
  let parsed: URL;
  try { parsed = new URL(url); } catch { return { supported: false, reason: 'This tab does not have a valid web address.' }; }
  if (parsed.protocol === 'file:') return { supported: false, reason: 'Local files (file://) are not supported. Serve the page over http://localhost instead.' };
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return { supported: false, reason: `Chrome does not allow extensions to record ${parsed.protocol}// pages (browser settings, extension pages, and internal pages are restricted).` };
  if (RESTRICTED_HOSTS.includes(parsed.hostname) && (parsed.hostname !== 'chrome.google.com' || parsed.pathname.startsWith('/webstore'))) return { supported: false, reason: 'Chrome does not allow extensions to record the Chrome Web Store.' };
  return { supported: true };
}
