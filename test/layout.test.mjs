import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { installSplitLayout, isCatalogConfigRel } from '../src/lib/layout.mjs';

test('la config catalogue garde les catégories et laisse les produits', () => {
  assert.equal(isCatalogConfigRel('version.txt'), true);
  assert.equal(isCatalogConfigRel('catalogs/bolle-master-catalog/catalog/header.xml'), true);
  assert.equal(isCatalogConfigRel('catalogs/bolle-master-catalog/catalog/category/sunglasses.xml'), true);
  assert.equal(isCatalogConfigRel('catalogs/bolle-master-catalog/catalog/product/BS-1.xml'), false);
  assert.equal(isCatalogConfigRel('sites/Bolle_EU/preferences/custom-preferences/staging/isRXD2CEnabled.xml'), false);
});

test('install remplace la meta, copie la config catalogue et garde le jeu complet', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'ecom-layout-'));
  const split = path.join(dir, 'split');
  const data = path.join(dir, 'data');
  const write = (root, rel, body) => {
    const abs = path.join(root, rel);
    mkdirSync(path.dirname(abs), { recursive: true });
    writeFileSync(abs, body);
  };
  write(split, 'ecom-data-meta/meta/system-objecttype-extensions/001-A/system-attribute-definitions/001-SA-id.xml', '<attribute/>\n');
  write(split, 'ecom-data-meta/version.txt', '21.6.2\n');
  write(split, 'ecom-data-sites/version.txt', '21.6.2\n');
  write(split, 'ecom-data-sites/catalogs/bolle/catalog/header.xml', '<header/>\n');
  write(split, 'ecom-data-sites/catalogs/bolle/catalog/catalog.wrapper.xml', '<catalog/>\n');
  write(split, 'ecom-data-sites/catalogs/bolle/catalog/category/sun.xml', '<category/>\n');
  write(split, 'ecom-data-sites/catalogs/bolle/catalog/product/BS-1.xml', '<product/>\n');
  write(split, 'ecom-data-sites/sites/Bolle_EU/site.xml', '<site/>\n');
  write(data, 'ecom-data-meta/meta/old.xml', '<old/>\n');
  write(data, 'ecom-data-sites/catalogs/old/catalog.xml', '<old/>\n');

  installSplitLayout(split, data);

  assert.equal(
    readFileSync(path.join(data, 'ecom-data-meta/meta/system-objecttype-extensions/001-A/system-attribute-definitions/001-SA-id.xml'), 'utf8'),
    '<attribute/>\n',
  );
  assert.equal(readFileSync(path.join(data, 'ecom-data-sites/catalogs/bolle/catalog/category/sun.xml'), 'utf8'), '<category/>\n');
  assert.equal(readFileSync(path.join(data, 'ecom-data-sites-dev/catalogs/bolle/catalog/product/BS-1.xml'), 'utf8'), '<product/>\n');
  assert.equal(readFileSync(path.join(data, 'ecom-data-sites-dev/sites/Bolle_EU/site.xml'), 'utf8'), '<site/>\n');
  assert.throws(() => readFileSync(path.join(data, 'ecom-data-sites/catalogs/bolle/catalog/product/BS-1.xml')));
  assert.throws(() => readFileSync(path.join(data, 'ecom-data-meta/meta/old.xml')));
  rmSync(dir, { recursive: true, force: true });
});
