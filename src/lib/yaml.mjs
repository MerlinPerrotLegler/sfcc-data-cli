function unquote(value) {
  const text = value.trim();
  if ((text.startsWith('"') && text.endsWith('"')) || (text.startsWith("'") && text.endsWith("'"))) {
    return text.slice(1, -1);
  }
  return text;
}

function stripComment(value) {
  let quote = '';
  for (let i = 0; i < value.length; i += 1) {
    const ch = value[i];
    if (quote) {
      if (ch === quote) quote = '';
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      continue;
    }
    if (ch === '#' && (i === 0 || value[i - 1] === ' ')) return value.slice(0, i).trim();
  }
  return value.trim();
}

function parseScalar(raw) {
  const value = unquote(stripComment(raw));
  if (value === 'true') return true;
  if (value === 'false') return false;
  if (value === 'null' || value === '~') return null;
  if (/^-?\d+$/.test(value)) return Number(value);
  return value;
}

function nextContent(lines, index) {
  for (let i = index + 1; i < lines.length; i += 1) {
    if (lines[i].trim() && !lines[i].trim().startsWith('#')) return lines[i];
  }
  return '';
}

export function parseYaml(text) {
  const root = {};
  const stack = [{ indent: -1, container: root }];
  const lines = String(text).replace(/^\uFEFF/, '').split(/\r?\n/);
  for (let i = 0; i < lines.length; i += 1) {
    const raw = lines[i];
    if (!raw.trim() || raw.trim().startsWith('#')) continue;
    const indent = raw.match(/^ */)[0].length;
    const line = raw.trim();
    while (stack.length > 1 && indent <= stack[stack.length - 1].indent) stack.pop();
    const parent = stack[stack.length - 1].container;
    if (line.startsWith('- ')) {
      if (!Array.isArray(parent)) {
        throw new Error(`YAML : entrée de liste hors séquence (${line})`);
      }
      parent.push(parseScalar(line.slice(2)));
      continue;
    }
    const match = line.match(/^(.+?):\s*(.*)$/);
    if (!match || Array.isArray(parent)) {
      throw new Error(`YAML : ligne illisible (${line})`);
    }
    const key = unquote(match[1].trim());
    const rest = stripComment(match[2]);
    if (rest === '[]') {
      parent[key] = [];
      stack.push({ indent, container: parent[key] });
      continue;
    }
    if (rest === '{}') {
      parent[key] = {};
      stack.push({ indent, container: parent[key] });
      continue;
    }
    if (rest === '') {
      const upcomingRaw = nextContent(lines, i);
      const upcomingIndent = upcomingRaw ? upcomingRaw.match(/^ */)[0].length : -1;
      if (!upcomingRaw || upcomingIndent <= indent) {
        parent[key] = '';
        continue;
      }
      const child = upcomingRaw.trim().startsWith('- ') ? [] : {};
      parent[key] = child;
      stack.push({ indent, container: child });
      continue;
    }
    parent[key] = parseScalar(rest);
  }
  return root;
}

function yamlKey(key) {
  const text = String(key);
  if (/^[\p{L}\p{N}_./-]+$/u.test(text)) return text;
  return `"${text.replace(/"/g, '')}"`;
}

function findHeader(lines, header) {
  const wanted = header.trim();
  for (let i = 0; i < lines.length; i += 1) {
    const trimmed = lines[i].trim();
    if (trimmed.startsWith('#')) continue;
    if (trimmed === wanted) return i;
  }
  return -1;
}

export function appendMapKey(text, header, key, value) {
  const lines = String(text).replace(/\s*$/, '').split('\n');
  const index = findHeader(lines, header);
  if (index < 0) {
    throw new Error(`YAML : section introuvable (${header})`);
  }
  const headerIndent = lines[index].match(/^ */)[0].length;
  let insertAt = index + 1;
  for (let i = index + 1; i < lines.length; i += 1) {
    const line = lines[i];
    if (!line.trim()) {
      insertAt = i + 1;
      continue;
    }
    const indent = line.match(/^ */)[0].length;
    if (line.trim().startsWith('#') && indent <= headerIndent) break;
    if (indent <= headerIndent) break;
    insertAt = i + 1;
  }
  const sample = lines.slice(index + 1, insertAt).find((line) => line.trim() && !line.trim().startsWith('#'));
  const childIndent = sample ? sample.match(/^ */)[0].length : headerIndent + 2;
  lines.splice(insertAt, 0, `${' '.repeat(childIndent)}${yamlKey(key)}: ${value}`);
  return `${lines.join('\n')}\n`;
}

export function ensureOrderBlock(text) {
  if (/^order:\s*\{\}\s*$/m.test(text)) {
    return text.replace(/^order:\s*\{\}\s*$/m, 'order:');
  }
  if (!/^order:\s*$/m.test(text)) {
    return `${text.replace(/\s*$/, '')}\norder:\n`;
  }
  return text;
}
