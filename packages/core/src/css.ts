// Portable implementation of the CSSOM `CSS.escape()` algorithm so selector escaping can be
// shared and unit-tested outside the browser. https://drafts.csswg.org/cssom/#serialize-an-identifier
export function cssEscape(value: string) {
  let result = '';
  const first = value.charCodeAt(0);
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index);
    if (code === 0) result += '\ufffd';
    else if ((code >= 0x1 && code <= 0x1f) || code === 0x7f || (index === 0 && code >= 0x30 && code <= 0x39) || (index === 1 && code >= 0x30 && code <= 0x39 && first === 0x2d)) result += `\\${code.toString(16)} `;
    else if (index === 0 && value.length === 1 && code === 0x2d) result += `\\${value.charAt(index)}`;
    else if (code >= 0x80 || code === 0x2d || code === 0x5f || (code >= 0x30 && code <= 0x39) || (code >= 0x41 && code <= 0x5a) || (code >= 0x61 && code <= 0x7a)) result += value.charAt(index);
    else result += `\\${value.charAt(index)}`;
  }
  return result;
}

/** A double-quoted CSS string, e.g. for attribute selector values. */
export function cssString(value: string) {
  return `"${value.replace(/[\u0000-\u001f\u007f"\\]/g, char => char === '"' || char === '\\' ? `\\${char}` : `\\${char.charCodeAt(0).toString(16)} `)}"`;
}
