import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { getAlias, keyPaths, listAliases, readStore, removeAlias, saveAlias } from '../src/keys.mjs';

test('un alias se relit et le fichier ne contient pas le secret', () => {
  const home = mkdtempSync(path.join(tmpdir(), 'sfcc-keys-'));
  const paths = keyPaths(home);
  const secret = 'ocapi-secret-9f3a7c2e';
  saveAlias({
    alias: 'sbx',
    url: 'https://sbx.example.net',
    host: 'sbx.example.net',
    clientId: 'client-id-9f3a',
    clientSecret: secret,
    staging: false,
    certificate: '',
    passphrase: '',
  }, paths);

  const raw = readFileSync(paths.keys, 'utf8');
  assert.equal(raw.includes(secret), false);
  assert.equal(raw.includes('client-id-9f3a'), false);
  assert.equal(statSync(paths.keys).mode & 0o777, 0o600);
  assert.equal(statSync(paths.salt).mode & 0o777, 0o600);
  assert.equal(getAlias('sbx', paths).clientSecret, secret);
  assert.deepEqual(listAliases(paths).map((alias) => alias.alias), ['sbx']);

  unlinkSync(paths.salt);
  assert.throws(() => readStore(paths), /sfcc-data-salt is missing/);
  rmSync(home, { recursive: true, force: true });
});

test('une autre clé ne relit pas les alias', () => {
  const home = mkdtempSync(path.join(tmpdir(), 'sfcc-keys-'));
  const paths = keyPaths(home);
  saveAlias({
    alias: 'stg',
    url: 'https://stg.example.net',
    host: 'stg.example.net',
    clientId: 'id',
    clientSecret: 'secret',
    staging: true,
    certificate: '/tmp/client.p12',
    passphrase: 'phrase',
  }, paths);
  unlinkSync(paths.salt);
  writeSalt(paths.salt);
  assert.throws(() => getAlias('stg', paths));
  rmSync(home, { recursive: true, force: true });
});

test('retirer un alias laisse les autres', () => {
  const home = mkdtempSync(path.join(tmpdir(), 'sfcc-keys-'));
  const paths = keyPaths(home);
  saveAlias({ alias: 'a', host: 'a.example', clientId: 'a', clientSecret: 'a', staging: false, certificate: '', passphrase: '' }, paths);
  saveAlias({ alias: 'b', host: 'b.example', clientId: 'b', clientSecret: 'b', staging: false, certificate: '', passphrase: '' }, paths);
  removeAlias('a', paths);
  assert.deepEqual(listAliases(paths).map((alias) => alias.alias), ['b']);
  assert.throws(() => removeAlias('a', paths), /Unknown alias/);
  rmSync(home, { recursive: true, force: true });
});

function writeSalt(file) {
  writeFileSync(file, randomBytes(32), { mode: 0o600 });
}
