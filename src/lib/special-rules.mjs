import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

import { isKept } from './filter.mjs';
import { compareNames, joinId, orderWidth, pad, sanitize } from './names.mjs';
import { fillPlaceholders } from './placeholders.mjs';
import { orderRank } from './ranks.mjs';
import { assertFragmentName, defaultPaths, writeText } from './list-rule.mjs';
import {
  assertFragmentText,
  attr,
  children,
  childText,
  escapeAttr,
  escapeText,
  nameOf,
  parseFragment,
  parseXml,
  serialize,
  textOf,
} from './xml.mjs';

const PREF_NS = 'http://www.demandware.com/xml/impex/preferences/2007-03-31';
const URL_NS = 'http://www.demandware.com/xml/impex/urlrules/2012-12-01';
const META_NS = 'http://www.demandware.com/xml/impex/pagemetatag/2016-08-22';
const SCOPES = ['all-instances', 'development', 'staging', 'production'];
const PAGE_TYPES = [
  'product-detail-page-meta-tag-rules',
  'product-listing-page-meta-tag-rules',
  'content-detail-page-meta-tag-rules',
  'content-listing-page-meta-tag-rules',
];
const URL_LISTS = {
  'pipeline-aliases': {
    key: 'pipelineAliases',
    child: 'pipeline-alias',
    id: (el) => attr(el, 'pipeline'),
  },
  'character-replacements': {
    key: 'characterReplacements',
    child: 'character-replacement',
    id: (el) => childText(el, 'character'),
  },
  'category-search-refinements': {
    key: 'categorySearchRefinements',
    child: 'url-search-refinement',
    id: (el) => childText(el, 'search-refinement-name'),
  },
  'folder-search-refinements': {
    key: 'folderSearchRefinements',
    child: 'url-search-refinement',
    id: (el) => childText(el, 'search-refinement-name'),
  },
};

function joinRel(...parts) {
  return parts.filter(Boolean).join('/');
}

function readTrim(abs) {
  return readFileSync(abs, 'utf8').replace(/\n$/, '');
}

function scopeKey(block, scope) {
  const prefix = block === 'standard-preferences' ? 'standard' : 'custom';
  const suffix = scope.split('-').map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join('');
  return `${prefix}${suffix}`;
}

export function splitCartridge(dest, fileRel, value) {
  const names = String(value).split(':').map((item) => item.trim()).filter((item) => item.length > 0);
  for (const name of names) {
    if (/[\\/:\s]/.test(name)) throw new Error(`Nom de cartouche illisible : ${name}`);
  }
  if (!names.length) return false;
  writeText(dest, fileRel, `${names.join('\n')}\n`);
  return true;
}

export function readCartridge(file) {
  if (!existsSync(file)) return [];
  if (statSync(file).isDirectory()) {
    throw new Error(`${file} est un dossier. cartridge-path est un fichier, une cartouche par ligne.`);
  }
  const names = [];
  for (const raw of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const name = raw.trim();
    if (!name) continue;
    if (/[\\/:\s]/.test(name)) throw new Error(`Nom de cartouche illisible : ${name}`);
    names.push(name);
  }
  return names;
}

function preferencesPaths(rel) {
  const unitDir = rel.replace(/\.xml$/, '');
  return {
    monolith: rel,
    unitDir,
    wrapper: `${unitDir}/preferences.wrapper.xml`,
  };
}

function splitPreferences(ctx) {
  const root = parseXml(readFileSync(ctx.abs, 'utf8'));
  if (nameOf(root) !== 'preferences') throw new Error(`${ctx.rel} : racine preferences attendue`);
  const paths = preferencesPaths(ctx.rel);
  const org = ctx.rel === 'preferences.xml';
  const blocks = ['<?xml version="1.0" encoding="UTF-8"?>', `<preferences xmlns="${root.getAttribute('xmlns') || PREF_NS}">`];
  let extracted = false;
  for (const blockName of ['standard-preferences', 'custom-preferences']) {
    const block = children(root).find((el) => nameOf(el) === blockName);
    if (!block) continue;
    const scopeLines = [];
    for (const scope of SCOPES) {
      const scopeEl = children(block).find((el) => nameOf(el) === scope);
      if (!scopeEl) continue;
      const prefs = children(scopeEl).filter((el) => nameOf(el) === 'preference');
      for (const extra of children(scopeEl)) {
        if (nameOf(extra) !== 'preference') throw new Error(`${ctx.rel} : <${nameOf(extra)}> inattendu`);
      }
      const kept = [];
      for (const pref of prefs) {
        const id = attr(pref, 'preference-id');
        if (org && scope === 'all-instances' && id === 'CustomCartridges') {
          extracted = splitCartridge(ctx.dest, 'cartridge-path', textOf(pref));
          continue;
        }
        kept.push(pref);
      }
      if (!kept.length && !(org && scope === 'all-instances' && extracted && blockName === 'standard-preferences')) {
        continue;
      }
      const key = scopeKey(blockName, scope);
      for (const pref of kept) {
        const id = attr(pref, 'preference-id');
        writeText(ctx.dest, joinRel(paths.unitDir, blockName, scope, `${sanitize(id)}.xml`), serialize(pref));
      }
      scopeLines.push(`        <${scope}>`, `{${key}}`, `        </${scope}>`);
    }
    if (scopeLines.length) {
      blocks.push(`    <${blockName}>`, ...scopeLines, `    </${blockName}>`);
    }
  }
  blocks.push('</preferences>');
  writeText(ctx.dest, paths.wrapper, `${blocks.join('\n')}\n`);
}

function preferenceChunks(ctx, dirRel, sectionSpec) {
  const dir = path.join(ctx.archiveRoot, dirRel);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((name) => name.endsWith('.xml'))
    .sort(compareNames)
    .flatMap((name) => {
      const fileRel = joinRel(dirRel, name);
      if (!isKept(`${ctx.archiveName}/${fileRel}`, ctx.filter)) return [];
      const text = readTrim(path.join(dir, name));
      assertFragmentText(text, fileRel);
      const [element] = parseFragment(text);
      assertFragmentName(name, element, sectionSpec);
      return [{ name, body: text }];
    });
}

function composePreferences(ctx) {
  const paths = preferencesPaths(ctx.rel);
  const wrapper = readFileSync(path.join(ctx.archiveRoot, paths.wrapper), 'utf8');
  const values = {};
  const keys = [...wrapper.matchAll(/\{([A-Za-z0-9]+)\}/g)].map((match) => match[1]);
  for (const key of keys) {
    const blockName = key.startsWith('standard') ? 'standard-preferences' : 'custom-preferences';
    const scope = key.slice(blockName === 'standard-preferences' ? 'standard'.length : 'custom'.length)
      .replace(/([A-Z])/g, '-$1')
      .toLowerCase()
      .replace(/^-/, '');
    const chunks = preferenceChunks(ctx, joinRel(paths.unitDir, blockName, scope), {
      element: 'preference',
      idAttrs: ['preference-id'],
    });
    if (ctx.rel === 'preferences.xml' && key === 'standardAllInstances') {
      const cartridgeRel = 'cartridge-path';
      const cartridgeFile = path.join(ctx.archiveRoot, cartridgeRel);
      const names = isKept(`${ctx.archiveName}/${cartridgeRel}`, ctx.filter)
        ? readCartridge(cartridgeFile)
        : [];
      if (names.length) {
        chunks.push({
          name: 'CustomCartridges.xml',
          body: `<preference preference-id="CustomCartridges">${escapeText(names.join(':'))}</preference>`,
        });
        chunks.sort((a, b) => compareNames(a.name, b.name));
      }
    }
    values[key] = chunks.map((item) => item.body).join('\n');
  }
  return fillPlaceholders(wrapper, values);
}

function splitSite(ctx) {
  const xml = readFileSync(ctx.abs, 'utf8');
  const match = xml.match(/<custom-cartridges>([\s\S]*?)<\/custom-cartridges>/);
  if (!match || !match[1].trim()) {
    writeText(ctx.dest, ctx.rel, xml.endsWith('\n') ? xml : `${xml}\n`);
    return;
  }
  const site = ctx.rel.split('/')[1];
  splitCartridge(ctx.dest, `sites/${site}/cartridge-path`, match[1].trim());
  const replaced = xml.replace(
    /<custom-cartridges>[\s\S]*?<\/custom-cartridges>/,
    '<custom-cartridges>{cartridgePath}</custom-cartridges>',
  );
  writeText(ctx.dest, ctx.rel, replaced.endsWith('\n') ? replaced : `${replaced}\n`);
}

function composeSite(ctx) {
  const xml = readFileSync(path.join(ctx.archiveRoot, ctx.rel), 'utf8');
  const site = ctx.rel.split('/')[1];
  const rel = `sites/${site}/cartridge-path`;
  const file = path.join(ctx.archiveRoot, rel);
  const hasFile = existsSync(file) && statSync(file).isFile();
  const hasPlaceholder = xml.includes('{cartridgePath}');
  if (hasFile && !hasPlaceholder) {
    throw new Error(`Coexistence de ${ctx.rel} et ${rel}`);
  }
  if (hasPlaceholder && !hasFile) throw new Error(`${ctx.rel} : placeholder sans cartridge-path`);
  if (!hasPlaceholder) return xml.endsWith('\n') ? xml : `${xml}\n`;
  const names = isKept(`${ctx.archiveName}/${rel}`, ctx.filter) ? readCartridge(file) : [];
  return xml.replace('{cartridgePath}', escapeText(names.join(':')));
}

function splitUrlRules(ctx) {
  const root = parseXml(readFileSync(ctx.abs, 'utf8'));
  if (nameOf(root) !== 'url-rules') throw new Error(`${ctx.rel} : racine url-rules attendue`);
  const paths = defaultPaths(ctx.rel);
  const blocks = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<url-rules xmlns="${root.getAttribute('xmlns') || URL_NS}">`,
  ];
  const emitted = new Set();
  for (const child of children(root)) {
    const name = nameOf(child);
    const list = URL_LISTS[name];
    if (!list) {
      blocks.push(serialize(child, '    '));
      continue;
    }
    const lang = attr(child, 'xml:lang') || 'x-default';
    const items = children(child);
    if (!items.length) {
      blocks.push(serialize(child, '    '));
      continue;
    }
    for (const item of items) {
      if (nameOf(item) !== list.child) throw new Error(`${ctx.rel} : <${nameOf(item)}> inattendu dans <${name}>`);
      const id = list.id(item);
      writeText(
        ctx.dest,
        joinRel(paths.unitDir, name, sanitize(lang), `${sanitize(id)}.xml`),
        serialize(item),
      );
    }
    if (!emitted.has(list.key)) {
      blocks.push(`{${list.key}}`);
      emitted.add(list.key);
    }
  }
  blocks.push('</url-rules>');
  writeText(ctx.dest, paths.wrapper, `${blocks.join('\n')}\n`);
}

function composeLangLists(ctx, unitDir, tag, spec) {
  const parent = path.join(ctx.archiveRoot, unitDir, tag);
  if (!existsSync(parent)) return '';
  const langs = readdirSync(parent, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort(compareNames);
  const blocks = [];
  for (const lang of langs) {
    const dirRel = joinRel(unitDir, tag, lang);
    const files = readdirSync(path.join(parent, lang)).filter((name) => name.endsWith('.xml')).sort(compareNames);
    const inner = [];
    for (const file of files) {
      const fileRel = joinRel(dirRel, file);
      if (!isKept(`${ctx.archiveName}/${fileRel}`, ctx.filter)) continue;
      const text = readTrim(path.join(parent, lang, file));
      assertFragmentText(text, fileRel);
      const [element] = parseFragment(text);
      if (nameOf(element) !== spec.child) throw new Error(`${fileRel} : <${spec.child}> attendu`);
      assertFragmentName(file, element, { element: spec.child, stem: () => sanitize(spec.id(element)) });
      inner.push(text.split('\n').map((line) => (line ? `        ${line}` : line)).join('\n'));
    }
    if (!inner.length) continue;
    blocks.push(`    <${tag} xml:lang="${escapeAttr(lang)}">\n${inner.join('\n')}\n    </${tag}>`);
  }
  return blocks.join('\n');
}

function composeUrlRules(ctx) {
  const paths = defaultPaths(ctx.rel);
  const wrapper = readFileSync(path.join(ctx.archiveRoot, paths.wrapper), 'utf8');
  const values = {};
  for (const spec of Object.values(URL_LISTS)) {
    values[spec.key] = composeLangLists(ctx, paths.unitDir, Object.keys(URL_LISTS).find((name) => URL_LISTS[name].key === spec.key), spec);
  }
  return fillPlaceholders(wrapper, values);
}

function splitPageMeta(ctx) {
  const root = parseXml(readFileSync(ctx.abs, 'utf8'));
  if (nameOf(root) !== 'page-meta-tags') throw new Error(`${ctx.rel} : racine page-meta-tags attendue`);
  const paths = defaultPaths(ctx.rel);
  const definitions = children(root).find((el) => nameOf(el) === 'page-meta-tag-definitions');
  const rules = children(root).find((el) => nameOf(el) === 'page-meta-tag-rules');
  const used = new Set();
  if (definitions) {
    for (const el of children(definitions)) {
      if (nameOf(el) !== 'page-meta-tag-definition') throw new Error(`${ctx.rel} : définition inattendue`);
      const id = sanitize(attr(el, 'meta-tag-id'));
      const typed = joinId([attr(el, 'meta-tag-id'), attr(el, 'type')]);
      const stem = used.has(id) ? typed : id;
      used.add(id);
      writeText(ctx.dest, joinRel(paths.unitDir, 'page-meta-tag-definitions', `${stem}.xml`), serialize(el));
    }
  }
  if (rules) {
    for (const pageType of children(rules)) {
      const typeName = nameOf(pageType);
      children(pageType).forEach((el, index) => {
        if (nameOf(el) !== 'page-meta-tag-rule') throw new Error(`${ctx.rel} : règle inattendue`);
        const ruleId = attr(el, 'rule-id');
        const order = orderRank(ctx.ranks, `${paths.unitDir}/${typeName}/${ruleId}`, index + 1, ctx.updateRanks);
        const filename = `${pad(order, orderWidth(order))}-${sanitize(ruleId)}.xml`;
        writeText(ctx.dest, joinRel(paths.unitDir, 'page-meta-tag-rules', typeName, filename), serialize(el));
      });
    }
  }
  const lines = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<page-meta-tags xmlns="${root.getAttribute('xmlns') || META_NS}">`,
  ];
  if (definitions) lines.push('    <page-meta-tag-definitions>', '{definitions}', '    </page-meta-tag-definitions>');
  if (rules) lines.push('    <page-meta-tag-rules>', '{rules}', '    </page-meta-tag-rules>');
  lines.push('</page-meta-tags>');
  writeText(ctx.dest, paths.wrapper, `${lines.join('\n')}\n`);
}

function composePageMeta(ctx) {
  const paths = defaultPaths(ctx.rel);
  const wrapper = readFileSync(path.join(ctx.archiveRoot, paths.wrapper), 'utf8');
  const defDir = joinRel(paths.unitDir, 'page-meta-tag-definitions');
  const defChunks = [];
  const defAbs = path.join(ctx.archiveRoot, defDir);
  if (existsSync(defAbs)) {
    for (const name of readdirSync(defAbs).filter((file) => file.endsWith('.xml')).sort(compareNames)) {
      const fileRel = joinRel(defDir, name);
      if (!isKept(`${ctx.archiveName}/${fileRel}`, ctx.filter)) continue;
      const text = readTrim(path.join(defAbs, name));
      assertFragmentText(text, fileRel);
      const [element] = parseFragment(text);
      const id = sanitize(attr(element, 'meta-tag-id'));
      const typed = joinId([attr(element, 'meta-tag-id'), attr(element, 'type')]);
      const stem = name.replace(/\.xml$/, '').normalize('NFC');
      if (stem !== id && stem !== typed) throw new Error(`${fileRel} : nom de définition inattendu`);
      defChunks.push(text);
    }
  }
  const rulesRoot = path.join(ctx.archiveRoot, paths.unitDir, 'page-meta-tag-rules');
  const ruleBlocks = [];
  if (existsSync(rulesRoot)) {
    const found = readdirSync(rulesRoot, { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => entry.name);
    const ordered = [...PAGE_TYPES.filter((name) => found.includes(name)), ...found.filter((name) => !PAGE_TYPES.includes(name)).sort(compareNames)];
    for (const typeName of ordered) {
      const dir = path.join(rulesRoot, typeName);
      const inner = [];
      for (const name of readdirSync(dir).filter((file) => file.endsWith('.xml')).sort(compareNames)) {
        const fileRel = joinRel(paths.unitDir, 'page-meta-tag-rules', typeName, name);
        if (!isKept(`${ctx.archiveName}/${fileRel}`, ctx.filter)) continue;
        const text = readTrim(path.join(dir, name));
        assertFragmentText(text, fileRel);
        const [element] = parseFragment(text);
        assertFragmentName(name, element, { ordered: true, idAttrs: ['rule-id'] });
        inner.push(text.split('\n').map((line) => (line ? `        ${line}` : line)).join('\n'));
      }
      if (inner.length) {
        ruleBlocks.push(`    <${typeName}>\n${inner.join('\n')}\n    </${typeName}>`);
      }
    }
  }
  return fillPlaceholders(wrapper, { definitions: defChunks.join('\n'), rules: ruleBlocks.join('\n') });
}

function jsonPaths(rel) {
  const unitDir = rel.replace(/\.json$/, '');
  const base = path.basename(unitDir);
  return { monolith: rel, unitDir, wrapper: `${unitDir}/${base}.wrapper.json` };
}

function splitJson(ctx) {
  const text = readFileSync(ctx.abs, 'utf8');
  if (!text.trim()) {
    writeText(ctx.dest, ctx.rel, text);
    return;
  }
  const data = JSON.parse(text);
  if (!Array.isArray(data.clients)) throw new Error(`${ctx.rel} : tableau clients attendu`);
  const paths = jsonPaths(ctx.rel);
  const wrapper = { ...data };
  delete wrapper.clients;
  writeText(ctx.dest, paths.wrapper, `${JSON.stringify(wrapper, null, 2)}\n`);
  const seen = new Set();
  for (const client of data.clients) {
    if (!client.client_id) throw new Error(`${ctx.rel} : client sans client_id`);
    const filename = `${sanitize(client.client_id)}.json`;
    if (seen.has(filename)) throw new Error(`Collision de client ${client.client_id}`);
    seen.add(filename);
    writeText(ctx.dest, joinRel(paths.unitDir, 'clients', filename), `${JSON.stringify(client, null, 2)}\n`);
  }
}

function composeJson(ctx) {
  const paths = jsonPaths(ctx.rel);
  const wrapper = JSON.parse(readFileSync(path.join(ctx.archiveRoot, paths.wrapper), 'utf8'));
  const dir = path.join(ctx.archiveRoot, paths.unitDir, 'clients');
  const clients = existsSync(dir)
    ? readdirSync(dir).filter((name) => name.endsWith('.json')).sort(compareNames).flatMap((name) => {
      const fileRel = joinRel(paths.unitDir, 'clients', name);
      if (!isKept(`${ctx.archiveName}/${fileRel}`, ctx.filter)) return [];
      const client = JSON.parse(readFileSync(path.join(dir, name), 'utf8'));
      if (`${sanitize(client.client_id)}.json` !== name.normalize('NFC')) {
        throw new Error(`${fileRel} : client_id « ${client.client_id} » ne correspond pas au fichier`);
      }
      return [client];
    })
    : [];
  return `${JSON.stringify({ ...wrapper, clients }, null, 2)}\n`;
}

function urlmapStem(route) {
  const stem = sanitize(route);
  if (Buffer.byteLength(stem) <= 200) return stem;
  const hash = createHash('sha1').update(route).digest('hex').slice(0, 10);
  let cut = stem;
  while (Buffer.byteLength(cut) > 160) cut = cut.slice(0, -1);
  return `${cut}-${hash}`;
}

function splitUrlmap(ctx) {
  const lines = readFileSync(ctx.abs, 'utf8').split(/\r?\n/).filter((line) => line.trim());
  const seen = new Map();
  for (const line of lines) {
    const route = line.trim().split(/\s+/)[0];
    const stem = urlmapStem(route);
    let filename = stem;
    let n = 2;
    while (seen.has(filename.toLocaleLowerCase('fr'))) {
      filename = `${stem}--${n}`;
      n += 1;
    }
    seen.set(filename.toLocaleLowerCase('fr'), route);
    writeText(ctx.dest, joinRel(ctx.rel, `${filename}.txt`), `${line}\n`);
  }
}

function composeUrlmap(ctx) {
  const dir = path.join(ctx.archiveRoot, ctx.rel);
  const files = readdirSync(dir).filter((name) => name.endsWith('.txt')).sort(compareNames);
  const lines = [];
  for (const file of files) {
    const fileRel = joinRel(ctx.rel, file);
    if (!isKept(`${ctx.archiveName}/${fileRel}`, ctx.filter)) continue;
    lines.push(readFileSync(path.join(dir, file), 'utf8').replace(/\n$/, ''));
  }
  return `${lines.join('\n')}\n`;
}

export const specialRules = [
  {
    kind: 'transform',
    match: (rel) => /^sites\/[^/]+\/site\.xml$/.test(rel),
    paths: (rel) => ({ monolith: rel, unitDir: rel.replace(/\.xml$/, ''), wrapper: '' }),
    extraConsumed: (rel) => [`sites/${rel.split('/')[1]}/cartridge-path`],
    split: splitSite,
    compose: composeSite,
  },
  {
    kind: 'unit',
    match: (rel) => rel === 'preferences.xml' || /^sites\/[^/]+\/preferences\.xml$/.test(rel),
    paths: preferencesPaths,
    extraConsumed: (rel) => (rel === 'preferences.xml' ? ['cartridge-path'] : []),
    split: splitPreferences,
    compose: composePreferences,
  },
  {
    kind: 'unit',
    match: (rel) => rel === 'url-rules.xml' || /^sites\/[^/]+\/url-rules\.xml$/.test(rel),
    paths: defaultPaths,
    split: splitUrlRules,
    compose: composeUrlRules,
  },
  {
    kind: 'unit',
    match: (rel) => rel === 'pagemetatag.xml' || /^sites\/[^/]+\/pagemetatag\.xml$/.test(rel),
    paths: defaultPaths,
    split: splitPageMeta,
    compose: composePageMeta,
  },
  {
    kind: 'json',
    match: (rel) => /(?:^|\/)wapi_(?:data|shop)_config\.json$/.test(rel) || rel === 'webdav/client_permissions.json',
    paths: jsonPaths,
    split: splitJson,
    compose: composeJson,
  },
  {
    kind: 'urlmap',
    match: (rel) => rel === 'urls/urlmap' || /^sites\/[^/]+\/urls\/urlmap$/.test(rel),
    paths: (rel) => ({ monolith: rel, unitDir: rel, wrapper: '' }),
    split: splitUrlmap,
    compose: composeUrlmap,
  },
];
