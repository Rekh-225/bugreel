import Link from 'next/link';
import { Icon } from './icon';

export function AppHeader() {
  return <header className="app-header"><div className="header-inner">
    <Link href="/" className="brand" aria-label="BugReel home"><svg className="brand-mark" width="30" height="30" viewBox="0 0 32 32" fill="none" aria-hidden="true"><rect width="32" height="32" rx="9" fill="currentColor" /><path d="M10 9h4v4h-4zm8 0h4v4h-4zm-8 10h4v4h-4zm8 0h4v4h-4z" fill="#0c1110" /><path d="m14 13 6 3-6 3v-6Z" fill="#0c1110" /></svg><span>BugReel<span className="brand-period">.</span></span></Link>
    <nav aria-label="Main navigation"><Link href="/" className="nav-link">Workspace</Link><Link href="/demo-store" target="_blank" className="nav-link">Demo Store <Icon name="external" size={12} /></Link></nav>
    <span className="local-badge"><span className="status-dot" />Local environment</span>
  </div></header>;
}
