import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  applyExport,
  envFromExportName,
  scopeOuterXml,
} from '../src/apply-site-export.mjs';

function preferences({ shared, dev, stg, prod }) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<preferences xmlns="http://www.demandware.com/xml/impex/preferences/2007-03-31">
    <standard-preferences>
        <all-instances>
            <preference preference-id="shared">${shared}</preference>
        </all-instances>
        <development>
            <preference preference-id="only-dev">${dev}</preference>
        </development>
        <staging>
            <preference preference-id="only-stg">${stg}</preference>
        </staging>
        <production>
            <preference preference-id="only-prod">${prod}</preference>
        </production>
    </standard-preferences>
    <custom-preferences>
        <all-instances/>
        <development/>
        <staging/>
        <production/>
    </custom-preferences>
</preferences>
`;
}

function writeTree(root, files) {
  for (const [rel, body] of Object.entries(files)) {
    const abs = path.join(root, rel);
    mkdirSync(path.dirname(abs), { recursive: true });
    writeFileSync(abs, body);
  }
}

function setup() {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'site-export-'));
  const dataRoot = path.join(dir, 'data');
  const exportRoot = path.join(dir, 'export');
  writeTree(dataRoot, {
    'ecom-data-sites/sites/Bolle_EU/preferences.xml': preferences({
      shared: 'repo-shared',
      dev: 'repo-dev',
      stg: 'repo-stg',
      prod: 'repo-prod',
    }),
    'ecom-data-sites/sites/Bolle_EU/site.xml': `<?xml version="1.0" encoding="UTF-8"?>
<site site-id="Bolle_EU">
    <name>Ancien</name>
</site>
`,
    'ecom-data-sites/jobs.xml': `<?xml version="1.0" encoding="UTF-8"?>
<jobs xmlns="http://www.demandware.com/xml/impex/jobs/2015-07-01">
    <job job-id="keep">
        <description>repo</description>
    </job>
    <job job-id="update">
        <description>old</description>
    </job>
</jobs>
`,
    'ecom-data-meta/meta/system-objecttype-extensions.xml': `<?xml version="1.0" encoding="UTF-8"?>
<metadata>
    <type-extension type-id="Profile">
        <description>repo</description>
    </type-extension>
</metadata>
`,
    'ecom-data-sites/untouched.xml': '<root>stay</root>\n',
  });
  return { dir, dataRoot, exportRoot };
}

test('le préfixe du nom choisit la portée', () => {
  assert.equal(envFromExportName('STG-bolle.zip'), 'staging');
  assert.equal(envFromExportName('stg_export'), 'staging');
  assert.equal(envFromExportName('PROD-eu.zip'), 'production');
  assert.equal(envFromExportName('PRD'), 'production');
  assert.equal(envFromExportName('DEV-sbx'), 'development');
  assert.equal(envFromExportName('SB-sandbox.zip'), 'development');
  assert.equal(envFromExportName('export-STG.zip'), null);
});

test('replace STG écrase le partagé et staging, et garde development et production', () => {
  const { dir, dataRoot, exportRoot } = setup();
  const prefsPath = path.join(dataRoot, 'ecom-data-sites/sites/Bolle_EU/preferences.xml');
  const before = readFileSync(prefsPath, 'utf8');
  const dev = scopeOuterXml(before, 'preferences/standard-preferences', 'development');
  const prod = scopeOuterXml(before, 'preferences/standard-preferences', 'production');
  writeTree(exportRoot, {
    'sites/Bolle_EU/preferences.xml': preferences({
      shared: 'export-shared',
      dev: 'export-dev',
      stg: 'export-stg',
      prod: 'export-prod',
    }),
    'sites/Bolle_EU/site.xml': `<?xml version="1.0" encoding="UTF-8"?>
<site site-id="Bolle_EU">
    <name>Export</name>
</site>
`,
    'meta/system-objecttype-extensions.xml': `<?xml version="1.0" encoding="UTF-8"?>
<metadata>
    <type-extension type-id="Profile">
        <description>export</description>
    </type-extension>
</metadata>
`,
    'version.txt': '21.9.0\n',
  });
  applyExport({ exportRoot, dataRoot, env: 'staging', mode: 'replace' });
  const after = readFileSync(prefsPath, 'utf8');
  assert.equal(scopeOuterXml(after, 'preferences/standard-preferences', 'development'), dev);
  assert.equal(scopeOuterXml(after, 'preferences/standard-preferences', 'production'), prod);
  assert.match(after, /preference-id="shared">export-shared</);
  assert.match(after, /preference-id="only-stg">export-stg</);
  assert.doesNotMatch(after, /export-dev|export-prod/);
  assert.match(readFileSync(path.join(dataRoot, 'ecom-data-sites/sites/Bolle_EU/site.xml'), 'utf8'), /<name>Export<\/name>/);
  assert.match(readFileSync(path.join(dataRoot, 'ecom-data-meta/meta/system-objecttype-extensions.xml'), 'utf8'), /<description>export<\/description>/);
  assert.equal(readFileSync(path.join(dataRoot, 'ecom-data-meta/version.txt'), 'utf8'), '21.9.0\n');
  assert.equal(readFileSync(path.join(dataRoot, 'ecom-data-sites/version.txt'), 'utf8'), '21.9.0\n');
  assert.equal(readFileSync(path.join(dataRoot, 'ecom-data-sites/untouched.xml'), 'utf8'), '<root>stay</root>\n');
  rmSync(dir, { recursive: true, force: true });
});

test('merge STG met à jour les éléments et conserve ceux absents de l\'export', () => {
  const { dir, dataRoot, exportRoot } = setup();
  const prefsPath = path.join(dataRoot, 'ecom-data-sites/sites/Bolle_EU/preferences.xml');
  const prod = scopeOuterXml(readFileSync(prefsPath, 'utf8'), 'preferences/standard-preferences', 'production');
  writeTree(exportRoot, {
    'sites/Bolle_EU/preferences.xml': `<?xml version="1.0" encoding="UTF-8"?>
<preferences xmlns="http://www.demandware.com/xml/impex/preferences/2007-03-31">
    <standard-preferences>
        <all-instances>
            <preference preference-id="shared">export-shared</preference>
            <preference preference-id="added">oui</preference>
        </all-instances>
        <development>
            <preference preference-id="only-dev">export-dev</preference>
        </development>
        <staging>
            <preference preference-id="only-stg">export-stg</preference>
        </staging>
        <production>
            <preference preference-id="only-prod">export-prod</preference>
        </production>
    </standard-preferences>
</preferences>
`,
    'jobs.xml': `<?xml version="1.0" encoding="UTF-8"?>
<jobs xmlns="http://www.demandware.com/xml/impex/jobs/2015-07-01">
    <job job-id="update">
        <description>new</description>
    </job>
    <job job-id="added">
        <description>added</description>
    </job>
</jobs>
`,
  });
  applyExport({ exportRoot, dataRoot, env: 'staging', mode: 'merge' });
  const after = readFileSync(prefsPath, 'utf8');
  assert.equal(scopeOuterXml(after, 'preferences/standard-preferences', 'production'), prod);
  assert.match(after, /preference-id="shared">export-shared</);
  assert.match(after, /preference-id="added">oui</);
  assert.match(after, /preference-id="only-stg">export-stg</);
  assert.match(after, /preference-id="only-dev">repo-dev</);
  assert.doesNotMatch(after, /export-dev|export-prod/);
  const jobs = readFileSync(path.join(dataRoot, 'ecom-data-sites/jobs.xml'), 'utf8');
  assert.match(jobs, /job-id="keep"/);
  assert.match(jobs, /<description>new<\/description>/);
  assert.match(jobs, /job-id="added"/);
  assert.doesNotMatch(jobs, /<description>old<\/description>/);
  rmSync(dir, { recursive: true, force: true });
});

test('replace d\'un fichier sans portée écrase le fichier, merge non', () => {
  const { dir, dataRoot, exportRoot } = setup();
  writeTree(exportRoot, {
    'jobs.xml': `<?xml version="1.0" encoding="UTF-8"?>
<jobs xmlns="http://www.demandware.com/xml/impex/jobs/2015-07-01">
    <job job-id="update">
        <description>new</description>
    </job>
</jobs>
`,
  });
  applyExport({ exportRoot, dataRoot, env: 'production', mode: 'replace' });
  const jobs = readFileSync(path.join(dataRoot, 'ecom-data-sites/jobs.xml'), 'utf8');
  assert.match(jobs, /<description>new<\/description>/);
  assert.doesNotMatch(jobs, /job-id="keep"/);
  const prefs = readFileSync(path.join(dataRoot, 'ecom-data-sites/sites/Bolle_EU/preferences.xml'), 'utf8');
  assert.match(prefs, /repo-stg/);
  assert.match(prefs, /repo-dev/);
  rmSync(dir, { recursive: true, force: true });
});

test('un export DEV n\'écrit pas dans staging', () => {
  const { dir, dataRoot, exportRoot } = setup();
  const prefsPath = path.join(dataRoot, 'ecom-data-sites/sites/Bolle_EU/preferences.xml');
  const stg = scopeOuterXml(readFileSync(prefsPath, 'utf8'), 'preferences/standard-preferences', 'staging');
  writeTree(exportRoot, {
    'sites/Bolle_EU/preferences.xml': preferences({
      shared: 'export-shared',
      dev: 'export-dev',
      stg: 'export-stg',
      prod: 'export-prod',
    }),
  });
  applyExport({ exportRoot, dataRoot, env: 'development', mode: 'replace' });
  const after = readFileSync(prefsPath, 'utf8');
  assert.equal(scopeOuterXml(after, 'preferences/standard-preferences', 'staging'), stg);
  assert.match(after, /preference-id="only-dev">export-dev</);
  assert.match(after, /preference-id="only-prod">repo-prod</);
  rmSync(dir, { recursive: true, force: true });
});

test('merge ouvre une portée vide et n\'y copie pas la production', () => {
  const { dir, dataRoot, exportRoot } = setup();
  writeTree(dataRoot, {
    'ecom-data-sites/preferences.xml': `<?xml version="1.0" encoding="UTF-8"?>
<preferences xmlns="http://www.demandware.com/xml/impex/preferences/2007-03-31">
    <custom-preferences>
        <all-instances/>
        <development/>
        <staging/>
        <production>
            <preference preference-id="only-prod">repo-prod</preference>
        </production>
    </custom-preferences>
</preferences>
`,
  });
  writeTree(exportRoot, {
    'preferences.xml': `<?xml version="1.0" encoding="UTF-8"?>
<preferences xmlns="http://www.demandware.com/xml/impex/preferences/2007-03-31">
    <custom-preferences>
        <staging>
            <preference preference-id="flag">export</preference>
        </staging>
        <production>
            <preference preference-id="only-prod">export-prod</preference>
        </production>
    </custom-preferences>
</preferences>
`,
  });
  applyExport({ exportRoot, dataRoot, env: 'staging', mode: 'merge' });
  const after = readFileSync(path.join(dataRoot, 'ecom-data-sites/preferences.xml'), 'utf8');
  assert.match(after, /preference-id="flag">export</);
  assert.match(after, /preference-id="only-prod">repo-prod</);
  assert.doesNotMatch(after, /export-prod/);
  rmSync(dir, { recursive: true, force: true });
});

test('un zip STG passé par le script met à jour le dépôt ciblé', () => {
  const { dir, dataRoot, exportRoot } = setup();
  writeTree(exportRoot, {
    'meta/custom-objecttype-definitions.xml': `<?xml version="1.0" encoding="UTF-8"?>
<metadata>
    <custom-type type-id="RXVoucher">
        <description>export</description>
    </custom-type>
</metadata>
`,
  });
  const drop = path.join(dataRoot, 'site-exports');
  mkdirSync(drop, { recursive: true });
  const zip = path.join(drop, 'STG-demo.zip');
  execFileSync('zip', ['-qr', zip, '.'], { cwd: exportRoot });
  const script = fileURLToPath(new URL('../bin/sfcc-data.mjs', import.meta.url));
  execFileSync(process.execPath, [script, 'apply-export', '--mode', 'replace', '--dir', drop], { encoding: 'utf8' });
  const meta = readFileSync(path.join(dataRoot, 'ecom-data-meta/meta/custom-objecttype-definitions.xml'), 'utf8');
  assert.match(meta, /type-id="RXVoucher"/);
  rmSync(dir, { recursive: true, force: true });
});
