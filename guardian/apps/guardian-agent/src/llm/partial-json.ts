/**
 * Extract the current string value of `<root>.<field>` from a JSON buffer
 * that may be truncated mid-token. Designed for streaming summarizer JSON
 * where only `summary` and `reasoning` are needed.
 *
 * Returns:
 *   - `undefined` if the key has not yet appeared at the top level
 *   - the accumulated string value (possibly partial) otherwise
 *
 * Safety: if the buffer ends in a lone backslash, we drop it — the next
 * tick will deliver either `\"` (escaped quote) or `\\` (escaped slash) and
 * we'll handle it then. This avoids briefly emitting a fragment that would
 * then need to be amended.
 */
export function extractStringField(buf: string, field: string): string | undefined {
  const needle = `"${field}"`;
  let i = 0;
  while (i < buf.length) {
    const idx = buf.indexOf(needle, i);
    if (idx < 0) return undefined;
    // Reject matches that fall inside another string by counting unescaped
    // quotes from the start of the buffer to this position.
    if (insideString(buf, idx)) {
      i = idx + needle.length;
      continue;
    }
    // Past the key, look for ':' then opening '"'.
    let j = idx + needle.length;
    while (j < buf.length && (buf[j] === " " || buf[j] === "\t")) j++;
    if (j >= buf.length) return undefined;
    if (buf[j] !== ":") {
      i = idx + needle.length;
      continue;
    }
    j++;
    while (j < buf.length && (buf[j] === " " || buf[j] === "\t")) j++;
    if (j >= buf.length) return undefined;
    if (buf[j] !== '"') return undefined;
    j++; // past opening quote
    return readJsonString(buf, j);
  }
  return undefined;
}

function insideString(buf: string, pos: number): boolean {
  // Walk from start, toggle in/out on unescaped quotes.
  let inStr = false;
  let k = 0;
  while (k < pos) {
    const c = buf[k];
    if (c === "\\") {
      k += 2;
      continue;
    }
    if (c === '"') inStr = !inStr;
    k++;
  }
  return inStr;
}

function readJsonString(buf: string, start: number): string {
  let out = "";
  let k = start;
  while (k < buf.length) {
    const c = buf[k];
    if (c === '"') return out;
    if (c === "\\") {
      // Need the next char to decide; if absent, hold back.
      if (k + 1 >= buf.length) return out;
      const esc = buf[k + 1];
      switch (esc) {
        case '"':
          out += '"';
          k += 2;
          break;
        case "\\":
          out += "\\";
          k += 2;
          break;
        case "/":
          out += "/";
          k += 2;
          break;
        case "n":
          out += "\n";
          k += 2;
          break;
        case "r":
          out += "\r";
          k += 2;
          break;
        case "t":
          out += "\t";
          k += 2;
          break;
        case "b":
          out += "\b";
          k += 2;
          break;
        case "f":
          out += "\f";
          k += 2;
          break;
        case "u": {
          if (k + 6 > buf.length) return out;
          const hex = buf.slice(k + 2, k + 6);
          if (!/^[0-9a-fA-F]{4}$/.test(hex)) return out;
          out += String.fromCharCode(parseInt(hex, 16));
          k += 6;
          break;
        }
        default:
          out += esc;
          k += 2;
      }
      continue;
    }
    out += c;
    k++;
  }
  return out;
}
