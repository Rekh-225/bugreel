import { promises as fs } from 'node:fs';
import path from 'node:path';
import { NextResponse } from 'next/server';
import { sessionDirectory, validId } from '@/lib/server/artifacts';

export const runtime = 'nodejs';
export async function GET(_request: Request, context: { params: Promise<{ id: string; name: string }> }) {
  const { id, name } = await context.params;
  if (!validId(id) || !/^(recorded-failure\.png|recorded-stop\.png|reproduction\.spec\.ts|replay-[0-9a-f-]{36}\.png)$/.test(name)) return NextResponse.json({ error: 'Artifact not found.' }, { status: 404 });
  try {
    const buffer = await fs.readFile(path.join(sessionDirectory(id), name));
    return new Response(buffer, { headers: { 'Content-Type': name.endsWith('.png') ? 'image/png' : 'text/plain; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...(name.endsWith('.ts') ? { 'Content-Disposition': 'attachment; filename="reproduction.spec.ts"' } : {}) } });
  } catch { return NextResponse.json({ error: 'Artifact not found.' }, { status: 404 }); }
}
