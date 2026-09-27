import type { Selector } from './model';

/** JavaScript string literal used by the local application's generator. Output must stay byte-for-byte stable. */
export const quote = (value: string) => JSON.stringify(value).replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');

// Bidirectional overrides and other invisible format characters can make source display differently from how it runs.
const INVISIBLE = /[\u00ad\u061c\u180e\u200b-\u200f\u202a-\u202e\u2060-\u2064\u2066-\u206f\ufeff\ufff9-\ufffb]/g;
const LINE_BREAKS = /\r\n|[\n\r\u2028\u2029\u0085]/;
const hex = (char: string) => `\\u${char.charCodeAt(0).toString(16).padStart(4, '0')}`;

export const stripInvisible = (text: string) => text.replace(INVISIBLE, '');

/** Hardened string literal for untrusted values: JSON escaping plus escaped line separators and invisible format characters. */
export const literal = (value: string) => quote(value).replace(INVISIBLE, hex);

/** Renders untrusted text as one or more `//` comment lines. Line terminators cannot end the comment early. */
export const comment = (text: string, indent = '') => text.replace(INVISIBLE, '').split(LINE_BREAKS).map(line => `${indent}// ${line}`.trimEnd()).join('\n');

/** Single-line plain text for labels and titles: control characters and invisible format characters removed. */
export const plain = (text: string, max = 200) => {
  const cleaned = text.replace(INVISIBLE, '').replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]+/g, ' ').replace(/\s+/g, ' ').trim();
  return cleaned.length > max ? `${cleaned.slice(0, max - 1)}…` : cleaned;
};

export function locatorSource(selector: Selector, q: (value: string) => string = quote) {
  switch (selector.kind) {
    case 'testId': return `page.getByTestId(${q(selector.value)})`;
    case 'role': {
      if (!selector.role) throw new Error('A role selector needs a role.');
      return `page.getByRole(${q(selector.role)}, { name: ${q(selector.value)}, exact: true })`;
    }
    case 'id': return `page.locator(${q(`[id=${JSON.stringify(selector.value)}]`)})`;
    case 'label': return `page.getByLabel(${q(selector.value)}, { exact: true })`;
    case 'placeholder': return `page.getByPlaceholder(${q(selector.value)}, { exact: true })`;
    case 'text': return `page.getByText(${q(selector.value)}, { exact: true })`;
    case 'css': return `page.locator(${q(selector.value)})`;
    default: throw new Error('Unsupported selector.');
  }
}
