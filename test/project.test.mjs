import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { buildImportZip, splitIntoProject } from '../src/project.mjs';
import { hostnameOf } from '../src/sfcc.mjs';
import { loadProjectConfig, testCaseDir } from '../src/project-config.mjs';

const bin = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../bin/sfcc-data.mjs');

function write(root, rel, body) {
  const abs = path.join(root, rel);
  mkdirSync(path.dirname(abs), { recursive: true });
  writeFileSync(abs, body);
}

function projectFixture() {
  const root = mkdtempSync(path.join(tmpdir(), 'sfcc-project-'));
  write(root, 'ecom-data/ranks/v1.yaml', 'width: 3\nsequences: {}\norder: {}\n');
  write(root, 'ecom-data/data-splitter.yaml', 'ranks: ranks/v1.yaml\ndisabled: []\nallow: []\n');
  write(root, 'sfcc-data-config.yaml', [
    'ecom-data-meta: ecom-data/ecom-data-meta',
    'ecom-data-sites: ecom-data/ecom-data-sites',
    'ecom-data-sites-dev: ecom-data/ecom-data-sites-dev',
    'ecom-data-sites-test: ecom-data/ecom-data-sites-test',
    'splitter: ecom-data/data-splitter.yaml',
    '',
  ].join('\n'));
  write(root, 'ecom-data/ecom-data-meta/meta/keep.xml', '<keep/>\n');
  write(root, 'ecom-data/ecom-data-sites-dev/sites/old.xml', '<old/>\n');
  write(root, 'ecom-data/ecom-data-sites-test/hse/customers.xml', '<customers/>\n');
  return root;
}

test('la config résout les quatre chemins depuis le fichier', () => {
  const root = projectFixture();
  const config = loadProjectConfig(path.join(root, 'ecom-data'));
  assert.equal(config.meta, path.join(root, 'ecom-data/ecom-data-meta'));
  assert.equal(config.sitesTest, path.join(root, 'ecom-data/ecom-data-sites-test'));
  assert.equal(config.splitter, path.join(root, 'ecom-data/data-splitter.yaml'));
  assert.equal(testCaseDir(config, 'test/hse'), path.join(root, 'ecom-data/ecom-data-sites-test/hse'));
  assert.throws(() => testCaseDir(config, 'test/../hse'), /no slash/);
  rmSync(root, { recursive: true, force: true });
});

test('hostnameOf garde l\'hôte', () => {
  assert.equal(hostnameOf('zzxx-001.dx.commercecloud.salesforce.com'), 'zzxx-001.dx.commercecloud.salesforce.com');
  assert.equal(hostnameOf('https://zzxx-001.dx.commercecloud.salesforce.com/on/demandware.store/Sites-Site'), 'zzxx-001.dx.commercecloud.salesforce.com');
});

test('split range le zip dans le projet et merge zippe un cas tel quel', () => {
  const root = projectFixture();
  const config = loadProjectConfig(root);
  const src = path.join(root, 'export');
  write(src, 'version.txt', '21.6.2\n');
  write(src, 'schedules.xml', '<schedules/>\n');
  const zip = path.join(root, 'site-import.zip');
  execFileSync('zip', ['-qr', zip, 'version.txt', 'schedules.xml'], { cwd: src });

  splitIntoProject(zip, { config });

  assert.equal(readFileSync(path.join(config.sitesDev, 'schedules.xml'), 'utf8'), '<schedules/>\n');
  assert.equal(existsSync(path.join(config.sitesDev, 'sites/old.xml')), false);
  assert.equal(readFileSync(path.join(config.meta, 'meta/keep.xml'), 'utf8'), '<keep/>\n');
  assert.equal(existsSync(config.sites), true);

  const merged = buildImportZip(path.join(root, 'hse.zip'), { from: 'test/hse', config });
  const unpacked = path.join(root, 'unpacked');
  execFileSync('unzip', ['-q', merged, '-d', unpacked]);
  assert.equal(readFileSync(path.join(unpacked, 'customers.xml'), 'utf8'), '<customers/>\n');
  rmSync(root, { recursive: true, force: true });
});

test('split --input écrit l\'arbre brut et le positionnel range le projet', () => {
  const root = projectFixture();
  const src = path.join(root, 'export');
  write(src, 'version.txt', '21.6.2\n');
  write(src, 'schedules.xml', '<schedules/>\n');
  const zip = path.join(root, 'site-import.zip');
  execFileSync('zip', ['-qr', zip, 'version.txt', 'schedules.xml'], { cwd: src });
  const out = path.join(root, 'brut');

  const raw = spawnSync(process.execPath, [
    bin, 'split', '--input', src, '--out', out, '--config', path.join(root, 'ecom-data/data-splitter.yaml'),
  ], { cwd: root, encoding: 'utf8' });
  assert.equal(raw.status, 0, raw.stderr);
  assert.equal(readFileSync(path.join(out, 'ecom-data-sites/schedules.xml'), 'utf8'), '<schedules/>\n');
  assert.equal(readFileSync(path.join(root, 'ecom-data/ecom-data-sites-dev/sites/old.xml'), 'utf8'), '<old/>\n');

  const placed = spawnSync(process.execPath, [bin, 'split', zip], { cwd: root, encoding: 'utf8' });
  assert.equal(placed.status, 0, placed.stderr);
  assert.equal(readFileSync(path.join(root, 'ecom-data/ecom-data-sites-dev/schedules.xml'), 'utf8'), '<schedules/>\n');
  rmSync(root, { recursive: true, force: true });
});

test('un export STG va en entier dans ecom-data-sites', () => {
  const root = projectFixture();
  const config = loadProjectConfig(root);
  const src = path.join(root, 'export');
  write(src, 'version.txt', '21.6.2\n');
  write(src, 'schedules.xml', '<schedules/>\n');
  const zip = path.join(root, 'STG-full.zip');
  execFileSync('zip', ['-qr', zip, 'version.txt', 'schedules.xml'], { cwd: src });

  splitIntoProject(zip, { config, folder: 'ecom-data-sites' });

  assert.equal(readFileSync(path.join(config.sites, 'schedules.xml'), 'utf8'), '<schedules/>\n');
  assert.equal(readFileSync(path.join(config.sitesDev, 'sites/old.xml'), 'utf8'), '<old/>\n');
  assert.equal(existsSync(path.join(config.sitesDev, 'schedules.xml')), false);
  rmSync(root, { recursive: true, force: true });
});

test('ocapi enregistre l\'alias sans URL ni certificat et n\'affiche pas le secret', () => {
  const home = mkdtempSync(path.join(tmpdir(), 'sfcc-ocapi-'));
  const env = { ...process.env, SFCC_DATA_HOME: home };
  const saved = spawnSync(process.execPath, [
    bin, 'ocapi', 'add',
    '--alias', 'sbx',
    '--ocapi-key', 'client-id-9f3a',
    '--ocapi-pass', 'ocapi-secret-9f3a7c2e',
  ], { encoding: 'utf8', env });
  assert.equal(saved.status, 0, saved.stderr);
  assert.equal(saved.stdout.includes('ocapi-secret-9f3a7c2e'), false);

  const listed = spawnSync(process.execPath, [bin, 'ocapi', 'list'], { encoding: 'utf8', env });
  assert.equal(listed.status, 0, listed.stderr);
  assert.match(listed.stdout, /^sbx\n/);
  assert.equal(listed.stdout.includes('ocapi-secret-9f3a7c2e'), false);

  const removed = spawnSync(process.execPath, [bin, 'ocapi', 'rm', 'sbx'], { encoding: 'utf8', env });
  assert.equal(removed.status, 0, removed.stderr);
  const after = spawnSync(process.execPath, [bin, 'ocapi', 'list'], { encoding: 'utf8', env });
  assert.match(after.stdout, /No alias/);
  rmSync(home, { recursive: true, force: true });
});
