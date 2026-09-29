export function writeZip(sourceDir: string, files: string[], zipPath: string): Promise<void>;
export function readZip(zipPath: string): Promise<{ name: string; data: Buffer }[]>;
