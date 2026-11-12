import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { parseYaml } from './lib/yaml.mjs';

const REQUIRED = [
  'ecom-data-meta',
  'ecom-data-sites',
  'ecom-data-sites-dev',
  'ecom-data-sites-test',
];

export const DEFAULT_PROJECT_CONFIG = `# Paths are relative to this file.
# sfcc-data looks for this file in the current directory, then in parent directories.
# download and split replace meta (when the download has metadata), sites, and sites-dev.
# They do not write sites-test.

# Split metadata: system types, custom types, and attribute groups.
ecom-data-meta: ecom-data/ecom-data-meta

# Catalog configuration only: header, categories, assignments, recommendations, options, variation attributes.
# Products belong in ecom-data-sites-dev. merge --from sites is meta plus this tree.
ecom-data-sites: ecom-data/ecom-data-sites

# Full development dataset. Default source for merge and upload (--from sites-dev): meta plus this tree.
ecom-data-sites-dev: ecom-data/ecom-data-sites-dev

# One subfolder per test case. Monolithic XML, zipped as-is by merge --from test/<case>.
# download and split never write here.
ecom-data-sites-test: ecom-data/ecom-data-sites-test

# Splitter contract: ranks and the import filter. Optional.
# When omitted, sfcc-data uses data-splitter.yaml next to the parent of ecom-data-meta.
splitter: ecom-data/data-splitter.yaml
`;

export function findProjectRoot(start = process.cwd()) {
  const config = findProjectConfig(start);
  if (config) return path.dirname(config);
  let dir = path.resolve(start);
  for (;;) {
    if (existsSync(path.join(dir, 'ecom-data'))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) return path.resolve(start);
    dir = parent;
  }
}

export function ensureProjectConfig(root) {
  const file = path.join(root, 'sfcc-data-config.yaml');
  if (existsSync(file)) return { file, created: false };
  writeFileSync(file, DEFAULT_PROJECT_CONFIG);
  return { file, created: true };
}

export function findProjectConfig(start = process.cwd()) {
  let dir = path.resolve(start);
  for (;;) {
    const file = path.join(dir, 'sfcc-data-config.yaml');
    if (existsSync(file)) return file;
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

export function loadProjectConfig(start = process.cwd()) {
  const file = findProjectConfig(start);
  if (!file) {
    throw new Error('sfcc-data-config.yaml was not found. Put it at the SFCC project root, or run sfcc-data init.');
  }
  const root = path.dirname(file);
  const raw = parseYaml(readFileSync(file, 'utf8'));
  const missing = REQUIRED.filter((key) => !raw[key]);
  if (missing.length) {
    throw new Error(`sfcc-data-config.yaml: missing path (${missing.join(', ')})`);
  }
  const resolve = (value) => path.resolve(root, String(value));
  const meta = resolve(raw['ecom-data-meta']);
  const config = {
    file,
    root,
    meta,
    sites: resolve(raw['ecom-data-sites']),
    sitesDev: resolve(raw['ecom-data-sites-dev']),
    sitesTest: resolve(raw['ecom-data-sites-test']),
    splitter: raw.splitter
      ? resolve(raw.splitter)
      : path.join(path.dirname(meta), 'data-splitter.yaml'),
  };
  return config;
}

export function testCaseDir(config, from) {
  const name = String(from).replace(/^test\//, '');
  if (!name || name.includes('/') || name.includes('..')) {
    throw new Error('--from test/<case> expects a single folder, with no slash');
  }
  const dir = path.join(config.sitesTest, name);
  if (!existsSync(dir)) throw new Error(`Test case not found: ${dir}`);
  return dir;
}

export function listTestCases(config) {
  if (!existsSync(config.sitesTest)) return [];
  return readdirSync(config.sitesTest, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.'))
    .map((entry) => entry.name)
    .sort((a, b) => a.localeCompare(b, 'en'));
}
