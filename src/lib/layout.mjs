import { cpSync, existsSync, mkdirSync, readdirSync, renameSync, rmSync } from 'node:fs';
import path from 'node:path';

const CONFIG_DIRS = [
  'category',
  'category-assignment',
  'recommendation',
  'product-option',
  'variation-attribute',
];

export function isCatalogConfigRel(rel) {
  const norm = String(rel).split(path.sep).join('/');
  if (norm === 'version.txt') return true;
  const match = norm.match(/^catalogs\/[^/]+\/catalog\/(.+)$/);
  if (!match) return false;
  const rest = match[1];
  if (rest === 'header.xml' || rest === 'catalog.wrapper.xml') return true;
  return CONFIG_DIRS.some((dir) => rest === dir || rest.startsWith(`${dir}/`));
}

export function copyCatalogConfig(srcRoot, destRoot, { version = false } = {}) {
  if (version) {
    const file = path.join(srcRoot, 'version.txt');
    if (existsSync(file)) {
      mkdirSync(destRoot, { recursive: true });
      cpSync(file, path.join(destRoot, 'version.txt'));
    }
  }
  const catalogs = path.join(srcRoot, 'catalogs');
  if (!existsSync(catalogs)) return;
  for (const catalogId of readdirSync(catalogs)) {
    const unit = path.join(catalogs, catalogId, 'catalog');
    if (!existsSync(unit)) continue;
    const destUnit = path.join(destRoot, 'catalogs', catalogId, 'catalog');
    for (const name of ['header.xml', 'catalog.wrapper.xml']) {
      const file = path.join(unit, name);
      if (!existsSync(file)) continue;
      mkdirSync(destUnit, { recursive: true });
      cpSync(file, path.join(destUnit, name));
    }
    for (const dirName of CONFIG_DIRS) {
      const dir = path.join(unit, dirName);
      if (!existsSync(dir)) continue;
      cpSync(dir, path.join(destUnit, dirName), { recursive: true });
    }
  }
}

function moveReplace(src, dest) {
  rmSync(dest, { recursive: true, force: true });
  mkdirSync(path.dirname(dest), { recursive: true });
  try {
    renameSync(src, dest);
  } catch (error) {
    if (error.code !== 'EXDEV') throw error;
    cpSync(src, dest, { recursive: true });
    rmSync(src, { recursive: true, force: true });
  }
}

export function sitesTreeForFolder(folder, { sites, sitesDev, root }) {
  if (!folder) return null;
  const name = String(folder).replace(/\\/g, '/').replace(/\/$/, '');
  if (name === 'ecom-data-sites' || name === 'sites') return sites;
  if (name === 'ecom-data-sites-dev' || name === 'sites-dev') return sitesDev;
  const resolved = path.resolve(root || '', name);
  if (resolved === sites || resolved === sitesDev) return resolved;
  throw new Error(`folder inconnu : ${folder}. Valeurs : ecom-data-sites, ecom-data-sites-dev.`);
}

export function placeSplit(splitRoot, { meta, sites, sitesDev, folder, root }) {
  const metaSrc = path.join(splitRoot, 'ecom-data-meta');
  const sitesSrc = path.join(splitRoot, 'ecom-data-sites');
  if (!existsSync(metaSrc) && !existsSync(sitesSrc)) {
    throw new Error('Découpe vide : ni ecom-data-meta ni ecom-data-sites');
  }
  if (existsSync(metaSrc)) moveReplace(metaSrc, meta);
  if (!existsSync(sitesSrc)) return;
  const target = sitesTreeForFolder(folder, { sites, sitesDev, root });
  if (target === sites) {
    moveReplace(sitesSrc, sites);
    return;
  }
  moveReplace(sitesSrc, sitesDev);
  rmSync(sites, { recursive: true, force: true });
  mkdirSync(sites, { recursive: true });
  copyCatalogConfig(sitesDev, sites, { version: true });
}

export function installSplitLayout(splitRoot, dataRoot) {
  const metaSrc = path.join(splitRoot, 'ecom-data-meta');
  const sitesSrc = path.join(splitRoot, 'ecom-data-sites');
  if (!existsSync(metaSrc) || !existsSync(sitesSrc)) {
    throw new Error('Découpe incomplète : ecom-data-meta et ecom-data-sites sont requis');
  }
  placeSplit(splitRoot, {
    meta: path.join(dataRoot, 'ecom-data-meta'),
    sites: path.join(dataRoot, 'ecom-data-sites'),
    sitesDev: path.join(dataRoot, 'ecom-data-sites-dev'),
  });
}
