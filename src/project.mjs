import { execFileSync } from 'node:child_process';
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  symlinkSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { findExportRoot } from './apply-site-export.mjs';
import { composeAll, splitAll } from './lib/engine.mjs';
import { placeSplit } from './lib/layout.mjs';
import { loadProjectConfig, testCaseDir } from './project-config.mjs';

function unzip(zip, dest) {
  mkdirSync(dest, { recursive: true });
  execFileSync('unzip', ['-q', zip, '-d', dest], { stdio: 'inherit' });
}

function zipDir(dir, zipPath) {
  const dest = path.resolve(zipPath);
  mkdirSync(path.dirname(dest), { recursive: true });
  rmSync(dest, { force: true });
  execFileSync('zip', ['-qr', dest, '.'], { cwd: dir, stdio: 'inherit' });
  return dest;
}

function copyContents(src, dest) {
  if (!existsSync(src)) return;
  mkdirSync(dest, { recursive: true });
  for (const name of readdirSync(src)) {
    cpSync(path.join(src, name), path.join(dest, name), { recursive: true });
  }
}

function stageSource(config, from) {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'sfcc-data-source-'));
  symlinkSync(config.meta, path.join(dir, 'ecom-data-meta'));
  if (from === 'meta') return dir;
  const sitesName = from === 'sites' ? 'ecom-data-sites' : 'ecom-data-sites-dev';
  const target = from === 'sites' ? config.sites : config.sitesDev;
  symlinkSync(target, path.join(dir, sitesName));
  return dir;
}

export function splitIntoProject(input, { updateRanks = false, config = loadProjectConfig(), folder = '' } = {}) {
  const work = mkdtempSync(path.join(os.tmpdir(), 'sfcc-data-split-'));
  try {
    const abs = path.resolve(input);
    let exportRoot = abs;
    if (abs.toLowerCase().endsWith('.zip')) {
      unzip(abs, path.join(work, 'zip'));
      exportRoot = findExportRoot(path.join(work, 'zip'));
    } else {
      exportRoot = findExportRoot(abs);
    }
    const split = path.join(work, 'split');
    const result = splitAll({
      input: exportRoot,
      out: split,
      config: config.splitter,
      updateRanks,
      check: false,
    });
    placeSplit(split, {
      meta: config.meta,
      sites: config.sites,
      sitesDev: config.sitesDev,
      folder,
      root: config.root,
    });
    return result;
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

export function buildImportZip(zipPath, { from = 'sites-dev', config = loadProjectConfig() } = {}) {
  if (String(from).startsWith('test/')) {
    return zipDir(testCaseDir(config, from), zipPath);
  }
  if (!['meta', 'sites', 'sites-dev'].includes(from)) {
    throw new Error('--from attend meta, sites, sites-dev ou test/<cas>');
  }
  const work = mkdtempSync(path.join(os.tmpdir(), 'sfcc-data-merge-'));
  try {
    const source = stageSource(config, from);
    const composed = path.join(work, 'composed');
    composeAll({ source, out: composed, config: config.splitter });
    const archive = path.join(work, 'archive');
    mkdirSync(archive, { recursive: true });
    copyContents(path.join(composed, 'ecom-data-meta'), archive);
    const sitesArchive = from === 'sites' ? 'ecom-data-sites' : 'ecom-data-sites-dev';
    if (from !== 'meta') copyContents(path.join(composed, sitesArchive), archive);
    if (!readdirSync(archive).length) throw new Error('Archive vide : rien à zipper');
    return zipDir(archive, zipPath);
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}
