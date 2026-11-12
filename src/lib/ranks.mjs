import { readFileSync, writeFileSync } from 'node:fs';

import { appendMapKey, ensureOrderBlock, parseYaml } from './yaml.mjs';

export function loadRanks(file) {
  const text = readFileSync(file, 'utf8');
  const data = parseYaml(text);
  data.sequences = data.sequences ?? {};
  data.order = data.order ?? {};
  data.width = data.width ?? 3;
  return { file, text, data, added: [] };
}

function maxValue(map) {
  const values = Object.values(map ?? {});
  return values.length ? Math.max(...values) : 0;
}

export function typeRank(ranks, sequence, id, update) {
  const table = ranks.data.sequences[sequence] ?? {};
  ranks.data.sequences[sequence] = table;
  if (Object.prototype.hasOwnProperty.call(table, id)) return table[id];
  if (!update) {
    throw new Error(`Rang inconnu pour ${sequence}/${id}. Relancer avec --update-ranks.`);
  }
  const value = maxValue(table) + 1;
  table[id] = value;
  ranks.added.push(`${sequence}.${id}: ${value}`);
  ranks.text = appendMapKey(ranks.text, `${sequence}:`, id, value);
  return value;
}

export function orderRank(ranks, key, position, update) {
  const table = ranks.data.order ?? {};
  ranks.data.order = table;
  if (Object.prototype.hasOwnProperty.call(table, key)) return table[key];
  if (!update) {
    throw new Error(`Ordre inconnu pour ${key}. Relancer avec --update-ranks.`);
  }
  const section = key.slice(0, key.lastIndexOf('/'));
  const used = new Set(
    Object.entries(table)
      .filter(([name]) => name.startsWith(`${section}/`))
      .map(([, value]) => value),
  );
  let value = position;
  if (used.has(value)) value = (used.size ? Math.max(...used) : 0) + 1;
  table[key] = value;
  ranks.added.push(`order ${key}: ${value}`);
  ranks.text = ensureOrderBlock(ranks.text);
  ranks.text = appendMapKey(ranks.text, 'order:', key, value);
  return value;
}

export function saveRanks(ranks) {
  if (!ranks.added.length) return;
  writeFileSync(ranks.file, ranks.text.endsWith('\n') ? ranks.text : `${ranks.text}\n`);
}
