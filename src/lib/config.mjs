import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { parseYaml } from './yaml.mjs';

const bundledSchema = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../dwapp-schema');

function asList(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value.map(String);
  throw new Error('disabled et allow doivent être des listes');
}

export function loadConfig(file) {
  const dir = path.dirname(file);
  const base = parseYaml(readFileSync(file, 'utf8'));
  const disabled = asList(base.disabled);
  const allow = asList(base.allow);
  const env = process.env.DATA_SPLITTER_ENV;
  if (env) {
    const overlayFile = path.join(dir, `data-splitter.${env}.yaml`);
    if (existsSync(overlayFile)) {
      const overlay = parseYaml(readFileSync(overlayFile, 'utf8'));
      disabled.push(...asList(overlay.disabled));
      allow.push(...asList(overlay.allow));
    }
  }
  if (!base.ranks) throw new Error(`${file} : ranks est obligatoire`);
  return {
    file,
    dir,
    schemaDir: base.schemaDir ? path.resolve(dir, base.schemaDir) : bundledSchema,
    ranksFile: path.resolve(dir, base.ranks),
    disabled,
    allow,
  };
}
