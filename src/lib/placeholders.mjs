export function fillPlaceholders(wrapper, values) {
  let xml = String(wrapper).replace(/^\uFEFF/, '');
  for (const [key, value] of Object.entries(values)) {
    const pattern = new RegExp(`^([ \\t]*)\\{${key}\\}[ \\t]*$`, 'm');
    if (!pattern.test(xml)) {
      if (value) throw new Error(`Placeholder {${key}} absent du wrapper`);
      continue;
    }
    xml = xml.replace(pattern, (_match, indent) => {
      if (!value) return '';
      return String(value)
        .replace(/\n$/, '')
        .split('\n')
        .map((line) => (line ? indent + line : line))
        .join('\n');
    });
  }
  if (/^[ \t]*\{[A-Za-z0-9]+\}[ \t]*$/m.test(xml)) {
    throw new Error('Placeholder restant dans le wrapper');
  }
  return dropEmptyElements(xml);
}

function dropEmptyElements(xml) {
  const pattern = /^[ \t]+<([A-Za-z0-9._-]+)(\s[^/>]*)?>\s*<\/\1>[ \t]*\r?\n?/gm;
  let current = xml;
  let previous;
  do {
    previous = current;
    current = current.replace(pattern, '');
  } while (current !== previous);
  return current.endsWith('\n') ? current : `${current}\n`;
}
