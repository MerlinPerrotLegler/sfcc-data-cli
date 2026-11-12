import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import {
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

import { renderMdc, renderMarkdown } from '../src/contribute.mjs';
import { createFragment, deleteFragment, updateFragment } from '../src/fragments.mjs';
import { composeAll } from '../src/lib/engine.mjs';
import { installProject } from '../src/init.mjs';
import { loadProjectConfig } from '../src/project-config.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cli = path.join(root, 'bin/sfcc-data.mjs');
const mcpBin = path.join(root, 'bin/sfcc-data-mcp.mjs');

function write(dir, rel, body) {
  const abs = path.join(dir, rel);
  mkdirSync(path.dirname(abs), { recursive: true });
  writeFileSync(abs, body);
}

function project() {
  const dir = mkdtempSync(path.join(tmpdir(), 'sfcc-mcp-'));
  write(dir, 'ecom-data/ranks/v1.yaml', `version: 1
width: 3
sequences:
  system-objecttype-extensions:
  custom-objecttype-definitions:
order: {}
`);
  write(dir, 'ecom-data/data-splitter.yaml', 'ranks: ranks/v1.yaml\ndisabled: []\nallow: []\n');
  write(dir, 'sfcc-data-config.yaml', [
    'ecom-data-meta: ecom-data/ecom-data-meta',
    'ecom-data-sites: ecom-data/ecom-data-sites',
    'ecom-data-sites-dev: ecom-data/ecom-data-sites-dev',
    'ecom-data-sites-test: ecom-data/ecom-data-sites-test',
    'splitter: ecom-data/data-splitter.yaml',
    '',
  ].join('\n'));
  return dir;
}

test('la règle versionnée est celle que init installe', () => {
  assert.equal(readFileSync(path.join(root, 'rules/sfcc-data-xml.mdc'), 'utf8'), renderMdc());
  assert.equal(readFileSync(path.join(root, 'docs/contribute-xml.md'), 'utf8'), renderMarkdown());
});

test('un job créé se recompose, un attribut aussi, et la suppression signale le groupe', () => {
  const dir = project();
  const config = loadProjectConfig(dir);
  const job = createFragment({
    type: 'job',
    xml: '<job job-id="Rebuild"><description>oui</description></job>',
  }, config);
  assert.match(job.path, /ecom-data-sites-dev\/jobs\/Rebuild\.xml$/);
  assert.throws(() => createFragment({
    type: 'job',
    xml: '<job job-id="Rebuild"><description>oui</description></job>',
  }, config), /already exists/);
  updateFragment({
    type: 'job',
    xml: '<job job-id="Rebuild"><description>non</description></job>',
  }, config);
  assert.match(readFileSync(job.path, 'utf8'), /non/);

  const composed = path.join(dir, 'composed');
  composeAll({
    source: path.dirname(config.meta),
    out: composed,
    config: config.splitter,
  });
  assert.match(readFileSync(path.join(composed, 'ecom-data-sites-dev/jobs.xml'), 'utf8'), /job-id="Rebuild"/);

  const attribute = createFragment({
    type: 'system-attribute',
    typeId: 'Profile',
    xml: '<attribute-definition attribute-id="loyalty"><type>string</type></attribute-definition>',
  }, config);
  assert.match(attribute.path, /001-Profile\/system-attribute-definitions\/001-SA-loyalty\.xml$/);
  composeAll({
    source: path.dirname(config.meta),
    out: path.join(dir, 'composed-meta'),
    config: config.splitter,
  });
  assert.match(
    readFileSync(path.join(dir, 'composed-meta/ecom-data-meta/meta/system-objecttype-extensions.xml'), 'utf8'),
    /attribute-id="loyalty"/,
  );
  const group = path.join(path.dirname(path.dirname(attribute.path)), 'group-definitions/001-G-01-Standard.xml');
  write(path.dirname(group), path.basename(group), '<attribute-group group-id="Standard"><attribute attribute-id="loyalty"/></attribute-group>\n');
  const removed = deleteFragment({
    type: 'system-attribute',
    typeId: 'Profile',
    xml: '<attribute-definition attribute-id="loyalty"><type>string</type></attribute-definition>',
  }, config);
  assert.equal(removed.references.length, 1);
  assert.match(removed.note, /groups/);

  const cartridge = createFragment({
    type: 'cartridge',
    siteId: 'Bolle_EU',
    name: 'app_custom_bolle',
  }, config);
  assert.match(cartridge.path, /sites\/Bolle_EU\/cartridge-path$/);
  assert.equal(readFileSync(cartridge.path, 'utf8'), 'app_custom_bolle\n');
  rmSync(dir, { recursive: true, force: true });
});

test('init crée sfcc-data-config.yaml quand il manque', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'sfcc-init-'));
  mkdirSync(path.join(dir, 'ecom-data'));
  const result = installProject(dir);
  assert.equal(result.configCreated, true);
  assert.match(readFileSync(result.configFile, 'utf8'), /ecom-data-meta: ecom-data\/ecom-data-meta/);
  rmSync(dir, { recursive: true, force: true });
});

test('init installe le MCP et la règle, et --check voit une règle modifiée', () => {
  const dir = project();
  const before = readFileSync(path.join(dir, 'sfcc-data-config.yaml'), 'utf8');
  const first = installProject(dir);
  assert.equal(first.configCreated, false);
  assert.equal(readFileSync(first.configFile, 'utf8'), before);
  const mcp = JSON.parse(readFileSync(first.mcpFile, 'utf8'));
  mcp.mcpServers.other = { command: 'other' };
  writeFileSync(first.mcpFile, `${JSON.stringify(mcp, null, 2)}\n`);
  installProject(dir);
  const again = JSON.parse(readFileSync(first.mcpFile, 'utf8'));
  assert.equal(again.mcpServers.other.command, 'other');
  assert.equal(again.mcpServers['sfcc-data'].cwd, dir);
  assert.equal(installProject(dir, { check: true }).updated, false);
  writeFileSync(first.ruleFile, 'périmé\n');
  assert.throws(() => installProject(dir, { check: true }), /out of date/);
  rmSync(dir, { recursive: true, force: true });
});

test('la commande init --check suit le disque', async () => {
  const dir = project();
  const { spawnSync } = await import('node:child_process');
  const installed = spawnSync(process.execPath, [cli, 'install', 'mcp', '--project', dir], { encoding: 'utf8' });
  assert.equal(installed.status, 0, installed.stderr);
  const ok = spawnSync(process.execPath, [cli, 'init', '--check', '--project', dir], { encoding: 'utf8' });
  assert.equal(ok.status, 0, ok.stderr);
  assert.match(ok.stdout, /up to date/);
  writeFileSync(path.join(dir, '.cursor/rules/sfcc-data-xml.mdc'), 'périmé\n');
  const stale = spawnSync(process.execPath, [cli, 'init', '--check', '--project', dir], { encoding: 'utf8' });
  assert.notEqual(stale.status, 0);
  assert.match(stale.stderr, /out of date/);
  rmSync(dir, { recursive: true, force: true });
});

test('le serveur MCP répond à list_rules et create_fragment', async () => {
  const dir = project();
  const child = spawn(process.execPath, [mcpBin], { cwd: dir });
  const lines = createInterface({ input: child.stdout });
  const pending = [];
  lines.on('line', (line) => {
    if (!line.trim()) return;
    const wait = pending.shift();
    if (wait) wait(JSON.parse(line));
  });
  const send = (message) => {
    child.stdin.write(`${JSON.stringify(message)}\n`);
    return new Promise((resolve) => pending.push(resolve));
  };
  try {
    const hello = await send({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'test', version: '0' } },
    });
    assert.equal(hello.result.serverInfo.name, 'sfcc-data');
    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`);
    const listed = await send({ jsonrpc: '2.0', id: 2, method: 'tools/list' });
    const names = listed.result.tools.map((tool) => tool.name);
    assert.ok(names.includes('list_rules'));
    assert.ok(names.includes('create_fragment'));
    assert.ok(names.includes('download_instance'));
    const rules = await send({
      jsonrpc: '2.0',
      id: 3,
      method: 'tools/call',
      params: { name: 'list_rules', arguments: { type: 'job' } },
    });
    assert.equal(rules.result.isError, false);
    assert.match(rules.result.content[0].text, /ecom-data-sites-dev/);
    const created = await send({
      jsonrpc: '2.0',
      id: 4,
      method: 'tools/call',
      params: {
        name: 'create_fragment',
        arguments: {
          type: 'preference',
          siteId: 'Bolle_EU',
          scope: 'staging',
          block: 'custom-preferences',
          xml: '<preference preference-id="isRXD2CEnabled">true</preference>',
        },
      },
    });
    assert.equal(created.result.isError, false, created.result.content[0].text);
    assert.match(created.result.content[0].text, /isRXD2CEnabled\.xml/);
  } finally {
    child.kill();
    rmSync(dir, { recursive: true, force: true });
  }
});
