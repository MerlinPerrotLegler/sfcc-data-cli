import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  ensureGitignore,
  mergedInstances,
  missingFields,
  readInstances,
  setField,
  sitesFolderForDownload,
  writeInstances,
} from '../src/instances.mjs';
import { exportFilePrefix, exportJobXml, exportUnits } from '../src/job.mjs';
import { parseYaml } from '../src/lib/yaml.mjs';
import { newestDownloadFile, parseWebdavListing } from '../src/sfcc.mjs';

const SAMPLE = `instances:
  all:
    webdav:
      username: merlin@example.net
    ocapi-alias: sfcc-data
  stg:
    hostname: staging.example.net
    download-file-pattern: "STG-full-no-static-*.zip"
    ocapi:
    webdav:
      password: "p|a*ss"
      p12: ./deploy/p12/staging.p12
  dev:
    hostname:
    webdav:
      password:
`;

test('all is the default and an empty key does not swallow the next one', () => {
  const parsed = parseYaml(SAMPLE);
  assert.equal(parsed.instances.stg.ocapi, '');
  assert.equal(parsed.instances.stg.webdav.password, 'p|a*ss');
  const { instances } = mergedInstances(parsed);
  assert.equal(instances.stg.webdav.username, 'merlin@example.net');
  assert.equal(instances.stg['ocapi-alias'], 'sfcc-data');
  assert.equal(instances.dev.webdav.username, 'merlin@example.net');
  assert.deepEqual(missingFields(parsed), ['dev.hostname', 'dev.webdav.password']);
});

test('init adds the instances file to gitignore once', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'sfcc-instances-'));
  writeFileSync(path.join(root, '.gitignore'), 'dw.json\n.env\n');
  assert.equal(ensureGitignore(root).added, true);
  assert.equal(ensureGitignore(root).added, false);
  const lines = readFileSync(path.join(root, '.gitignore'), 'utf8').split('\n');
  assert.equal(lines.filter((line) => line === '.sfcc-data-instances.yaml').length, 1);
  assert.equal(lines[1], '.sfcc-data-instances.yaml');
  rmSync(root, { recursive: true, force: true });
});

test('a filled field is written back without dropping the default', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'sfcc-instances-'));
  writeFileSync(path.join(root, '.sfcc-data-instances.yaml'), SAMPLE);
  const raw = readInstances(root);
  setField(raw, 'dev.hostname', 'dev.example.net');
  setField(raw, 'dev.webdav.password', 'secret value');
  writeInstances(root, raw);
  const again = readInstances(root);
  assert.equal(again.instances.all['ocapi-alias'], 'sfcc-data');
  assert.equal(again.instances.dev.webdav.password, 'secret value');
  assert.deepEqual(missingFields(again), []);
  rmSync(root, { recursive: true, force: true });
});

test('the export job omits static files when the pattern says so', () => {
  const { instances } = mergedInstances(parseYaml(SAMPLE));
  assert.equal(exportFilePrefix(instances.stg), 'STG-full-no-static');
  assert.equal(exportUnits(instances.stg).global_data.static_resources, undefined);
  const xml = exportJobXml(instances.stg);
  assert.match(xml, /type="SiteExport"/);
  assert.match(xml, /<parameter name="ExportFile">STG-full-no-static<\/parameter>/);
  assert.doesNotMatch(xml, /static_resources/);
});

test('STG et PRD vont dans all.folder, un export DEV non', () => {
  const reference = { id: 'stg', folder: 'ecom-data-sites' };
  assert.equal(sitesFolderForDownload(reference, 'STG-Full-no-static-20261109.zip'), 'ecom-data-sites');
  assert.equal(sitesFolderForDownload({ id: 'prd', folder: 'ecom-data-sites' }, 'nightly.zip'), 'ecom-data-sites');
  assert.equal(sitesFolderForDownload({ id: 'prod' }, 'PRD-full.zip'), 'ecom-data-sites');
  assert.equal(sitesFolderForDownload({ id: 'dev', folder: 'ecom-data-sites' }, 'DEV-full.zip'), '');
  assert.equal(sitesFolderForDownload({ id: 'sb01', folder: 'ecom-data-sites' }, 'sandbox.zip'), '');
});

test('download picks the newest WebDAV file matching the pattern', () => {
  const entries = parseWebdavListing(`<?xml version="1.0" encoding="utf-8" ?>
<multistatus xmlns="DAV:"><response><href>/instance/</href>
<propstat><prop><getlastmodified>Tue, 10 Nov 2026 13:55:40 GMT</getlastmodified>
<displayname>instance</displayname><resourcetype><collection/></resourcetype></prop></propstat></response>
<response><href>/instance/STG-Full-no-static-20261108200003.zip</href>
<propstat><prop><getlastmodified>Sun, 08 Nov 2026 20:03:50 GMT</getlastmodified>
<displayname>STG-Full-no-static-20261108200003.zip</displayname></prop></propstat></response>
<response><href>/instance/STG-Full-no-static-20261109200003.zip</href>
<propstat><prop><getlastmodified>Mon, 09 Nov 2026 20:02:48 GMT</getlastmodified>
<displayname>STG-Full-no-static-20261109200003.zip</displayname></prop></propstat></response>
<response><href>/instance/STG-FULL-2026-11-11-10h00.zip</href>
<propstat><prop><getlastmodified>Tue, 10 Nov 2026 09:03:24 GMT</getlastmodified>
<displayname>STG-FULL-2026-11-11-10h00.zip</displayname></prop></propstat></response>
</multistatus>`);
  const picked = newestDownloadFile(entries, 'STG-full-no-static-*.zip');
  assert.equal(picked.name, 'STG-Full-no-static-20261109200003.zip');
});
