import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { cliRoot, renderMdc } from './contribute.mjs';
import { ensureProjectConfig } from './project-config.mjs';

export const RULE_FILE = 'sfcc-data-xml.mdc';

export function mcpEntry(project) {
  return {
    command: process.execPath,
    args: [path.join(cliRoot, 'bin', 'sfcc-data-mcp.mjs')],
    cwd: path.resolve(project),
  };
}

function sameEntry(installed, entry) {
  return Boolean(installed)
    && installed.command === entry.command
    && JSON.stringify(installed.args) === JSON.stringify(entry.args)
    && installed.cwd === entry.cwd;
}

export function installProject(project, { check = false } = {}) {
  const root = path.resolve(project);
  const configPath = path.join(root, 'sfcc-data-config.yaml');
  const cursor = path.join(root, '.cursor');
  const mcpFile = path.join(cursor, 'mcp.json');
  const ruleFile = path.join(cursor, 'rules', RULE_FILE);
  const entry = mcpEntry(root);
  const rule = renderMdc();
  let current = { mcpServers: {} };
  if (existsSync(mcpFile)) {
    try {
      current = JSON.parse(readFileSync(mcpFile, 'utf8'));
    } catch {
      throw new Error(`${mcpFile} n'est pas du JSON`);
    }
  }
  if (!current.mcpServers || typeof current.mcpServers !== 'object') current.mcpServers = {};
  const ruleOk = existsSync(ruleFile) && readFileSync(ruleFile, 'utf8') === rule;
  const mcpOk = existsSync(mcpFile) && sameEntry(current.mcpServers['sfcc-data'], entry);
  if (check) {
    const stale = [];
    if (!existsSync(configPath)) stale.push(configPath);
    if (!mcpOk) stale.push(mcpFile);
    if (!ruleOk) stale.push(ruleFile);
    if (stale.length) {
      throw new Error(`sfcc-data init is out of date:\n${stale.join('\n')}\nRun: sfcc-data init`);
    }
    return { project: root, configFile: configPath, configCreated: false, mcpFile, ruleFile, updated: false };
  }
  const configFile = ensureProjectConfig(root);
  mkdirSync(path.dirname(ruleFile), { recursive: true });
  current.mcpServers['sfcc-data'] = entry;
  writeFileSync(mcpFile, `${JSON.stringify(current, null, 2)}\n`);
  writeFileSync(ruleFile, rule);
  return {
    project: root,
    configFile: configFile.file,
    configCreated: configFile.created,
    mcpFile,
    ruleFile,
    updated: true,
  };
}
