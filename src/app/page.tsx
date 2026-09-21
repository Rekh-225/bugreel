import Link from 'next/link';
import { StartRecording } from '@/components/start-recording';
import { RecordLocalTarget } from '@/components/record-local-target';
import { AppHeader } from '@/components/app-header';
import { RecentSessions } from '@/components/recent-sessions';
import { Icon, type IconName } from '@/components/icon';

const stages: { number: string; name: string; title: string; description: string; icon: IconName }[] = [
  { number: '01', name: 'CAPTURE', title: 'Record the real failure.', description: 'Reproduce the bug in a real browser. We capture the actions that led you there.', icon: 'activity' },
  { number: '02', name: 'EVIDENCE', title: 'Nothing lost in translation.', description: 'Preserve console, network and visual evidence in one precise bug report.', icon: 'layers' },
  { number: '03', name: 'REPRODUCE', title: 'Don’t just describe it. Run it.', description: 'Generate and execute an exact Playwright reproduction in a fresh browser.', icon: 'play' },
];

export default function Home() {
  return <><AppHeader /><main className="workspace landing">
    <section className="hero"><div className="hero-copy"><div className="eyebrow hero-eyebrow"><span className="status-dot" /> FROM BROWSER BUG TO EXECUTABLE PROOF</div><h1>Reproduce it once.<br /><span>Never explain it again.</span></h1><p className="hero-description">The bug report that runs itself. Capture a real browser failure and turn it into evidence your next engineer—or coding agent—can actually use.</p><div className="hero-actions"><StartRecording /><Link className="button secondary" href="/demo-store" target="_blank">Explore Demo Store <Icon name="external" size={15} /></Link></div><p className="hero-note"><Icon name="check" size={14} /> Local by default. Share evidence only when you choose.</p></div>
    <div className="hero-preview" aria-label="Illustrative example of the evidence workflow"><div className="preview-top"><span className="window-dots"><i /><i /><i /></span><span>checkout-failure.bugreel</span><span className="example-label">EXAMPLE</span></div><div className="preview-body"><div className="preview-label"><span className="status-dot red" /> FAILURE CAPTURED</div><h2>Checkout fails after<br />applying SAVE20</h2><div className="preview-trail"><span>Add to Cart</span><Icon name="arrow" size={12} /><span>SAVE20</span><Icon name="arrow" size={12} /><span>Checkout</span></div><div className="preview-error"><span className="http-code">500</span><div><strong>POST /api/demo/checkout</strong><span>DISCOUNT_CHECKOUT_FAILURE</span></div><Icon name="network" size={18} /></div><div className="preview-code"><span className="code-purple">await</span> page.getByTestId(<span className="code-mint">&apos;checkout&apos;</span>).click();<br /><span className="code-purple">expect</span>(response.status()).toBe(<span className="code-mint">500</span>);</div><div className="preview-confirmed"><span className="check-icon"><Icon name="check" size={15} /></span><div><strong>Reproduction confirmed</strong><span>Real actions. Same failure. Executable proof.</span></div></div></div><div className="preview-bottom"><span><Icon name="terminal" size={12} /> Playwright reproduction</span><span>Deterministic by design</span></div></div>
    </section>
    <section className="workflow-stages" aria-label="How BugReel works">{stages.map(stage => <article className="workflow-stage" key={stage.name}><div className="stage-meta"><span className="stage-number">{stage.number}</span><span>{stage.name}</span><Icon name={stage.icon} size={17} /></div><h2>{stage.title}</h2><p>{stage.description}</p></article>)}</section>
    <section className="local-target"><RecordLocalTarget /></section>
    <RecentSessions />
    <footer className="app-footer"><span>Less back-and-forth. More fixing.</span><span>BugReel <span className="divider-dot">/</span> Local-first developer tools</span></footer>
  </main></>;
}
