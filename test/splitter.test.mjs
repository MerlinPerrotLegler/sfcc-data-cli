import assert from 'node:assert/strict';
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { diffNodes, jsonEqual } from '../src/lib/compare.mjs';
import { composeAll, splitAll } from '../src/lib/engine.mjs';
import { isKept } from '../src/lib/filter.mjs';
import { joinId, sanitize } from '../src/lib/names.mjs';
import { parseXml } from '../src/lib/xml.mjs';
import { appendMapKey, ensureOrderBlock, parseYaml } from '../src/lib/yaml.mjs';

const REPO = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../../b-bolle-brands-b2c');
const SCHEMA = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../dwapp-schema');
const RANKS = path.join(REPO, 'ecom-data/ranks/v1.yaml');

function tempDir() {
  return mkdtempSync(path.join(os.tmpdir(), 'ecom-splitter-'));
}

function writeConfig(dir, { disabled = [], allow = [] } = {}) {
  mkdirSync(dir, { recursive: true });
  const ranks = path.join(dir, 'ranks.yaml');
  const block = (name, items) => (items.length
    ? `${name}:\n${items.map((item) => `  - ${item}`).join('\n')}`
    : `${name}: []`);
  const config = path.join(dir, 'data-splitter.yaml');
  writeFileSync(config, [
    `schemaDir: ${SCHEMA}`,
    `ranks: ${ranks}`,
    block('disabled', disabled),
    block('allow', allow),
    '',
  ].join('\n'));
  return config;
}

function seedRanks(dir, extra = '') {
  writeFileSync(path.join(dir, 'ranks.yaml'), `version: 1
width: 3
sequences:
  system-objecttype-extensions:
    Profile: 42
    TrackingRef: 63
  custom-objecttype-definitions:
    RXVoucher: 7
${extra}order: {}
`);
}

function exportFile(root, rel, body) {
  const abs = path.join(root, rel);
  mkdirSync(path.dirname(abs), { recursive: true });
  writeFileSync(abs, body);
}

function roundtrip(dir, files, options = {}) {
  const input = path.join(dir, 'input');
  exportFile(input, 'version.txt', '21.6.2\n');
  for (const [rel, body] of Object.entries(files)) exportFile(input, rel, body);
  seedRanks(dir, options.ranksExtra ?? '');
  const config = writeConfig(dir, options.filter ?? {});
  const split = path.join(dir, 'split');
  const composed = path.join(dir, 'composed');
  const result = splitAll({
    input,
    out: split,
    config,
    only: options.only,
    updateRanks: options.updateRanks ?? true,
  });
  composeAll({ source: split, out: composed, config, only: options.only });
  return { input, split, composed, config, result };
}

test('sanitize garde les accents et sépare les identifiants composés', () => {
  assert.equal(sanitize('Bollé Safety - RET02'), 'Bollé-Safety-RET02');
  assert.equal(sanitize('Agents-65%'), 'Agents-65');
  assert.equal(joinId(['FFS-25%', '00046507']), 'FFS-25__00046507');
  assert.equal(sanitize('|'), 'u7c');
});

test('le motif le plus long gagne, allow l’emporte à longueur égale', () => {
  const filter = {
    disabled: ['ecom-data-sites/libraries/Lib/library/content'],
    allow: ['ecom-data-sites/libraries/Lib/library/content/minicart-default.xml'],
  };
  assert.equal(isKept('ecom-data-sites/libraries/Lib/library/content/minicart-default.xml', filter), true);
  assert.equal(isKept('ecom-data-sites/libraries/Lib/library/content/footer.xml', filter), false);
  assert.equal(isKept('ecom-data-sites/libraries/Lib/static/a.png', filter), true);
  assert.equal(isKept('a/b/c', { disabled: ['a/b'], allow: ['a/b'] }), true);
  assert.equal(isKept('a/b/c', { disabled: ['a/b/c'], allow: ['a/b'] }), false);
});

test('append YAML ne réécrit pas les clés existantes', () => {
  const original = '# commentaire\nsequences:\n  system-objecttype-extensions:\n    Profile: 42\norder: {}\n';
  const text = ensureOrderBlock(original);
  const next = appendMapKey(text, 'order:', 'group Standard', 1);
  assert.match(next, /# commentaire/);
  assert.match(next, /Profile: 42/);
  assert.match(next, /"group Standard": 1/);
  assert.equal(parseYaml(next).sequences['system-objecttype-extensions'].Profile, 42);
  assert.equal(parseYaml(next).order['group Standard'], 1);
});

const PROFILE = `<?xml version="1.0" encoding="UTF-8"?>
<metadata xmlns="http://www.demandware.com/xml/impex/metadata/2006-10-31">
    <type-extension type-id="Profile">
        <system-attribute-definitions>
            <attribute-definition attribute-id="UUID">
                <min-length>0</min-length>
            </attribute-definition>
            <attribute-definition attribute-id="taxIDType">
                <value-definitions>
                    <value-definition default="true">
                        <display xml:lang="x-default">Arbitrary</display>
                        <value>Arbitrary</value>
                    </value-definition>
                </value-definitions>
            </attribute-definition>
        </system-attribute-definitions>
        <custom-attribute-definitions>
            <attribute-definition attribute-id="yotpoLoyaltyTier">
                <type>string</type>
            </attribute-definition>
        </custom-attribute-definitions>
        <group-definitions>
            <attribute-group group-id="Standard">
                <attribute attribute-id="UUID"/>
            </attribute-group>
        </group-definitions>
    </type-extension>
    <type-extension type-id="TrackingRef"/>
</metadata>
`;

test('Profile, TrackingRef et le groupe ordonné font l’aller-retour', () => {
  const dir = tempDir();
  const { split, composed } = roundtrip(dir, { 'meta/system-objecttype-extensions.xml': PROFILE });
  const profile = path.join(split, 'ecom-data-meta/meta/system-objecttype-extensions/042-Profile');
  assert.equal(readFileSync(path.join(profile, 'system-attribute-definitions/042-SA-UUID.xml'), 'utf8').includes('<?xml'), false);
  assert.match(readFileSync(path.join(profile, 'group-definitions/042-G-01-Standard.xml'), 'utf8'), /group-id="Standard"/);
  assert.match(readFileSync(path.join(split, 'ecom-data-meta/meta/system-objecttype-extensions/063-TrackingRef/063-TrackingRef.wrapper.xml'), 'utf8'), /<type-extension type-id="TrackingRef"\/>/);
  const diff = diffNodes(
    parseXml(PROFILE),
    parseXml(readFileSync(path.join(composed, 'ecom-data-meta/meta/system-objecttype-extensions.xml'), 'utf8')),
  );
  assert.equal(diff, null);
  rmSync(dir, { recursive: true, force: true });
});

test('un type inconnu échoue sans --update-ranks et n’altère pas Profile', () => {
  const dir = tempDir();
  const input = path.join(dir, 'input');
  exportFile(input, 'meta/system-objecttype-extensions.xml', `<?xml version="1.0" encoding="UTF-8"?>
<metadata xmlns="http://www.demandware.com/xml/impex/metadata/2006-10-31">
    <type-extension type-id="NewType"/>
</metadata>
`);
  seedRanks(dir);
  const config = writeConfig(dir);
  assert.throws(
    () => splitAll({ input, out: path.join(dir, 'out'), config, updateRanks: false }),
    /Rang inconnu pour system-objecttype-extensions\/NewType/,
  );
  const updated = splitAll({ input, out: path.join(dir, 'out'), config, updateRanks: true });
  assert.ok(updated.added.some((line) => line.includes('NewType: 64')));
  assert.equal(parseYaml(readFileSync(path.join(dir, 'ranks.yaml'), 'utf8')).sequences['system-objecttype-extensions'].Profile, 42);
  rmSync(dir, { recursive: true, force: true });
});

test('job Bollé, cartouches en double et portées de préférences', () => {
  const dir = tempDir();
  const files = {
    'jobs.xml': `<?xml version="1.0" encoding="UTF-8"?>
<jobs xmlns="http://www.demandware.com/xml/impex/jobs/2015-07-01">
    <job job-id="Bollé Safety - RET02"><description>retour</description></job>
</jobs>
`,
    'preferences.xml': `<?xml version="1.0" encoding="UTF-8"?>
<preferences xmlns="http://www.demandware.com/xml/impex/preferences/2007-03-31">
    <standard-preferences>
        <all-instances>
            <preference preference-id="CustomCartridges">bm_a:bm_b</preference>
        </all-instances>
        <development/>
        <staging/>
        <production/>
    </standard-preferences>
    <custom-preferences>
        <development><preference preference-id="flag">dev</preference></development>
        <production><preference preference-id="flag">prod</preference></production>
    </custom-preferences>
</preferences>
`,
    'sites/Bolle_EU/site.xml': `<?xml version="1.0" encoding="UTF-8"?>
<site xmlns="http://www.demandware.com/xml/impex/site/2007-04-30" site-id="Bolle_EU">
    <name>Bolle EU</name>
    <custom-cartridges>app_a:lib_productlist:app_b:lib_productlist</custom-cartridges>
    <storefront-password>secret-hash</storefront-password>
</site>
`,
  };
  const { split, composed } = roundtrip(dir, files);
  assert.equal(
    readFileSync(path.join(split, 'ecom-data-sites/jobs/Bollé-Safety-RET02.xml'), 'utf8').includes('Bollé Safety - RET02'),
    true,
  );
  assert.equal(
    readFileSync(path.join(split, 'ecom-data-sites/sites/Bolle_EU/cartridge-path'), 'utf8'),
    'app_a\nlib_productlist\napp_b\nlib_productlist\n',
  );
  const site = readFileSync(path.join(composed, 'ecom-data-sites/sites/Bolle_EU/site.xml'), 'utf8');
  assert.match(site, /secret-hash/);
  assert.match(site, /<custom-cartridges>app_a:lib_productlist:app_b:lib_productlist<\/custom-cartridges>/);
  const prefs = diffNodes(
    parseXml(files['preferences.xml']),
    parseXml(readFileSync(path.join(composed, 'ecom-data-sites/preferences.xml'), 'utf8')),
  );
  assert.equal(prefs, null);
  rmSync(dir, { recursive: true, force: true });
});

test('une ligne de cartridge path illisible échoue', () => {
  const dir = tempDir();
  const source = path.join(dir, 'source/ecom-data-sites');
  exportFile(source, 'sites/Bolle_EU/site.xml', `<?xml version="1.0" encoding="UTF-8"?>
<site xmlns="http://www.demandware.com/xml/impex/site/2007-04-30" site-id="Bolle_EU">
    <custom-cartridges>{cartridgePath}</custom-cartridges>
</site>
`);
  exportFile(source, 'sites/Bolle_EU/cartridge-path', 'app_a\napp b\n');
  seedRanks(dir);
  const config = writeConfig(dir);
  assert.throws(
    () => composeAll({ source: path.join(dir, 'source'), out: path.join(dir, 'out'), config }),
    /illisible/,
  );
  rmSync(dir, { recursive: true, force: true });
});

test('le filtre de library retire un content et peut retirer static', () => {
  const library = `<?xml version="1.0" encoding="UTF-8"?>
<library xmlns="http://www.demandware.com/xml/impex/library/2006-10-31">
    <folder folder-id="root"><online-flag>true</online-flag></folder>
    <content content-id="minicart-default"><type>page</type></content>
    <content content-id="footer"><type>page</type></content>
</library>
`;
  const dir = tempDir();
  const input = path.join(dir, 'input');
  exportFile(input, 'version.txt', '21.6.2\n');
  exportFile(input, 'libraries/Lib/library.xml', library);
  exportFile(input, 'libraries/Lib/static/a.txt', 'image\n');
  seedRanks(dir);
  const split = path.join(dir, 'split');
  const config = writeConfig(dir);
  splitAll({ input, out: split, config, updateRanks: true });
  const allow = writeConfig(path.join(dir, 'allow'), {
    disabled: ['ecom-data-sites/libraries/Lib/library/content'],
    allow: ['ecom-data-sites/libraries/Lib/library/content/minicart-default.xml'],
  });
  cpSync(path.join(dir, 'ranks.yaml'), path.join(dir, 'allow/ranks.yaml'));
  const allowed = path.join(dir, 'allowed');
  composeAll({ source: split, out: allowed, config: allow });
  const xml = readFileSync(path.join(allowed, 'ecom-data-sites/libraries/Lib/library.xml'), 'utf8');
  assert.match(xml, /minicart-default/);
  assert.doesNotMatch(xml, /content-id="footer"/);
  assert.equal(readFileSync(path.join(allowed, 'ecom-data-sites/libraries/Lib/static/a.txt'), 'utf8'), 'image\n');
  const blocked = writeConfig(path.join(dir, 'block'), {
    disabled: ['ecom-data-sites/libraries/Lib'],
  });
  cpSync(path.join(dir, 'ranks.yaml'), path.join(dir, 'block/ranks.yaml'));
  const hidden = path.join(dir, 'hidden');
  composeAll({ source: split, out: hidden, config: blocked });
  assert.equal(existsSync(path.join(hidden, 'ecom-data-sites/libraries/Lib/library.xml')), false);
  assert.equal(existsSync(path.join(hidden, 'ecom-data-sites/libraries/Lib/static/a.txt')), false);
  rmSync(dir, { recursive: true, force: true });
});

test('un XML sans règle et la coexistence monolithique échouent', () => {
  const dir = tempDir();
  const input = path.join(dir, 'input');
  exportFile(input, 'mystery.xml', '<mystery/>\n');
  seedRanks(dir);
  const config = writeConfig(dir);
  assert.throws(
    () => splitAll({ input, out: path.join(dir, 'out'), config }),
    /Fichier sans règle : ecom-data-sites\/mystery.xml/,
  );
  const mono = path.join(dir, 'mono');
  exportFile(path.join(mono, 'ecom-data-sites'), 'jobs.xml', '<jobs/>\n');
  exportFile(path.join(mono, 'ecom-data-sites'), 'jobs/jobs.wrapper.xml', '<jobs/>\n');
  assert.throws(
    () => composeAll({ source: mono, out: path.join(dir, 'composed'), config }),
    /Coexistence/,
  );
  rmSync(dir, { recursive: true, force: true });
});

test('compose recopie un monolithique tant que le dépôt n’est pas découpé', () => {
  const dir = tempDir();
  const source = path.join(dir, 'source');
  exportFile(path.join(source, 'ecom-data-sites'), 'jobs.xml', `<?xml version="1.0" encoding="UTF-8"?>
<jobs xmlns="http://www.demandware.com/xml/impex/jobs/2015-07-01"><job job-id="A"/></jobs>
`);
  exportFile(path.join(source, 'ecom-data-sites'), 'version.txt', '21.6.2\n');
  seedRanks(dir);
  const config = writeConfig(dir);
  composeAll({ source, out: path.join(dir, 'out'), config });
  const copy = readFileSync(path.join(dir, 'out/ecom-data-sites/jobs.xml'), 'utf8');
  assert.match(copy, /job-id="A"/);
  assert.equal(readFileSync(path.join(dir, 'out/ecom-data-sites/version.txt'), 'utf8'), '21.6.2\n');
  rmSync(dir, { recursive: true, force: true });
});

test('le dépôt ecom-data fait l’aller-retour sémantique', { timeout: 180000 }, (t) => {
  const monolith = path.join(REPO, 'ecom-data/ecom-data-meta/meta/system-objecttype-extensions.xml');
  if (!existsSync(monolith)) {
    t.skip('le dépôt est déjà découpé');
    return;
  }
  const before = readFileSync(RANKS, 'utf8');
  const dir = tempDir();
  cpSync(RANKS, path.join(dir, 'ranks.yaml'));
  const config = writeConfig(dir);
  const split = path.join(dir, 'split');
  const composed = path.join(dir, 'composed');
  const source = path.join(REPO, 'ecom-data');
  splitAll({ input: source, out: split, config, updateRanks: true });
  composeAll({ source: split, out: composed, config });
  const failures = [];
  const walk = (archiveName, dirPath, base = '') => {
    for (const entry of readdirSync(dirPath)) {
      if (entry === '.DS_Store') continue;
      const rel = base ? `${base}/${entry}` : entry;
      const abs = path.join(dirPath, entry);
      if (statSync(abs).isDirectory()) walk(archiveName, abs, rel);
      else failures.push(...compareFile(archiveName, rel, abs, composed));
    }
  };
  for (const archive of ['ecom-data-meta', 'ecom-data-sites']) walk(archive, path.join(source, archive));
  assert.equal(readFileSync(RANKS, 'utf8'), before);
  assert.deepEqual(failures, []);
  rmSync(dir, { recursive: true, force: true });
});

function compareFile(archiveName, rel, abs, composed) {
  const produced = path.join(composed, archiveName, rel);
  if (!existsSync(produced)) return [`manquant : ${archiveName}/${rel}`];
  const original = readFileSync(abs);
  const next = readFileSync(produced);
  if (rel.endsWith('.json')) {
    const left = JSON.parse(original.toString('utf8'));
    const right = JSON.parse(next.toString('utf8'));
    for (const value of [left, right]) {
      if (Array.isArray(value.clients)) {
        value.clients.sort((a, b) => String(a.client_id).localeCompare(String(b.client_id), 'fr'));
      }
    }
    return jsonEqual(left, right) ? [] : [`${archiveName}/${rel}`];
  }
  if (rel.endsWith('.xml')) {
    const diff = diffNodes(parseXml(original.toString('utf8')), parseXml(next.toString('utf8')));
    return diff ? [`${archiveName}/${rel} : ${diff}`] : [];
  }
  return original.equals(next) ? [] : [`${archiveName}/${rel}`];
}
