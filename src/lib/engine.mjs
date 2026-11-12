import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { loadConfig } from './config.mjs';
import { isKept, matchesOnly } from './filter.mjs';
import { listRules, writeText } from './list-rule.mjs';
import { metadataRules } from './metadata-rule.mjs';
import { loadRanks, saveRanks } from './ranks.mjs';
import { specialRules } from './special-rules.mjs';

const RULES = [...specialRules, ...metadataRules, ...listRules];

const PASS = [
  /^version\.txt$/,
  /^schedules\.xml$/,
  /^oauth-providers\.xml$/,
  /^csrf-whitelists\.xml$/,
  /^priceadjustmentlimits\.xml$/,
  /^custom-quotas\/quota-overrides-v2\.xml$/,
  /^sitemapconfiguration\.xml$/,
  /^cache-settings\.xml$/,
  /^dcext\.xml$/,
  /^feeds\.xml$/,
  /^eventrouting\.xml$/,
  /^commerce-feature-states\.xml$/,
  /^customer-cdn-settings\.xml$/,
  /^search\.xml$/,
  /^sites\/[^/]+\/urls\/aliases$/,
  /^sites\/[^/]+\/urls\/aliases\.json$/,
  /^sites\/[^/]+\/urls\/urlrules$/,
];

export function findRule(rel) {
  return RULES.find((rule) => rule.match(rel)) ?? null;
}

export function archivesOf(input) {
  const meta = path.join(input, 'ecom-data-meta');
  const sites = path.join(input, 'ecom-data-sites');
  const sitesDev = path.join(input, 'ecom-data-sites-dev');
  const hasRepo = existsSync(meta) || existsSync(sites) || existsSync(sitesDev);
  if (hasRepo && !existsSync(path.join(input, 'meta'))) {
    const archives = [];
    if (existsSync(meta)) archives.push({ name: 'ecom-data-meta', root: meta });
    if (existsSync(sites)) archives.push({ name: 'ecom-data-sites', root: sites });
    if (existsSync(sitesDev)) archives.push({ name: 'ecom-data-sites-dev', root: sitesDev });
    return archives;
  }
  return [
    { name: 'ecom-data-meta', root: input, classify: 'meta' },
    { name: 'ecom-data-sites', root: input, classify: 'sites' },
  ];
}

function belongs(rel, archive) {
  if (!archive.classify) return true;
  if (rel === 'version.txt') return true;
  const inMeta = rel === 'meta' || rel.startsWith('meta/');
  return archive.classify === 'meta' ? inMeta : !inMeta;
}

function walk(dir, base = '') {
  if (!existsSync(dir)) return [];
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === '.DS_Store') continue;
    const rel = base ? `${base}/${entry.name}` : entry.name;
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      for (const nested of walk(abs, rel)) out.push(nested);
    } else if (entry.isFile()) out.push(rel);
  }
  return out;
}

function isPass(rel) {
  const base = rel.slice(rel.lastIndexOf('/') + 1);
  return PASS.some((pattern) => pattern.test(rel) || pattern.test(base));
}

function isStatic(rel) {
  return rel === 'static' || rel.startsWith('static/') || rel.includes('/static/');
}

function isCartridge(rel) {
  return rel === 'cartridge-path' || rel.startsWith('cartridge-path/')
    || /^sites\/[^/]+\/cartridge-path(\/|$)/.test(rel);
}

function parentOf(rel) {
  const index = rel.lastIndexOf('/');
  return index < 0 ? '.' : rel.slice(0, index);
}

function monolithOfWrapper(rel) {
  const json = rel.endsWith('.wrapper.json');
  const xml = rel.endsWith('.wrapper.xml');
  if (!json && !xml) return null;
  const suffix = json ? '.wrapper.json' : '.wrapper.xml';
  const base = path.posix.basename(rel, suffix);
  const dir = path.posix.dirname(rel);
  if (path.posix.basename(dir) !== base) return null;
  if (!json && base === 'library' && /(?:^|\/)library$/.test(dir)) {
    if (/^sites\/[^/]+\/library$/.test(dir)) return `${dir}/library.xml`;
    const parent = path.posix.dirname(dir);
    return parent === '.' ? 'library.xml' : `${parent}/library.xml`;
  }
  const parent = path.posix.dirname(dir);
  const ext = json ? '.json' : '.xml';
  return parent === '.' ? `${base}${ext}` : `${parent}/${base}${ext}`;
}

function urlmapUnitOf(rel) {
  const dir = rel.endsWith('.txt') ? parentOf(rel) : rel;
  if (dir && dir !== '.' && findRule(dir)?.kind === 'urlmap') return dir;
  return null;
}

function copyRel(fromRoot, toRoot, rel) {
  const target = path.join(toRoot, rel);
  mkdirSync(path.dirname(target), { recursive: true });
  copyFileSync(path.join(fromRoot, rel), target);
}

function guardSplitDest(destRoot, rule, rel) {
  if (rule.kind === 'transform') {
    const abs = path.join(destRoot, rel);
    if (existsSync(abs) && !readFileSync(abs, 'utf8').includes('{cartridgePath}')) {
      throw new Error(`Choisir un autre --out : ${rel} est encore le fichier monolithique`);
    }
    return;
  }
  const paths = rule.paths(rel);
  if (rule.kind === 'urlmap') {
    const abs = path.join(destRoot, rel);
    if (existsSync(abs) && statSync(abs).isFile()) {
      throw new Error(`Choisir un autre --out : ${rel} existe déjà`);
    }
    return;
  }
  if (existsSync(path.join(destRoot, paths.monolith))) {
    throw new Error(`Choisir un autre --out : ${paths.monolith} est encore le fichier monolithique`);
  }
}

function consumeTree(files, consumed, prefix) {
  if (!prefix) return;
  for (const file of files) {
    if (isStatic(file)) continue;
    if (file === prefix || file.startsWith(`${prefix}/`)) consumed.add(file);
  }
}

function diffTree(actual, expected) {
  const problems = [];
  for (const rel of walk(actual)) {
    const target = path.join(expected, rel);
    if (!existsSync(target)) {
      problems.push(`manquant : ${rel}`);
      continue;
    }
    const left = readFileSync(path.join(actual, rel));
    const right = readFileSync(target);
    if (!left.equals(right)) problems.push(`différent : ${rel}`);
  }
  return problems;
}

function context(archive, rel, extra) {
  return {
    abs: path.join(archive.root, rel),
    rel,
    archiveRoot: archive.root,
    archiveName: archive.name,
    ...extra,
  };
}

export function splitAll(options) {
  if (!options.input) throw new Error('--input est obligatoire');
  if (!existsSync(options.input)) throw new Error(`Export introuvable : ${options.input}`);
  if (options.check && options.updateRanks) {
    throw new Error('--check n’écrit pas les rangs. Retirer --update-ranks.');
  }
  const config = loadConfig(options.config);
  const ranks = loadRanks(config.ranksFile);
  const realOut = options.out;
  const out = options.check ? mkdtempSync(path.join(os.tmpdir(), 'ecom-split-')) : realOut;
  let written = 0;
  try {
    for (const archive of archivesOf(options.input)) {
      const dest = path.join(out, archive.name);
      let archiveWrites = 0;
      for (const rel of walk(archive.root).filter((file) => belongs(file, archive))) {
        if (rel === 'version.txt') continue;
        if (!matchesOnly(rel, options.only)) continue;
        const rule = findRule(rel);
        if (rule) {
          guardSplitDest(dest, rule, rel);
          rule.split(context(archive, rel, {
            dest,
            ranks,
            updateRanks: Boolean(options.updateRanks),
            filter: { disabled: config.disabled, allow: config.allow },
          }));
          archiveWrites += 1;
          continue;
        }
        if (isPass(rel) || isStatic(rel)) {
          copyRel(archive.root, dest, rel);
          archiveWrites += 1;
          continue;
        }
        throw new Error(`Fichier sans règle : ${archive.name}/${rel}`);
      }
      const version = path.join(archive.root, 'version.txt');
      if (archiveWrites > 0 && existsSync(version)) {
        copyRel(archive.root, dest, 'version.txt');
        archiveWrites += 1;
      }
      written += archiveWrites;
    }
    if (options.check) {
      const problems = diffTree(out, realOut);
      if (problems.length) {
        throw new Error(`--check : l’arbre diffère\n${problems.slice(0, 20).join('\n')}`);
      }
    } else if (options.updateRanks) {
      saveRanks(ranks);
    }
  } finally {
    if (options.check) rmSync(out, { recursive: true, force: true });
  }
  return { written, added: ranks.added };
}

export function composeAll(options) {
  if (!options.source) throw new Error('--source est obligatoire');
  if (!existsSync(options.source)) throw new Error(`Source introuvable : ${options.source}`);
  if (path.resolve(options.source) === path.resolve(options.out)) {
    throw new Error('La sortie de compose doit être distincte de la source');
  }
  const config = loadConfig(options.config);
  const filter = { disabled: config.disabled, allow: config.allow };
  let written = 0;
  for (const archive of archivesOf(options.source)) {
    const destRoot = path.join(options.out, archive.name);
    rmSync(destRoot, { recursive: true, force: true });
    const files = walk(archive.root).filter((file) => belongs(file, archive));
    const fileSet = new Set(files);
    const consumed = new Set();
    const units = [];
    for (const rel of files) {
      const monolith = monolithOfWrapper(rel);
      if (!monolith) continue;
      const rule = findRule(monolith);
      if (!rule || rule.kind === 'transform' || rule.kind === 'urlmap') continue;
      const paths = rule.paths(monolith);
      if (paths.wrapper !== rel) continue;
      if (fileSet.has(paths.monolith)) {
        throw new Error(`Coexistence de ${archive.name}/${paths.monolith} et ${paths.wrapper}`);
      }
      units.push({ rel: monolith, rule, paths });
      consumed.add(paths.monolith);
      consumeTree(files, consumed, paths.unitDir);
      for (const extra of rule.extraConsumed?.(monolith) ?? []) consumeTree(files, consumed, extra);
    }
    let archiveWrites = 0;
    const emit = (rel) => matchesOnly(rel, options.only);
    for (const unit of units) {
      if (!emit(unit.rel) || !isKept(`${archive.name}/${unit.paths.wrapper}`, filter)) continue;
      const xml = unit.rule.compose(context(archive, unit.rel, { filter, dest: destRoot }));
      if (xml == null) continue;
      writeText(destRoot, unit.paths.monolith, xml);
      archiveWrites += 1;
    }
    for (const rel of files) {
      const rule = findRule(rel);
      if (rule?.kind !== 'transform') continue;
      consumed.add(rel);
      for (const extra of rule.extraConsumed?.(rel) ?? []) consumeTree(files, consumed, extra);
      if (!emit(rel)) continue;
      writeText(destRoot, rel, rule.compose(context(archive, rel, { filter, dest: destRoot })));
      archiveWrites += 1;
    }
    const urlmaps = new Set(files.map(urlmapUnitOf).filter(Boolean));
    for (const unit of urlmaps) {
      consumeTree(files, consumed, unit);
      const abs = path.join(archive.root, unit);
      if (!existsSync(abs) || !statSync(abs).isDirectory()) continue;
      if (!emit(unit) || !isKept(`${archive.name}/${unit}`, filter)) continue;
      const rule = findRule(unit);
      writeText(destRoot, unit, rule.compose(context(archive, unit, { filter, dest: destRoot })));
      archiveWrites += 1;
    }
    for (const rel of files) {
      if (consumed.has(rel) || rel === 'version.txt' || isCartridge(rel)) continue;
      if (options.only?.length && !emit(rel)) continue;
      const rule = findRule(rel);
      if (rule && rule.kind !== 'transform') {
        const paths = rule.paths(rel);
        if (paths.wrapper && existsSync(path.join(archive.root, paths.wrapper))) {
          throw new Error(`Coexistence de ${archive.name}/${rel} et ${paths.wrapper}`);
        }
        if (!isKept(`${archive.name}/${rel}`, filter)) continue;
        copyRel(archive.root, destRoot, rel);
        archiveWrites += 1;
        continue;
      }
      if (isPass(rel) || isStatic(rel)) {
        if (!isKept(`${archive.name}/${rel}`, filter)) continue;
        copyRel(archive.root, destRoot, rel);
        archiveWrites += 1;
        continue;
      }
      throw new Error(`Fichier sans règle : ${archive.name}/${rel}`);
    }
    const version = path.join(archive.root, 'version.txt');
    if (archiveWrites > 0 && existsSync(version)) {
      copyRel(archive.root, destRoot, 'version.txt');
      archiveWrites += 1;
    }
    written += archiveWrites;
  }
  return { written };
}
