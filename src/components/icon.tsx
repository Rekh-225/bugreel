import type { CSSProperties } from 'react';

const paths = {
  arrow: 'M5 12h14m-6-6 6 6-6 6',
  play: 'm8 5 11 7-11 7V5Z',
  stop: 'M6 6h12v12H6z',
  check: 'm5 12 4 4L19 6',
  close: 'm6 6 12 12M6 18 18 6',
  code: 'm8 7-5 5 5 5m8-10 5 5-5 5m-3-13-2 16',
  terminal: 'm5 7 5 5-5 5m8 0h6',
  network: 'M12 3v6m-7 6v-3h14v3M9 3h6v6H9zM2 15h6v6H2zM16 15h6v6h-6z',
  camera: 'M4 6h4l2-3h4l2 3h4v14H4V6Zm12 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0Z',
  copy: 'M9 9h11v12H9zM15 9V3H3v12h6',
  download: 'M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5',
  external: 'M14 3h7v7m0-7L10 14M10 3H3v18h18v-7',
  clock: 'M12 8v5l3 2m6-3a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z',
  activity: 'M2 12h5l3-8 4 16 3-8h5',
  alert: 'M12 8v5m0 3h.01M12 3 2 21h20L12 3Z',
  layers: 'm12 3 10 5-10 5L2 8l10-5ZM2 12l10 5 10-5M2 16l10 5 10-5',
};
export type IconName = keyof typeof paths;
export function Icon({ name, size = 18, className = '', style }: { name: IconName; size?: number; className?: string; style?: CSSProperties }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" className={className} style={style} aria-hidden="true"><path d={paths[name]} /></svg>;
}
