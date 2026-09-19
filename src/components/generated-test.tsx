'use client';

import { useState } from 'react';
import { Icon } from './icon';

export function GeneratedTest({ id, source, hash }: { id: string; source: string; hash: string }) {
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState(false);
  async function copy() {
    try { await navigator.clipboard.writeText(source); setCopied(true); setCopyError(false); setTimeout(() => setCopied(false), 2000); }
    catch { setCopyError(true); }
  }
  return <section className="panel generated-panel" id="generated-test"><div className="panel-heading"><div className="panel-title"><Icon name="code" /><h2>Generated Playwright test</h2><span className="badge">TypeScript</span></div><div className="code-actions"><button className="text-button" onClick={copy}><Icon name={copied ? 'check' : 'copy'} size={14} />{copied ? 'Copied' : 'Copy'}</button><a className="text-button" href={`/api/sessions/${id}/artifacts/reproduction.spec.ts`}><Icon name="download" size={14} />Download</a></div></div><div className="code-explainer"><span><span className="status-dot" /> This is the exact file executed by Run Reproduction.</span><span className="mono">SHA-256 {hash.slice(0, 12)}</span></div>{copyError && <p role="alert" className="inline-warning">Clipboard unavailable. Use Download to save the test.</p>}<div className="code-window"><div className="line-numbers" aria-hidden="true">{source.trimEnd().split('\n').map((_, index) => <span key={index}>{index + 1}</span>)}</div><pre><code data-testid="generated-source">{source}</code></pre></div><div className="code-footer"><Icon name="alert" size={14} /><span>This test passes when the bug is present. It asserts the failure, not healthy application behavior.</span></div></section>;
}
