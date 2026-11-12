export function pathMatches(file, pattern) {
  const motif = String(pattern).replace(/\\/g, '/').replace(/\/+$/, '');
  const rel = String(file).replace(/\\/g, '/');
  if (!motif) return false;
  return rel === motif || rel.startsWith(`${motif}/`);
}

export function isKept(file, filter) {
  const disabled = filter?.disabled ?? [];
  const allow = filter?.allow ?? [];
  const hits = [];
  for (const pattern of disabled) {
    if (pathMatches(file, pattern)) hits.push({ pattern, kind: 'disabled' });
  }
  for (const pattern of allow) {
    if (pathMatches(file, pattern)) hits.push({ pattern, kind: 'allow' });
  }
  if (hits.length === 0) return true;
  const best = hits.reduce((max, hit) => Math.max(max, hit.pattern.length), 0);
  const top = hits.filter((hit) => hit.pattern.length === best);
  return top.some((hit) => hit.kind === 'allow');
}

export function matchesOnly(rel, only) {
  if (!only || only.length === 0) return true;
  return only.some((pattern) => pathMatches(rel, pattern));
}
