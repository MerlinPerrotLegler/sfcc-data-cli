const SAFE = /[^\p{L}\p{N}_-]+/gu;

export function sanitize(value) {
  const cleaned = String(value ?? '').normalize('NFC')
    .replace(SAFE, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '');
  if (cleaned) return cleaned;
  const raw = String(value ?? '');
  if (!raw) return 'empty';
  return [...raw].map((ch) => `u${ch.codePointAt(0).toString(16)}`).join('-');
}

export function joinId(parts) {
  return parts.filter((part) => part != null && part !== '').map((part) => sanitize(part)).join('__');
}

export function pad(value, width) {
  const text = String(value);
  return text.length >= width ? text : text.padStart(width, '0');
}

export function compareNames(a, b) {
  return a.localeCompare(b, 'fr', { numeric: true, sensitivity: 'variant' });
}

export function orderWidth(value) {
  const digits = String(value).length;
  return Math.max(2, digits);
}
