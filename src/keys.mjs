import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
} from 'node:crypto';

const KEY_BYTES = 32;

export function keyPaths(home = process.env.SFCC_DATA_HOME || homedir()) {
  return {
    home,
    salt: path.join(home, '.sfcc-data-salt'),
    keys: path.join(home, '.sfcc-data-keys'),
  };
}

export function ensureMachineKey(paths = keyPaths()) {
  mkdirSync(paths.home, { recursive: true });
  if (!existsSync(paths.salt)) {
    writeFileSync(paths.salt, randomBytes(KEY_BYTES), { mode: 0o600 });
  }
  chmodSync(paths.salt, 0o600);
  const key = readFileSync(paths.salt);
  if (key.length < KEY_BYTES) {
    throw new Error(`${paths.salt} is too short. Do not replace it: aliases already saved would become unreadable.`);
  }
  return key.subarray(0, KEY_BYTES);
}

function seal(payload, key) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const data = Buffer.concat([cipher.update(JSON.stringify(payload), 'utf8'), cipher.final()]);
  return {
    v: 1,
    iv: iv.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
    data: data.toString('base64'),
  };
}

function open(envelope, key) {
  if (!envelope || envelope.v !== 1) throw new Error('Unknown ~/.sfcc-data-keys format');
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(envelope.iv, 'base64'));
  decipher.setAuthTag(Buffer.from(envelope.tag, 'base64'));
  const json = Buffer.concat([
    decipher.update(Buffer.from(envelope.data, 'base64')),
    decipher.final(),
  ]).toString('utf8');
  return JSON.parse(json);
}

export function readStore(paths = keyPaths()) {
  if (!existsSync(paths.salt)) {
    if (existsSync(paths.keys)) {
      throw new Error(`~/.sfcc-data-salt is missing. Aliases in ${paths.keys} cannot be read.`);
    }
    return { aliases: {} };
  }
  if (!existsSync(paths.keys)) return { aliases: {} };
  const store = open(JSON.parse(readFileSync(paths.keys, 'utf8')), ensureMachineKey(paths));
  if (!store.aliases || typeof store.aliases !== 'object') return { aliases: {} };
  return store;
}

export function writeStore(store, paths = keyPaths()) {
  const key = ensureMachineKey(paths);
  writeFileSync(paths.keys, `${JSON.stringify(seal(store, key))}\n`, { mode: 0o600 });
  chmodSync(paths.keys, 0o600);
}

export function saveAlias(alias, paths = keyPaths()) {
  const store = readStore(paths);
  store.aliases[alias.alias] = alias;
  writeStore(store, paths);
}

export function getAlias(name, paths = keyPaths()) {
  const alias = readStore(paths).aliases[name];
  if (!alias) throw new Error(`Unknown alias: ${name}. Save it with sfcc-data ocapi add.`);
  return alias;
}

export function listAliases(paths = keyPaths()) {
  return Object.values(readStore(paths).aliases)
    .sort((a, b) => a.alias.localeCompare(b.alias, 'en'));
}

export function removeAlias(name, paths = keyPaths()) {
  const store = readStore(paths);
  if (!store.aliases[name]) throw new Error(`Unknown alias: ${name}`);
  delete store.aliases[name];
  writeStore(store, paths);
}
