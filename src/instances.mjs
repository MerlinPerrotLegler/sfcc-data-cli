import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { envFromExportName } from './apply-site-export.mjs';
import { getAlias } from './keys.mjs';
import { parseYaml } from './lib/yaml.mjs';

export const INSTANCES_FILE = '.sfcc-data-instances.yaml';
const DEFAULT_KEY = 'all';

export const INSTANCES_TEMPLATE = `# Local only. sfcc-data init keeps this name out of git.
# \`all\` is the default. An instance overrides only the keys it sets.
instances:
  all:
    webdav:
      username:
    ocapi-alias:
    folder:
  stg:
    hostname:
    download-file-pattern:
    webdav:
      password:
      p12:
  dev:
    hostname:
    webdav:
      password:
  sb01:
    hostname:
    webdav:
      password:
  sb02:
    hostname:
    webdav:
      password:
  sb03:
    hostname:
    webdav:
      password:
  sb04:
    hostname:
    webdav:
      password:
`;

function isBlank(value) {
  return value == null
    || value === ''
    || (typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === 0);
}

function merge(base, over) {
  const out = { ...(base || {}) };
  for (const [key, value] of Object.entries(over || {})) {
    if (isBlank(value)) continue;
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      out[key] = merge(out[key], value);
    } else {
      out[key] = value;
    }
  }
  return out;
}

export function instancesPath(root) {
  return path.join(root, INSTANCES_FILE);
}

export function readInstances(root) {
  const file = instancesPath(root);
  if (!existsSync(file)) {
    throw new Error(`${INSTANCES_FILE} was not found. Run sfcc-data init.`);
  }
  const raw = parseYaml(readFileSync(file, 'utf8'));
  if (!raw.instances || typeof raw.instances !== 'object') {
    throw new Error(`${INSTANCES_FILE} has no instances map.`);
  }
  return raw;
}

export function mergedInstances(raw) {
  const bag = raw.instances;
  const defaults = bag[DEFAULT_KEY] || {};
  const instances = {};
  for (const [name, value] of Object.entries(bag)) {
    if (name === DEFAULT_KEY) continue;
    instances[name] = merge(defaults, value);
    instances[name].id = name;
  }
  return { defaults, instances };
}

export function missingFields(raw) {
  const bag = raw.instances || {};
  const defaults = bag[DEFAULT_KEY] || {};
  const missing = [];
  if (isBlank(defaults.webdav?.username)) missing.push('all.webdav.username');
  if (isBlank(defaults['ocapi-alias'])) missing.push('all.ocapi-alias');
  for (const [name, value] of Object.entries(bag)) {
    if (name === DEFAULT_KEY) continue;
    const merged = merge(defaults, value);
    if (isBlank(merged.hostname)) missing.push(`${name}.hostname`);
    if (isBlank(merged.webdav?.password)) missing.push(`${name}.webdav.password`);
    if (Object.prototype.hasOwnProperty.call(value?.webdav || {}, 'p12') && isBlank(merged.webdav?.p12)) {
      missing.push(`${name}.webdav.p12`);
    }
  }
  return missing;
}

function quote(value) {
  const text = String(value);
  if (text.includes('\n') || text.includes('"') || text.includes("'")) {
    throw new Error('A value cannot contain quotes or line breaks.');
  }
  if (/^[\w@./:+-]+$/.test(text)) return text;
  return `"${text}"`;
}

function writeBlock(lines, value, indent) {
  const pad = ' '.repeat(indent);
  for (const [key, item] of Object.entries(value)) {
    if (item && typeof item === 'object' && !Array.isArray(item)) {
      lines.push(`${pad}${key}:`);
      writeBlock(lines, item, indent + 2);
    } else {
      lines.push(`${pad}${key}: ${isBlank(item) ? '' : quote(item)}`);
    }
  }
}

export function writeInstances(root, raw) {
  const lines = [
    '# Local only. sfcc-data init keeps this name out of git.',
    '# `all` is the default. An instance overrides only the keys it sets.',
  ];
  writeBlock(lines, { instances: raw.instances }, 0);
  writeFileSync(instancesPath(root), `${lines.join('\n')}\n`);
}

export function setField(raw, field, value) {
  const parts = field.split('.');
  let cursor = raw.instances;
  for (let i = 0; i < parts.length - 1; i += 1) {
    if (!cursor[parts[i]] || typeof cursor[parts[i]] !== 'object') cursor[parts[i]] = {};
    cursor = cursor[parts[i]];
  }
  cursor[parts[parts.length - 1]] = value;
}

export function ensureGitignore(root, { check = false } = {}) {
  const file = path.join(root, '.gitignore');
  const present = existsSync(file) && readFileSync(file, 'utf8').split(/\r?\n/).some((line) => line.trim() === INSTANCES_FILE);
  if (present || check) return { file, present, added: false };
  const text = existsSync(file) ? readFileSync(file, 'utf8') : '';
  const lines = text ? text.split(/\r?\n/) : [];
  const dw = lines.findIndex((line) => line.trim() === 'dw.json');
  lines.splice(dw >= 0 ? dw + 1 : lines.length, 0, INSTANCES_FILE);
  writeFileSync(file, `${lines.join('\n').replace(/\n*$/, '\n')}`);
  return { file, present: true, added: true };
}

export function ensureInstancesFile(root, { check = false } = {}) {
  const file = instancesPath(root);
  if (existsSync(file) || check) return { file, created: false };
  writeFileSync(file, INSTANCES_TEMPLATE);
  return { file, created: true };
}

const REFERENCE_INSTANCE = {
  stg: 'staging',
  staging: 'staging',
  prd: 'production',
  prod: 'production',
  production: 'production',
};

export function sitesFolderForDownload(instance, fileName = '') {
  const env = envFromExportName(fileName) || REFERENCE_INSTANCE[String(instance?.id || '').toLowerCase()];
  if (env !== 'staging' && env !== 'production') return '';
  return isBlank(instance?.folder) ? 'ecom-data-sites' : String(instance.folder);
}

export function linkInstance(root, name) {
  const raw = readInstances(root);
  const { instances } = mergedInstances(raw);
  const instance = instances[name];
  if (!instance) {
    const known = Object.keys(instances).join(', ') || '(none)';
    throw new Error(`Unknown instance: ${name}. Instances: ${known}`);
  }
  const missing = [`hostname`, `webdav.password`, `ocapi-alias`].filter((field) => {
    if (field === 'hostname') return isBlank(instance.hostname);
    if (field === 'ocapi-alias') return isBlank(instance['ocapi-alias']);
    return isBlank(instance.webdav?.password);
  });
  if (missing.length) {
    throw new Error(`${name} is incomplete (${missing.join(', ')}). Run sfcc-data init.`);
  }
  const alias = getAlias(instance['ocapi-alias']);
  const p12 = instance.webdav?.p12 ? path.resolve(root, instance.webdav.p12) : '';
  if (!instance.webdav?.username) {
    throw new Error(`${name} has no WebDAV username. Set all.webdav.username.`);
  }
  return {
    instance,
    connection: {
      alias: alias.alias,
      host: instance.hostname,
      clientId: alias.clientId,
      clientSecret: alias.clientSecret,
      staging: Boolean(p12),
      certificate: p12,
      passphrase: instance.webdav?.passphrase || '',
      webdavUser: instance.webdav.username,
      webdavPassword: instance.webdav.password,
    },
  };
}
