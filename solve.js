// Fast drop-in for make.fun's csv-reader 1.0.0. Same semantics, chunk-based scanning
// (indexOf instead of per-character string concatenation) for speed. No dependencies.

const COMMA = 'comma', LINE_BREAK = 'line break', END = 'end';

export function run(input) {
  const text = String(input.text);
  const header = input.header === true;
  const errors = [];
  const rows = [];
  let columns = null;
  let width = -1;

  const len = text.length;
  let pos = text.charCodeAt(0) === 0xFEFF ? 1 : 0;
  let line = 1;
  let recordLine = 1;
  let recordRow = null;

  // scan unquoted field from pos; returns {value, ended, added}, advances pos/line
  function readUnquoted(value, startAdded) {
    let added = startAdded;
    let segStart = pos;
    while (pos < len) {
      const cc = text.charCodeAt(pos);
      if (cc === 44) { // ,
        value += text.slice(segStart, pos);
        pos += 1;
        return [value, COMMA, added];
      }
      if (cc === 10) { // \n
        value += text.slice(segStart, pos);
        pos += 1; line += 1;
        return [value, LINE_BREAK, added];
      }
      if (cc === 13) { // \r
        if (text.charCodeAt(pos + 1) === 10) {
          value += text.slice(segStart, pos);
          pos += 2; line += 1; return [value, LINE_BREAK, added];
        }
        value += text.slice(segStart, pos);
        errors.push({ code: 'stray_cr', line: recordLine, row: recordRow });
        pos += 1;
        segStart = pos;
        continue;
      }
      pos += 1; added += 1;
    }
    value += text.slice(segStart, pos);
    return [value, END, added];
  }

  function readQuoted() {
    const open = pos;
    const openLine = line;
    let value = '';
    let segStart = pos + 1;
    pos += 1;
    let closed = false;
    while (pos < len) {
      const cc = text.charCodeAt(pos);
      if (cc === 34) { // "
        value += text.slice(segStart, pos);
        if (text.charCodeAt(pos + 1) === 34) { value += '"'; pos += 2; segStart = pos; continue; }
        pos += 1; closed = true; break;
      }
      if (cc === 13) { // \r inside quotes -> LF
        value += text.slice(segStart, pos);
        value += '\n';
        line += 1;
        pos += text.charCodeAt(pos + 1) === 10 ? 2 : 1;
        segStart = pos;
        continue;
      }
      if (cc === 10) line += 1;
      pos += 1;
    }
    if (!closed) {
      value += text.slice(segStart, pos);
      pos = open + 1;
      line = openLine;
      errors.push({ code: 'unterminated_quote', line: recordLine, row: recordRow });
      return readUnquoted('"', 1);
    }
    if (pos >= len) return [value, END, 0];
    const cc = text.charCodeAt(pos);
    if (cc === 44) { pos += 1; return [value, COMMA, 0]; }
    if (cc === 10) { pos += 1; line += 1; return [value, LINE_BREAK, 0]; }
    if (cc === 13 && text.charCodeAt(pos + 1) === 10) { pos += 2; line += 1; return [value, LINE_BREAK, 0]; }
    // junk after closing quote
    const startAdded = 0;
    const junkStart = pos;
    const res = readUnquoted(value, startAdded);
    if (res[2] > 0) errors.push({ code: 'quote_junk', line: recordLine, row: recordRow });
    return res;
  }

  while (true) {
    while (pos < len) {
      const cc = text.charCodeAt(pos);
      if (cc === 10) { pos += 1; line += 1; }
      else if (cc === 13 && text.charCodeAt(pos + 1) === 10) { pos += 2; line += 1; }
      else break;
    }
    if (pos >= len) break;

    recordLine = line;
    recordRow = header && columns === null ? null : rows.length;
    const fields = [];
    let field, quoted;
    do {
      quoted = text.charCodeAt(pos) === 34;
      field = quoted ? readQuoted() : readUnquoted('', 0);
      fields.push(field[0]);
    } while (field[1] === COMMA);

    if (fields.length === 1 && fields[0] === '' && !quoted) continue;

    if (width < 0) width = fields.length;
    if (header && columns === null) { columns = fields; continue; }
    if (fields.length < width) {
      errors.push({ code: 'short_row', line: recordLine, row: recordRow, fields: fields.length });
      while (fields.length < width) fields.push('');
    } else if (fields.length > width) {
      errors.push({ code: 'long_row', line: recordLine, row: recordRow, extra: fields.splice(width) });
    }
    rows.push(fields);
  }
  return { columns: header ? (columns ?? []) : null, rows, errors };
}
