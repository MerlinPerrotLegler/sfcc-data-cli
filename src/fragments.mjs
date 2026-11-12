import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';

import { contributionById } from './contribute.mjs';
import { loadConfig } from './lib/config.mjs';
import { customWrapper, systemWrapper } from './lib/metadata-rule.mjs';
import { joinId, orderWidth, pad, sanitize } from './lib/names.mjs';
import { loadRanks, orderRank, saveRanks, typeRank } from './lib/ranks.mjs';
import { readCartridge } from './lib/special-rules.mjs';
import {
  assertFragmentText,
  attr,
  childText,
  nameOf,
  parseFragment,
  serialize,
} from './lib/xml.mjs';
import { loadProjectConfig } from './project-config.mjs';

const META_NS = 'http://www.demandware.com/xml/impex/metadata/2006-10-31';
const PREF_NS = 'http://www.demandware.com/xml/impex/preferences/2007-03-31';
const SCOPES = ['all-instances', 'development', 'staging', 'production'];
const PAGE_TYPES = [
  'product-detail-page-meta-tag-rules',
  'product-listing-page-meta-tag-rules',
  'content-detail-page-meta-tag-rules',
  'content-listing-page-meta-tag-rules',
];

function parentsOf(input) {
  const bag = input.parents && typeof input.parents === 'object' ? input.parents : {};
  const pick = (...keys) => {
    for (const key of keys) {
      const value = input[key] ?? bag[key];
      if (value != null && String(value).trim()) return String(value).trim();
    }
    return '';
  };
  return {
    site: pick('siteId', 'site', 'site-id'),
    libraryId: pick('libraryId', 'library-id'),
    catalogId: pick('catalogId', 'catalog-id'),
    typeId: pick('typeId', 'type-id'),
    objectType: pick('objectType', 'object-type'),
    pricebookId: pick('pricebookId', 'pricebook-id'),
    inventoryId: pick('inventoryId', 'inventory-id'),
    customerListId: pick('customerListId', 'customer-list-id'),
    scope: pick('scope'),
    block: pick('block') || 'custom-preferences',
    pageType: pick('pageType', 'page-type'),
    lang: pick('lang') || 'x-default',
    file: pick('file'),
  };
}

function fill(template, vars) {
  return template.replace(/\{(\w+)\}/g, (_, key) => {
    const value = vars[key];
    if (!value) throw new Error(`Missing ${key} for this type`);
    if (String(value).includes('/') || String(value).includes('..')) {
      throw new Error(`${key} is not a usable id`);
    }
    return value;
  });
}

function archiveRoot(config, archive) {
  if (archive === 'meta') return config.meta;
  if (archive === 'sites') return config.sites;
  if (archive === 'sites-dev') return config.sitesDev;
  throw new Error(`Unknown archive: ${archive}`);
}

function businessElement(xml, element) {
  let text = String(xml ?? '').replace(/^\uFEFF/, '').trim();
  if (!text) throw new Error('Empty XML');
  text = text.replace(/^<\?xml[^?]*\?>\s*/i, '');
  const elements = parseFragment(text);
  if (elements.length !== 1) throw new Error('One business element only');
  const el = elements[0];
  if (element && nameOf(el) !== element) {
    throw new Error(`<${nameOf(el)}> au lieu de <${element}>`);
  }
  const body = serialize(el);
  assertFragmentText(body, element || nameOf(el));
  return { el, body };
}

function stemOf(rule, el) {
  if (rule.idText) return sanitize(childText(el, rule.idText));
  if (rule.idAttrs?.length) {
    return joinId(rule.idAttrs.map((name) => attr(el, name)).filter((value) => value !== ''));
  }
  if (rule.element === 'redirect-url') {
    return sanitize(attr(el, 'uri') || `${attr(el, 'source-type')}-${attr(el, 'source-id')}`);
  }
  if (rule.orderOnly) return 'item';
  throw new Error(`${rule.id}: id not found`);
}

function unitOf(rule, vars) {
  if (rule.siteUnit && vars.site && !(rule.place === 'list' && rule.unit.includes('{libraryId}') && vars.libraryId)) {
    if (rule.unit.includes('{libraryId}') && vars.libraryId && !vars.site) {
      return fill(rule.unit, vars);
    }
    if (vars.libraryId && rule.unit.includes('{libraryId}')) return fill(rule.unit, vars);
    if (vars.site && rule.siteUnit) return fill(rule.siteUnit, vars);
  }
  return fill(rule.unit, vars);
}

function resolveUnit(rule, vars) {
  if (rule.place === 'json' && rule.id === 'ocapi-client') {
    const file = vars.file || 'wapi_shop_config';
    if (file !== 'wapi_data_config' && file !== 'wapi_shop_config') {
      throw new Error('file must be wapi_data_config or wapi_shop_config');
    }
    if (vars.site) return `sites/${vars.site}/ocapi-settings/wapi_shop_config`;
    return `ocapi-settings/${file}`;
  }
  if (rule.place === 'json') return rule.unit;
  if (rule.place === 'urlmap') {
    if (!vars.site) throw new Error('Missing site for urlmap');
    return `sites/${vars.site}/urls/urlmap`;
  }
  if (rule.place === 'preference') {
    return vars.site ? `sites/${vars.site}/preferences` : 'preferences';
  }
  if (rule.place === 'cartridge') {
    return vars.site ? `sites/${vars.site}/cartridge-path` : 'cartridge-path';
  }
  if (rule.place === 'metadata') {
    const base = rule.custom ? 'custom-objecttype-definitions' : 'system-objecttype-extensions';
    return `meta/${base}`;
  }
  return unitOf(rule, vars);
}

function monolithOf(unit) {
  return `${unit}.xml`;
}

function assertNoMonolith(root, unit) {
  const monolith = path.join(root, monolithOf(unit));
  if (existsSync(monolith) && statSync(monolith).isFile()) {
    throw new Error(`${monolithOf(unit)} is still one file. Split the archive before adding a fragment.`);
  }
}

function wrapperPath(root, unit) {
  const base = path.basename(unit);
  return path.join(root, unit, `${base}.wrapper.xml`);
}

function skeleton(rule) {
  const lines = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<${rule.root} xmlns="${rule.xmlns}">`,
  ];
  for (const key of rule.keys) {
    const container = rule.containers?.[key];
    if (container) {
      lines.push(`    <${container}>`, `{${key}}`, `    </${container}>`);
    } else {
      lines.push(`{${key}}`);
    }
  }
  lines.push(`</${rule.root}>`, '');
  return `${lines.join('\n')}\n`;
}

function ensureListWrapper(root, unit, rule) {
  if (rule.place === 'lang-list') {
    const file = wrapperPath(root, unit);
    if (!existsSync(file)) {
      throw new Error(`Missing wrapper: ${path.relative(root, file)}. Split the archive before adding this fragment.`);
    }
    return;
  }
  if (!rule.root) return;
  const file = wrapperPath(root, unit);
  if (!existsSync(file)) {
    if (rule.createWrapper === false) {
      throw new Error(`Missing wrapper: ${path.relative(root, file)}. Split the archive before adding this fragment.`);
    }
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, skeleton(rule));
    return;
  }
  if (!rule.key || readFileSync(file, 'utf8').includes(`{${rule.key}}`)) return;
  throw new Error(`${path.relative(root, file)} has no {${rule.key}} placeholder`);
}

function writeBody(file, body, { overwrite, dry }) {
  if (existsSync(file) && !overwrite) throw new Error(`Fragment already exists: ${file}`);
  if (!existsSync(file) && overwrite) throw new Error(`Fragment not found: ${file}`);
  if (dry) return file;
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, body.endsWith('\n') ? body : `${body}\n`);
  return file;
}

function ranksOf(config) {
  const loaded = loadConfig(config.splitter);
  return loadRanks(loaded.ranksFile);
}

function listDir(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((name) => name !== '.DS_Store');
}

function placeList(config, rule, input, overwrite) {
  const vars = parentsOf(input);
  if (rule.pageType || rule.dir?.includes('{pageType}')) {
    if (rule.dir?.includes('{pageType}') && !PAGE_TYPES.includes(vars.pageType)) {
      throw new Error(`pageType must be one of ${PAGE_TYPES.join(', ')}`);
    }
  }
  const root = archiveRoot(config, rule.archive);
  const unit = resolveUnit(rule, vars);
  assertNoMonolith(root, unit);
  const { el, body } = businessElement(input.xml, rule.element);
  if (rule.file) {
    const file = path.join(root, unit, rule.file);
    if (existsSync(file) && !overwrite) throw new Error(`Fragment already exists: ${file}`);
    if (!existsSync(file) && overwrite) throw new Error(`Fragment not found: ${file}`);
    if (!input.dry) {
      ensureListWrapper(root, unit, rule);
      mkdirSync(path.dirname(file), { recursive: true });
      writeFileSync(file, `${body}\n`);
    }
    return { path: file, created: !overwrite };
  }
  const stem = stemOf(rule, el);
  if (!stem) throw new Error(`${rule.id}: empty id`);
  const dirRel = rule.dir && rule.dir !== '.' ? fill(rule.dir, vars) : '';
  const dir = path.join(root, unit, dirRel);
  let filename;
  const ranks = ranksOf(config);
  if (rule.orderOnly) {
    const identity = sanitize(childText(el, 'keywords') || attr(el, 'uri') || body).slice(0, 40);
    const existing = listDir(dir).find((name) => /^\d+\.xml$/.test(name) && readFileSync(path.join(dir, name), 'utf8').trim() === body.trim());
    if (existing && !overwrite) throw new Error(`Fragment already exists: ${path.join(dir, existing)}`);
    if (existing && overwrite) filename = existing;
    else if (overwrite) throw new Error(`Fragment not found for ${identity}`);
    else {
      const order = orderRank(ranks, `${unit}/${dirRel || rule.element}/${identity}`, listDir(dir).length + 1, true);
      filename = `${pad(order, orderWidth(order))}.xml`;
    }
  } else if (rule.ordered) {
    const pattern = new RegExp(`^\\d+-${stem.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\.xml$`);
    const existing = listDir(dir).find((name) => pattern.test(name));
    if (existing && !overwrite) throw new Error(`Fragment already exists: ${path.join(dir, existing)}`);
    if (!existing && overwrite) throw new Error(`Fragment not found for ${stem}`);
    if (existing) filename = existing;
    else {
      const order = orderRank(ranks, `${unit}/${dirRel || rule.element}/${stem}`, listDir(dir).length + 1, true);
      filename = `${pad(order, orderWidth(order))}-${stem}.xml`;
    }
  } else {
    filename = `${stem}.xml`;
  }
  const file = path.join(dir, filename);
  if (!rule.ordered && !rule.orderOnly) {
    if (existsSync(file) && !overwrite) throw new Error(`Fragment already exists: ${file}`);
    if (!existsSync(file) && overwrite) throw new Error(`Fragment not found: ${file}`);
  }
  if (!input.dry) {
    ensureListWrapper(root, unit, rule);
    if (ranks.added.length) saveRanks(ranks);
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, `${body}\n`);
  }
  return { path: file, created: !overwrite };
}

function scopeKey(block, scope) {
  if (!SCOPES.includes(scope)) throw new Error(`Unknown scope: ${scope}`);
  if (block !== 'standard-preferences' && block !== 'custom-preferences') {
    throw new Error('block must be standard-preferences or custom-preferences');
  }
  const prefix = block === 'standard-preferences' ? 'standard' : 'custom';
  const suffix = scope.split('-').map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join('');
  return `${prefix}${suffix}`;
}

function preferenceSkeleton() {
  const lines = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<preferences xmlns="${PREF_NS}">`,
  ];
  for (const block of ['standard-preferences', 'custom-preferences']) {
    lines.push(`    <${block}>`);
    for (const scope of SCOPES) {
      lines.push(`        <${scope}>`, `{${scopeKey(block, scope)}}`, `        </${scope}>`);
    }
    lines.push(`    </${block}>`);
  }
  lines.push('</preferences>', '');
  return `${lines.join('\n')}\n`;
}

function placePreference(config, rule, input, overwrite) {
  const vars = parentsOf(input);
  if (!vars.scope) throw new Error('Missing scope');
  if (vars.scope === 'all-instances' && attr(businessElement(input.xml, 'preference').el, 'preference-id') === 'CustomCartridges') {
    throw new Error('Contribute CustomCartridges with the cartridge type');
  }
  const root = archiveRoot(config, rule.archive);
  const unit = resolveUnit(rule, vars);
  assertNoMonolith(root, unit);
  const { el, body } = businessElement(input.xml, 'preference');
  const id = attr(el, 'preference-id');
  if (!id) throw new Error('Missing preference-id');
  const file = path.join(root, unit, vars.block, vars.scope, `${sanitize(id)}.xml`);
  const wrapper = wrapperPath(root, unit);
  if (!input.dry && !existsSync(wrapper)) {
    mkdirSync(path.dirname(wrapper), { recursive: true });
    writeFileSync(wrapper, preferenceSkeleton());
  }
  return { path: writeBody(file, body, { overwrite, dry: input.dry }), created: !overwrite };
}

function cartridgeFile(config, input) {
  const vars = parentsOf(input);
  const root = archiveRoot(config, 'sites-dev');
  return {
    vars,
    root,
    file: path.join(root, resolveUnit({ place: 'cartridge' }, vars)),
  };
}

function placeCartridge(config, input, overwrite) {
  const name = String(input.name || input.cartridge || '').trim();
  if (!name || /[\\/:\s]/.test(name)) throw new Error('Cartridge name is not usable');
  const { vars, root, file } = cartridgeFile(config, input);
  if (vars.site) {
    const siteXml = path.join(root, 'sites', vars.site, 'site.xml');
    if (existsSync(siteXml) && !readFileSync(siteXml, 'utf8').includes('{cartridgePath}')) {
      throw new Error(`${vars.site}/site.xml has no {cartridgePath}. Split the site before adding a cartridge.`);
    }
  }
  const lines = existsSync(file) ? readCartridge(file) : [];
  const index = lines.indexOf(name);
  if (index >= 0 && !overwrite) throw new Error(`Cartridge already exists: ${name}`);
  if (index < 0 && overwrite) throw new Error(`Cartridge not found: ${name}`);
  if (!input.dry && index < 0) {
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, `${[...lines, name].join('\n')}\n`);
  }
  return { path: file, created: index < 0 };
}

function placeJson(config, rule, input, overwrite) {
  const vars = parentsOf(input);
  const client = typeof input.json === 'string' ? JSON.parse(input.json) : (input.json || JSON.parse(input.xml || 'null'));
  if (!client || !client.client_id) throw new Error('Missing client_id');
  const root = archiveRoot(config, 'sites-dev');
  const unit = resolveUnit(rule, vars);
  const monolith = path.join(root, `${unit}.json`);
  if (existsSync(monolith) && statSync(monolith).isFile()) {
    throw new Error(`${unit}.json is still one file. Split it before adding a client.`);
  }
  const wrapper = path.join(root, unit, `${path.basename(unit)}.wrapper.json`);
  if (!input.dry && !existsSync(wrapper)) {
    mkdirSync(path.dirname(wrapper), { recursive: true });
    writeFileSync(wrapper, `${JSON.stringify({ _v: '1' }, null, 2)}\n`);
  }
  const file = path.join(root, unit, 'clients', `${sanitize(client.client_id)}.json`);
  writeBody(file, `${JSON.stringify(client, null, 2)}\n`, { overwrite, dry: input.dry });
  return { path: file, created: !overwrite };
}

function placeUrlmap(config, input, overwrite) {
  const vars = parentsOf(input);
  const line = String(input.line || input.xml || '').trim();
  if (!line || line.includes('\n')) throw new Error('urlmap expects a single line');
  const route = line.split(/\s+/)[0];
  const root = archiveRoot(config, 'sites-dev');
  const unit = resolveUnit({ place: 'urlmap' }, vars);
  const asFile = path.join(root, unit);
  if (existsSync(asFile) && statSync(asFile).isFile()) {
    throw new Error('urls/urlmap is still one file. Split it before adding a line.');
  }
  const stem = sanitize(route).slice(0, 80) || 'route';
  const file = path.join(root, unit, `${stem}.txt`);
  writeBody(file, `${line}\n`, { overwrite, dry: input.dry });
  return { path: file, created: !overwrite };
}

function metadataRootWrapper(root, unit, custom) {
  const file = wrapperPath(root, unit);
  if (existsSync(file)) return;
  mkdirSync(path.dirname(file), { recursive: true });
  const tag = custom ? 'custom-objecttype-definitions' : 'system-objecttype-extensions';
  writeFileSync(file, `<?xml version="1.0" encoding="UTF-8"?>
<metadata xmlns="${META_NS}">
{0}
</metadata>
`);
  if (!file.endsWith(`${tag}.wrapper.xml`)) {
    throw new Error(`Unexpected metadata wrapper: ${file}`);
  }
}

function typeFolder(dir, typeId) {
  const found = listDir(dir).filter((name) => {
    const match = name.match(/^(\d+)-(.+)$/);
    return match && match[2] === typeId;
  });
  if (found.length > 1) throw new Error(`Several folders for ${typeId}`);
  return found[0] || '';
}

function placeMetadata(config, rule, input, overwrite) {
  const vars = parentsOf(input);
  if (!vars.typeId) throw new Error('Missing typeId');
  const root = archiveRoot(config, 'meta');
  const unit = resolveUnit(rule, vars);
  assertNoMonolith(root, unit);
  const ranks = ranksOf(config);
  const unitAbs = path.join(root, unit);
  let folder = typeFolder(unitAbs, vars.typeId);
  let rank;
  if (folder) rank = Number(folder.match(/^(\d+)/)[1]);
  else {
    rank = typeRank(ranks, rule.sequence, vars.typeId, true);
    folder = `${pad(rank, ranks.data.width || 3)}-${vars.typeId}`;
  }
  const folderAbs = path.join(unitAbs, folder);
  if (rule.header) {
    let text = String(input.xml ?? '').replace(/^\uFEFF/, '').trim().replace(/^<\?xml[^?]*\?>\s*/i, '');
    if (!text) throw new Error('Empty XML');
    assertFragmentText(text, 'header.xml');
    const elements = parseFragment(text);
    if (!elements.length) throw new Error('Empty header');
    text = elements.map((el) => serialize(el)).join('\n');
    if (!input.dry) {
      metadataRootWrapper(root, unit, true);
      const typeWrapper = path.join(folderAbs, `${folder}.wrapper.xml`);
      if (!existsSync(typeWrapper)) {
        mkdirSync(folderAbs, { recursive: true });
        writeFileSync(typeWrapper, `${customWrapper(vars.typeId, false, false)}\n`);
      }
      if (ranks.added.length) saveRanks(ranks);
    }
    return { path: writeBody(path.join(folderAbs, 'header.xml'), text, { overwrite, dry: input.dry }), created: !overwrite };
  }
  const { el, body } = businessElement(input.xml, rule.element);
  const id = rule.idAttrs.map((name) => attr(el, name)).filter(Boolean).join('__');
  if (!id) throw new Error(`Missing ${rule.idAttrs.join(', ')}`);
  const stem = sanitize(id);
  const section = path.join(folderAbs, rule.sectionDir);
  let filename;
  if (rule.ordered) {
    const pattern = new RegExp(`^\\d+-G-\\d+-${stem.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\.xml$`);
    const existing = listDir(section).find((name) => pattern.test(name));
    if (existing && !overwrite) throw new Error(`Fragment already exists: ${existing}`);
    if (!existing && overwrite) throw new Error(`Fragment not found for ${id}`);
    if (existing) filename = existing;
    else {
      const order = orderRank(ranks, `${rule.sequence}/${vars.typeId}/group-definitions/${id}`, listDir(section).length + 1, true);
      filename = `${pad(rank, ranks.data.width || 3)}-G-${pad(order, 2)}-${stem}.xml`;
    }
  } else {
    filename = `${pad(rank, ranks.data.width || 3)}-${rule.role}-${stem}.xml`;
    const file = path.join(section, filename);
    if (existsSync(file) && !overwrite) throw new Error(`Fragment already exists: ${file}`);
    if (!existsSync(file) && overwrite) throw new Error(`Fragment not found: ${file}`);
  }
  if (!input.dry) {
  mkdirSync(folderAbs, { recursive: true });
  metadataRootWrapper(root, unit, Boolean(rule.custom));
  const typeWrapper = path.join(folderAbs, `${folder}.wrapper.xml`);
  if (rule.custom) {
    if (!existsSync(path.join(folderAbs, 'header.xml')) && !rule.header) {
      throw new Error(`Missing header.xml for ${vars.typeId}. Create it with custom-type-header.`);
    }
    const hasAttributes = rule.sectionDir === 'attribute-definitions' || existsSync(path.join(folderAbs, 'attribute-definitions'));
    const hasGroups = rule.sectionDir === 'group-definitions' || existsSync(path.join(folderAbs, 'group-definitions'));
    writeFileSync(typeWrapper, `${customWrapper(vars.typeId, hasAttributes, hasGroups)}\n`);
  } else {
    const order = [
      ['system-attribute-definitions', 'systemAttributeDefinitions'],
      ['custom-attribute-definitions', 'customAttributeDefinitions'],
      ['group-definitions', 'groupDefinition'],
    ];
    const present = order
      .filter(([dir]) => dir === rule.sectionDir || listDir(path.join(folderAbs, dir)).some((name) => name.endsWith('.xml')))
      .map(([tag, key]) => ({ tag, key }));
    writeFileSync(typeWrapper, `${systemWrapper(vars.typeId, present)}\n`);
  }
  if (ranks.added.length) saveRanks(ranks);
  }
  const file = path.join(section, filename);
  if (!input.dry) {
    mkdirSync(section, { recursive: true });
    writeFileSync(file, `${body}\n`);
  }
  return { path: file, created: !overwrite };
}

function place(config, rule, input, overwrite) {
  if (rule.place === 'metadata') return placeMetadata(config, rule, input, overwrite);
  if (rule.place === 'preference') return placePreference(config, rule, input, overwrite);
  if (rule.place === 'cartridge') return placeCartridge(config, input, overwrite);
  if (rule.place === 'json') return placeJson(config, rule, input, overwrite);
  if (rule.place === 'urlmap') return placeUrlmap(config, input, overwrite);
  if (rule.place === 'single') return placeList(config, rule, input, overwrite);
  return placeList(config, rule, input, overwrite);
}

export function createFragment(input, config = loadProjectConfig()) {
  return place(config, contributionById(input.type), input, false);
}

export function updateFragment(input, config = loadProjectConfig()) {
  return place(config, contributionById(input.type), input, true);
}

export function deleteFragment(input, config = loadProjectConfig()) {
  const rule = contributionById(input.type);
  if (rule.place === 'cartridge') {
    const name = String(input.name || input.cartridge || '').trim();
    if (!name) throw new Error('Missing cartridge name');
    const { file } = cartridgeFile(config, input);
    if (!existsSync(file)) throw new Error(`Fragment not found: ${file}`);
    const lines = readCartridge(file);
    const index = lines.indexOf(name);
    if (index < 0) throw new Error(`Cartridge not found: ${name}`);
    lines.splice(index, 1);
    if (lines.length) writeFileSync(file, `${lines.join('\n')}\n`);
    else rmSync(file);
    return { path: file, removed: true, references: [], note: '' };
  }
  const target = input.path
    ? path.resolve(input.path)
    : place(config, rule, { ...input, dry: true }, true).path;
  if (!existsSync(target)) throw new Error(`Fragment not found: ${target}`);
  let attributeId = '';
  if (rule.place === 'metadata' && rule.role !== 'G' && !rule.header) {
    const [el] = parseFragment(readFileSync(target, 'utf8'));
    attributeId = el ? attr(el, 'attribute-id') : '';
  }
  rmSync(target);
  const references = [];
  if (attributeId) {
    const groups = path.join(path.dirname(path.dirname(target)), 'group-definitions');
    const needle = `attribute-id="${attributeId}"`;
    for (const name of listDir(groups).filter((file) => file.endsWith('.xml'))) {
      const abs = path.join(groups, name);
      if (readFileSync(abs, 'utf8').includes(needle)) references.push(abs);
    }
  }
  return {
    path: target,
    removed: true,
    references,
    note: references.length
      ? 'These groups still cite the attribute. Remove the <attribute> line by hand.'
      : '',
  };
}

export function validateFragment(input, config = loadProjectConfig()) {
  const rule = contributionById(input.type);
  if (rule.place === 'cartridge') {
    const name = String(input.name || '').trim();
    if (!name) throw new Error('Missing cartridge name');
    return { ok: true, type: rule.id, name };
  }
  if (rule.place === 'urlmap') {
    const line = String(input.line || input.xml || '').trim();
    if (!line || line.includes('\n')) throw new Error('urlmap expects a single line');
    return { ok: true, type: rule.id };
  }
  if (rule.place === 'json') {
    const client = typeof input.json === 'string' ? JSON.parse(input.json) : input.json;
    if (!client?.client_id) throw new Error('Missing client_id');
    return { ok: true, type: rule.id, client_id: client.client_id };
  }
  if (rule.header) {
    const text = String(input.xml ?? '').replace(/^\uFEFF/, '').trim().replace(/^<\?xml[^?]*\?>\s*/i, '');
    assertFragmentText(text, 'header.xml');
    if (!parseFragment(text).length) throw new Error('Empty header');
    return { ok: true, type: rule.id };
  }
  const { el } = businessElement(input.xml, rule.element);
  if (rule.idAttrs) {
    for (const name of rule.idAttrs) {
      if (rule.element === 'slot-configuration' && name === 'context-id' && attr(el, 'context') === 'global') continue;
      if (!attr(el, name) && name !== 'context-id') throw new Error(`Missing ${name}`);
    }
  }
  return { ok: true, type: rule.id, id: stemOf(rule, el) };
}

function walk(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === '.DS_Store' || entry.name === '.composed') continue;
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(abs, out);
    else if (entry.isFile()) out.push(abs);
  }
  return out;
}

export function findFragments(query, config = loadProjectConfig()) {
  const needle = String(query || '').trim().toLocaleLowerCase('fr');
  if (!needle) throw new Error('Empty search');
  const hits = [];
  for (const root of [config.meta, config.sites, config.sitesDev, config.sitesTest]) {
    for (const file of walk(root)) {
      const rel = path.relative(root, file);
      let text = '';
      if (statSync(file).size <= 200_000) text = readFileSync(file, 'utf8');
      if (rel.toLocaleLowerCase('fr').includes(needle) || text.toLocaleLowerCase('fr').includes(needle)) {
        hits.push(file);
        if (hits.length >= 50) return { matches: hits, truncated: true };
      }
    }
  }
  return { matches: hits, truncated: false };
}
