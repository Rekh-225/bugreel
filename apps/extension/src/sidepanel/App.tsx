import { useCallback, useEffect, useState } from 'react';
import type { ActiveSummary, TabDescription } from '../shared/types';
import { readActive, request } from './data';
import { Home } from './Home';
import { RecordingView } from './RecordingView';
import { ReviewView } from './ReviewView';

const pinnedTab = (() => {
  const value = new URLSearchParams(location.search).get('tab');
  return value && /^\d+$/.test(value) ? Number(value) : null;
})();

/** The tab this panel records: the pinned tab (panel opened as a page) or the active tab of the panel's window. */
function useTargetTab() {
  const [target, setTarget] = useState<TabDescription | null>(null);
  const refresh = useCallback(async () => {
    let tabId = pinnedTab;
    if (tabId === null) {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      tabId = tab?.id ?? null;
    }
    if (tabId === null) { setTarget(null); return; }
    setTarget(await request<TabDescription>({ type: 'describeTab', tabId }).catch(() => ({ tabId: tabId!, url: null, title: null, supported: false, reason: 'BugReel cannot read this tab.' })));
  }, []);
  useEffect(() => {
    void refresh();
    const onActivated = () => { void refresh(); };
    const onUpdated = (_tabId: number, change: chrome.tabs.OnUpdatedInfo) => { if (change.status === 'complete' || change.title) void refresh(); };
    chrome.tabs.onActivated.addListener(onActivated);
    chrome.tabs.onUpdated.addListener(onUpdated);
    return () => { chrome.tabs.onActivated.removeListener(onActivated); chrome.tabs.onUpdated.removeListener(onUpdated); };
  }, [refresh]);
  return { target, refresh };
}

function useActive() {
  const [active, setActive] = useState<ActiveSummary | undefined>(undefined);
  useEffect(() => {
    const load = () => { void readActive().then(setActive); };
    // Wake the worker first so its startup recovery has repaired interrupted sessions before anything is read.
    void request({ type: 'getActive' }).catch(() => undefined).then(load);
    const listener = (changes: Record<string, chrome.storage.StorageChange>, area: string) => { if (area === 'session' && 'active' in changes) load(); };
    chrome.storage.onChanged.addListener(listener);
    return () => chrome.storage.onChanged.removeListener(listener);
  }, []);
  return active;
}

function Onboarding({ onDone }: { onDone: () => void }) {
  return (
    <section className="card onboarding" data-testid="onboarding">
      <h2>Before you record</h2>
      <p>BugReel records one tab while you reproduce a bug, then helps you export a report, a JSON recording, and an editable Playwright draft.</p>
      <h3>Why Chrome showed a strong warning</h3>
      <p>
        When you installed BugReel, Chrome warned that it can <strong>“Read and change all your data on all websites”</strong> and
        <strong> “Access the page debugger backend”</strong>. Both warnings come from the <code>debugger</code> permission, which
        BugReel needs to capture console errors, failed requests, and screenshots. It cannot be made optional.
      </p>
      <ul>
        <li>BugReel attaches only to the tab you choose, only after you press <strong>Start recording</strong>, and detaches when you stop.</li>
        <li>While attached, Chrome shows a “BugReel started debugging this browser” banner. Pressing <strong>Cancel</strong> there ends the recording.</li>
        <li>Capture stops automatically if the tab navigates to a different site.</li>
      </ul>
      <h3>Your data</h3>
      <ul>
        <li>Everything stays in this browser profile. BugReel makes no network requests and has no account or telemetry.</li>
        <li>Typed text is <strong>not</strong> recorded unless you enable it for a session. Password fields are never recorded.</li>
        <li>Request and response bodies, cookies, headers, and page storage are not collected. URLs and messages are redacted on a best-effort basis.</li>
        <li>Screenshots are taken only when you ask, and their pixels are not redacted.</li>
      </ul>
      <button className="primary" data-testid="onboarding-done" onClick={onDone}>I understand</button>
    </section>
  );
}

export function App() {
  const active = useActive();
  const { target, refresh } = useTargetTab();
  const [onboarded, setOnboarded] = useState<boolean | undefined>(undefined);
  const [reviewing, setReviewing] = useState<string | null>(null);

  useEffect(() => { void chrome.storage.local.get('onboarded').then(value => setOnboarded(value.onboarded === true)); }, []);
  // When a recording ends for any reason (Stop, interruption, tab closed), open its review.
  const [lastActive, setLastActive] = useState<string | null>(null);
  useEffect(() => {
    if (active) setLastActive(active.sessionId);
    else if (active === null && lastActive) { setReviewing(lastActive); setLastActive(null); }
  }, [active, lastActive]);
  const finishOnboarding = () => { void chrome.storage.local.set({ onboarded: true }); setOnboarded(true); };

  if (onboarded === undefined || active === undefined) return <main className="app" aria-busy="true" />;
  return (
    <main className="app">
      <header className="top">
        <h1><img className="logo" src="icons/icon-48.png" alt="" />BugReel</h1>
        {onboarded && <button className="link" onClick={() => setOnboarded(false)}>Privacy &amp; permissions</button>}
      </header>
      {!onboarded ? <Onboarding onDone={finishOnboarding} />
        : active ? <RecordingView active={active} target={target} onStopped={id => setReviewing(id)} />
          : reviewing ? <ReviewView sessionId={reviewing} onClose={() => { setReviewing(null); void refresh(); }} />
            : <Home target={target} onOpen={setReviewing} />}
    </main>
  );
}
