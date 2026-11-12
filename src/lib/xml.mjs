import { DOMParser } from '@xmldom/xmldom';

const ELEMENT = 1;
const TEXT = 3;
const CDATA = 4;

export function nameOf(el) {
  return el.localName || String(el.nodeName).replace(/^.*:/, '');
}

export function children(el) {
  const out = [];
  if (!el) return out;
  for (let node = el.firstChild; node; node = node.nextSibling) {
    if (node.nodeType === ELEMENT) out.push(node);
  }
  return out;
}

export function attr(el, name) {
  if (!el) return '';
  if (name === 'xml:lang') {
    const ns = el.getAttributeNS?.('http://www.w3.org/XML/1998/namespace', 'lang');
    if (ns) return ns;
    return el.getAttribute('xml:lang') || el.getAttribute('lang') || '';
  }
  const value = el.getAttribute(name);
  return value == null ? '' : value;
}

export function attrs(el) {
  const out = [];
  const list = el.attributes;
  if (!list) return out;
  for (let i = 0; i < list.length; i += 1) {
    const item = list.item(i);
    const name = item.name || item.nodeName;
    if (name === 'xmlns' || name.startsWith('xmlns:')) continue;
    out.push({ name, value: item.value });
  }
  return out;
}

export function childText(el, childName) {
  const child = children(el).find((node) => nameOf(node) === childName);
  return child ? textOf(child) : '';
}

function rawText(el) {
  let raw = '';
  let hasElement = false;
  for (let node = el.firstChild; node; node = node.nextSibling) {
    if (node.nodeType === ELEMENT) hasElement = true;
    if (node.nodeType === TEXT || node.nodeType === CDATA) raw += node.data ?? node.nodeValue ?? '';
  }
  return { raw, hasElement };
}

function normalizeBlock(raw) {
  if (!/^\n/.test(raw) || !/\n[ \t]*$/.test(raw)) return raw;
  const lines = raw.replace(/^\n/, '').replace(/\n[ \t]*$/, '').split('\n');
  const indents = lines.filter((line) => line.trim()).map((line) => line.match(/^[ \t]*/)[0].length);
  if (indents.length === 0) return '';
  const min = Math.min(...indents);
  return lines.map((line) => (line.trim() ? line.slice(min) : '')).join('\n');
}

export function textOf(el) {
  const { raw, hasElement } = rawText(el);
  if (hasElement) return '';
  if (/^\s*$/.test(raw)) return '';
  return normalizeBlock(raw);
}

export function parseXml(source) {
  const text = String(source).replace(/^\uFEFF/, '').trim();
  const errors = [];
  const doc = new DOMParser({
    onError(level, message) {
      if (level === 'fatalError' || level === 'error') errors.push(message);
    },
  }).parseFromString(text, 'text/xml');
  if (errors.length) {
    throw new Error(errors[0]);
  }
  const root = doc.documentElement;
  if (!root || nameOf(root) === 'parsererror') {
    throw new Error('XML illisible');
  }
  return root;
}

export function parseFragment(source) {
  const root = parseXml(`<wrap>${source}</wrap>`);
  return children(root);
}

export function escapeText(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\r/g, '&#13;');
}

export function escapeAttr(value) {
  return escapeText(value).replace(/"/g, '&quot;');
}

function attrString(el) {
  return attrs(el).map((item) => ` ${item.name}="${escapeAttr(item.value)}"`).join('');
}

export function serializeDocument(el) {
  const xmlns = el.getAttribute?.('xmlns') || '';
  const attributes = attrs(el).map((item) => ` ${item.name}="${escapeAttr(item.value)}"`).join('');
  const kids = children(el);
  const open = `<${nameOf(el)}${xmlns ? ` xmlns="${escapeAttr(xmlns)}"` : ''}${attributes}>`;
  if (kids.length === 0 && !textOf(el)) {
    return `<?xml version="1.0" encoding="UTF-8"?>\n<${nameOf(el)}${xmlns ? ` xmlns="${escapeAttr(xmlns)}"` : ''}${attributes}/>\n`;
  }
  const inner = kids.map((kid) => serialize(kid, '    ')).join('\n');
  const text = textOf(el);
  if (!kids.length) {
    return `<?xml version="1.0" encoding="UTF-8"?>\n<${nameOf(el)}${xmlns ? ` xmlns="${escapeAttr(xmlns)}"` : ''}${attributes}>${escapeText(text)}</${nameOf(el)}>\n`;
  }
  return `<?xml version="1.0" encoding="UTF-8"?>\n${open}\n${inner}\n</${nameOf(el)}>\n`;
}

export function serialize(el, indent = '') {
  const tag = nameOf(el);
  const attributes = attrString(el);
  const kids = children(el);
  const text = textOf(el);
  if (kids.length === 0) {
    if (!text) return `${indent}<${tag}${attributes}/>`;
    return `${indent}<${tag}${attributes}>${escapeText(text)}</${tag}>`;
  }
  const inner = kids.map((kid) => serialize(kid, `${indent}    `)).join('\n');
  return `${indent}<${tag}${attributes}>\n${inner}\n${indent}</${tag}>`;
}

export function rootAttrs(el) {
  return attrs(el);
}

export function openTag(tag, xmlns, attributes, selfClose = false) {
  const parts = [`xmlns="${xmlns}"`];
  for (const item of attributes) {
    if (item.name === 'xmlns' || item.name.startsWith('xmlns:')) continue;
    parts.push(`${item.name}="${escapeAttr(item.value)}"`);
  }
  return `<${tag} ${parts.join(' ')}${selfClose ? '/' : ''}>`;
}

export function assertNoPlaceholder(text, rel) {
  if (/^[ \t]*\{[A-Za-z0-9]+\}[ \t]*$/m.test(text)) {
    throw new Error(`${rel} : un fragment contient un placeholder`);
  }
}

export function assertFragmentText(text, rel) {
  const trimmed = text.trimStart();
  const open = trimmed.match(/^<[^>]+>/);
  if (trimmed.startsWith('<?xml') || (open && /\sxmlns(?::[\w.-]+)?=/.test(open[0]))) {
    throw new Error(`${rel} : un fragment ne porte ni déclaration XML ni xmlns`);
  }
  assertNoPlaceholder(text, rel);
}
