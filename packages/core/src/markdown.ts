import type { BugReelRecording } from './recording';
import { plain, stripInvisible } from './source';

/** Escapes inline Markdown so untrusted text cannot create links, images, HTML, headings, lists, or formatting. */
export function mdText(text: string) {
  return plain(text, 5000)
    .replace(/[\\`*_{}[\]()#+!|<>~&]/g, char => char === '&' ? '&amp;' : char === '<' ? '&lt;' : char === '>' ? '&gt;' : `\\${char}`)
    .replace(/:(?=\/\/)/g, '\\:')
    .replace(/^(\d+)\./, '$1\\.').replace(/^-/, '\\-').replace(/^=/, '\\=');
}

/** Inline code span with a fence longer than any backtick run in the content. */
export function mdCode(text: string) {
  const value = plain(text, 2100);
  const longest = Math.max(0, ...(value.match(/`+/g) || []).map(run => run.length));
  const fence = '`'.repeat(longest + 1);
  const pad = value.startsWith('`') || value.endsWith('`') ? ' ' : '';
  return `${fence}${pad}${value}${pad}${fence}`;
}

/** Fenced block for multi-line untrusted text. */
export function mdBlock(raw: string, language = 'text') {
  const text = stripInvisible(raw);
  const longest = Math.max(2, ...(text.match(/`{3,}/g) || []).map(run => run.length));
  const fence = '`'.repeat(longest + 1);
  return `${fence}${language}\n${text.replace(/\r\n?/g, '\n')}\n${fence}`;
}

/** Multi-line paragraph text: each line escaped; blank input yields an explicit placeholder. */
function mdParagraph(text: string, empty: string) {
  const lines = text.replace(/\r\n?/g, '\n').split('\n').map(line => line.trim()).filter(Boolean);
  return lines.length ? lines.map(mdText).join('  \n') : `_${empty}_`;
}

const cell = (text: string) => mdText(text).replace(/\n/g, ' ');
const durationText = (ms: number) => ms < 60_000 ? `${Math.round(ms / 1000)} s` : `${Math.floor(ms / 60_000)} min ${Math.round((ms % 60_000) / 1000)} s`;

export function generateMarkdown(recording: BugReelRecording): string {
  const { session, report, target, evidence, playwright } = recording;
  const signatureId = evidence.failureSignature?.evidenceId;
  const out: string[] = [];
  out.push(`# ${mdText(report.title)}`, '');
  out.push('> **Unverified BugReel recording.** The accompanying Playwright draft has not been run by BugReel and does not confirm that the bug reproduces.', '');
  out.push('| Field | Value |', '| --- | --- |');
  out.push(`| Recorded | ${cell(session.startedAt)} (${durationText(session.durationMs)}) |`);
  out.push(`| Recording status | ${session.status === 'completed' ? 'Completed' : `Interrupted: ${cell(session.interruption?.message ?? 'unknown reason')}`} |`);
  out.push(`| Start URL | ${mdCode(target.startUrl)} |`);
  if (target.viewport) out.push(`| Viewport | ${target.viewport.width} × ${target.viewport.height} |`);
  if (session.browser) out.push(`| Browser | ${cell(session.browser)} |`);
  out.push(`| Typed values | ${session.typedValuesRecorded ? 'Recorded for fields not identified as sensitive' : 'Not recorded; placeholders are used'} |`);
  out.push(`| Recording ID | ${mdCode(session.id)} |`, '');

  out.push('## Expected behaviour', '', mdParagraph(report.expected, 'Not provided.'), '');
  out.push('## Actual behaviour', '', mdParagraph(report.actual, 'Not provided.'), '');
  if (report.notes.trim()) out.push('## Notes', '', mdParagraph(report.notes, ''), '');

  out.push('## Steps to reproduce', '');
  const steps: { at: number; order: number; text: string }[] = [];
  recording.actions.forEach(action => steps.push({ at: action.elapsedMs, order: 1, text: `${mdText(action.label)}${action.configKey ? ` (value placeholder ${mdCode(action.configKey)})` : ''}${action.selector?.confidence === 'fallback' ? ' _(low-confidence selector)_' : ''}` }));
  recording.gaps.forEach((gap, index) => steps.push({ at: gap.startElapsedMs, order: 0, text: `**Recording gap ${index + 1}:** recording was paused${gap.endedAt ? '' : ' and not resumed'}; actions during the pause were not captured.` }));
  recording.unsupportedSteps.forEach(step => steps.push({ at: step.elapsedMs, order: 0, text: `**Not replayable:** ${mdText(step.description)}` }));
  steps.sort((a, b) => a.at - b.at || a.order - b.order);
  out.push(...(steps.length ? steps.map((step, index) => `${index + 1}. ${step.text}`) : ['_No steps were recorded._']), '');

  out.push('## Selected evidence', '');
  if (!evidence.network.length && !evidence.console.length) out.push('_No console or network evidence was selected. This may be a visual or behavioural bug._', '');
  if (evidence.network.length) {
    out.push('### Network', '', '| | Method | URL | Result | Time |', '| --- | --- | --- | --- | --- |');
    for (const item of evidence.network) out.push(`| ${item.id === signatureId ? '**Failure signature**' : ''} | ${cell(item.method)} | ${mdCode(item.url)} | ${item.kind === 'http' ? `HTTP ${item.status}${item.statusText ? ` ${cell(item.statusText)}` : ''}` : `Failed: ${cell(item.error || 'network error')}`} | +${durationText(item.elapsedMs)} |`);
    out.push('');
  }
  if (evidence.console.length) {
    out.push('### Console errors and exceptions', '');
    for (const item of evidence.console) {
      const label = item.kind === 'exception' ? 'Uncaught exception' : item.consoleType === 'assert' ? 'Console assertion failure (console.assert)' : 'Console error (console.error)';
      out.push(`- ${item.id === signatureId ? '**Failure signature** · ' : ''}${label} at +${durationText(item.elapsedMs)}${item.url ? ` in ${mdCode(`${item.url}${item.line !== undefined ? `:${item.line}` : ''}`)}` : ''}`, '');
      out.push(mdBlock([item.message, ...(item.stack ?? []).map(frame => `    at ${frame}`)].join('\n')).split('\n').map(line => `  ${line}`).join('\n'), '');
    }
  }

  out.push('## Screenshot', '');
  out.push(recording.screenshot ? `${mdCode(recording.screenshot.fileName)} (${recording.screenshot.width} × ${recording.screenshot.height}, captured ${cell(recording.screenshot.capturedAt)}). Screenshot pixels are not redacted.` : '_No screenshot included._', '');

  if (recording.requiredConfiguration.length) {
    out.push('## Required configuration', '');
    for (const entry of recording.requiredConfiguration) out.push(`- ${mdCode(entry.key)}: ${mdText(entry.description)}`);
    out.push('');
  }

  out.push('## Playwright draft', '');
  out.push(`Status: **${playwright.status === 'draft' ? 'Draft (unverified)' : 'Incomplete draft (unverified)'}**. Assertion: ${playwright.assertion === 'failure-signature' ? 'checks the selected failure signature' : 'none generated'}.`, '');
  for (const note of playwright.notes) out.push(`- ${mdText(note)}`);
  out.push('', '---', '', `_Generated by ${mdText(recording.generator.name)} ${mdText(recording.generator.version)}. Diagnostic text was filtered with best-effort redaction; review before sharing._`, '');
  return out.join('\n');
}
