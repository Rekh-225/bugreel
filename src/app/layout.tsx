import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'BugReel — Reproduce it once. Never explain it again.',
  description: 'Turn a real browser failure into evidence and an executable Playwright reproduction.',
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
