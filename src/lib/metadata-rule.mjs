import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { isKept } from './filter.mjs';
import { compareNames, pad, sanitize } from './names.mjs';
import { fillPlaceholders } from './placeholders.mjs';
import { orderRank, typeRank } from './ranks.mjs';
import {
  assertFragmentText,
  attr,
  children,
  nameOf,
  parseFragment,
  parseXml,
  serialize,
} from './xml.mjs';
import { assertFragmentName, writeText } from './list-rule.mjs';

const NS = 'http://www.demandware.com/xml/impex/metadata/2006-10-31';
const HEADER = new Set([
  'display-name',
  'description',
  'staging-mode',
  'storage-scope',
  'retention-days',
  'key-definition',
]);

function joinRel(...parts) {
  return parts.filter(Boolean).join('/');
}

function readTrim(abs) {
  return readFileSync(abs, 'utf8').replace(/\n$/, '');
}

export function systemWrapper(typeId, present) {
  if (!present.length) return `<type-extension type-id="${typeId}"/>`;
  const lines = [`<type-extension type-id="${typeId}">`];
  for (const item of present) {
    lines.push(`    <${item.tag}>`);
    lines.push(`{${item.key}}`);
    lines.push(`    </${item.tag}>`);
  }
  lines.push('</type-extension>');
  return lines.join('\n');
}

export function customWrapper(typeId, hasAttributes, hasGroups) {
  const lines = [`<custom-type type-id="${typeId}">`, '{header}'];
  if (hasAttributes) {
    lines.push('    <attribute-definitions>', '{attributeDefinitions}', '    </attribute-definitions>');
  }
  if (hasGroups) {
    lines.push('    <group-definitions>', '{groupDefinition}', '    </group-definitions>');
  }
  lines.push('</custom-type>');
  return lines.join('\n');
}

function writeRanked({ dest, ranks, updateRanks, sequence, typeId, groups, folderRel }) {
  const width = ranks.data.width || 3;
  const rank = typeRank(ranks, sequence, typeId, updateRanks);
  const folder = `${pad(rank, width)}-${typeId}`;
  const unit = joinRel(folderRel, folder);
  const seen = new Set();
  const writeGroup = (tag, key, role, elements, ordered) => {
    if (!elements.length) return;
    elements.forEach((el, index) => {
      const id = attr(el, role === 'G' ? 'group-id' : 'attribute-id');
      const position = index + 1;
      let order = position;
      if (ordered) {
        order = orderRank(ranks, `${sequence}/${typeId}/group-definitions/${id}`, position, updateRanks);
      }
      const stem = sanitize(id);
      const filename = ordered
        ? `${pad(rank, width)}-${role}-${pad(order, 2)}-${stem}.xml`
        : `${pad(rank, width)}-${role}-${stem}.xml`;
      const dir = ordered ? 'group-definitions' : tag;
      const fileRel = joinRel(unit, dir, filename);
      const fold = fileRel.normalize('NFC').toLocaleLowerCase('fr');
      if (seen.has(fold)) throw new Error(`Collision de nom ${fileRel} (${id})`);
      seen.add(fold);
      writeText(dest, fileRel, serialize(el));
    });
  };
  writeGroup('system-attribute-definitions', 'systemAttributeDefinitions', 'SA', groups.system ?? [], false);
  writeGroup('custom-attribute-definitions', 'customAttributeDefinitions', 'CA', groups.custom ?? [], false);
  writeGroup('attribute-definitions', 'attributeDefinitions', 'CA', groups.attributes ?? [], false);
  writeGroup('group-definitions', 'groupDefinition', 'G', groups.groups ?? [], true);
  return { unit, folder, rank };
}

function splitTypes(ctx, { elementName, sequence, custom }) {
  const root = parseXml(readFileSync(ctx.abs, 'utf8'));
  if (nameOf(root) !== 'metadata') throw new Error(`${ctx.rel} : racine metadata attendue`);
  const unitDir = ctx.rel.replace(/\.xml$/, '');
  const bodies = [];
  for (const typeEl of children(root)) {
    if (nameOf(typeEl) !== elementName) {
      throw new Error(`${ctx.rel} : <${nameOf(typeEl)}> inattendu`);
    }
    const typeId = attr(typeEl, 'type-id');
    if (!typeId || /[\\/]/.test(typeId)) throw new Error(`${ctx.rel} : type-id illisible (${typeId})`);
    const groups = { system: [], custom: [], attributes: [], groups: [] };
    const header = [];
    for (const child of children(typeEl)) {
      const name = nameOf(child);
      if (custom && HEADER.has(name)) {
        header.push(child);
        continue;
      }
      if (name === 'system-attribute-definitions') groups.system.push(...children(child));
      else if (name === 'custom-attribute-definitions') groups.custom.push(...children(child));
      else if (name === 'attribute-definitions') groups.attributes.push(...children(child));
      else if (name === 'group-definitions') groups.groups.push(...children(child));
      else throw new Error(`${ctx.rel} / ${typeId} : <${name}> sans règle`);
    }
    const written = writeRanked({
      dest: ctx.dest,
      ranks: ctx.ranks,
      updateRanks: ctx.updateRanks,
      sequence,
      typeId,
      groups,
      folderRel: unitDir,
    });
    if (custom) {
      if (!header.length) throw new Error(`${typeId} : header vide`);
      writeText(ctx.dest, joinRel(written.unit, 'header.xml'), header.map((el) => serialize(el)).join('\n'));
      writeText(ctx.dest, joinRel(written.unit, `${written.folder}.wrapper.xml`), customWrapper(
        typeId,
        groups.attributes.length > 0,
        groups.groups.length > 0,
      ));
    } else {
      const present = [];
      if (groups.system.length) present.push({ tag: 'system-attribute-definitions', key: 'systemAttributeDefinitions' });
      if (groups.custom.length) present.push({ tag: 'custom-attribute-definitions', key: 'customAttributeDefinitions' });
      if (groups.groups.length) present.push({ tag: 'group-definitions', key: 'groupDefinition' });
      writeText(ctx.dest, joinRel(written.unit, `${written.folder}.wrapper.xml`), systemWrapper(typeId, present));
    }
    bodies.push(written.unit);
  }
  const wrapper = `<?xml version="1.0" encoding="UTF-8"?>
<metadata xmlns="${NS}">
{0}
</metadata>
`;
  writeText(ctx.dest, joinRel(unitDir, `${path.basename(unitDir)}.wrapper.xml`), wrapper);
}

function listXml(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((name) => name.endsWith('.xml') && !name.endsWith('.wrapper.xml')).sort(compareNames);
}

function composeSection(archiveRoot, dirRel, archiveName, filter, sectionSpec) {
  const names = listXml(path.join(archiveRoot, dirRel));
  const chunks = [];
  for (const name of names) {
    const fileRel = joinRel(dirRel, name);
    if (!isKept(`${archiveName}/${fileRel}`, filter)) continue;
    const text = readTrim(path.join(archiveRoot, fileRel));
    assertFragmentText(text, fileRel);
    const [element] = parseFragment(text);
    if (!element) throw new Error(`${fileRel} : fragment vide`);
    assertFragmentName(name, element, sectionSpec);
    chunks.push(text);
  }
  return chunks.join('\n');
}

function composeTypes(ctx, { elementName, custom }) {
  const unitDir = ctx.rel.replace(/\.xml$/, '');
  const wrapperRel = joinRel(unitDir, `${path.basename(unitDir)}.wrapper.xml`);
  if (!isKept(`${ctx.archiveName}/${wrapperRel}`, ctx.filter)) return null;
  const wrapper = readFileSync(path.join(ctx.archiveRoot, wrapperRel), 'utf8');
  const folders = existsSync(path.join(ctx.archiveRoot, unitDir))
    ? readdirSync(path.join(ctx.archiveRoot, unitDir), { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && /^\d+-/.test(entry.name))
      .map((entry) => entry.name)
      .sort(compareNames)
    : [];
  const units = [];
  for (const folder of folders) {
    const typeDir = joinRel(unitDir, folder);
    const typeWrapperRel = joinRel(typeDir, `${folder}.wrapper.xml`);
    if (!isKept(`${ctx.archiveName}/${typeWrapperRel}`, ctx.filter)) continue;
    const typeWrapper = readTrim(path.join(ctx.archiveRoot, typeWrapperRel));
    const typeId = typeWrapper.match(/type-id="([^"]+)"/)?.[1];
    const suffix = folder.replace(/^\d+-/, '');
    if (!typeId || typeId !== suffix) {
      throw new Error(`${folder} : le type-id du wrapper doit être ${suffix}`);
    }
    const values = { header: '' };
    if (custom) {
      const headerRel = joinRel(typeDir, 'header.xml');
      if (!existsSync(path.join(ctx.archiveRoot, headerRel))) throw new Error(`${headerRel} obligatoire`);
      const header = readTrim(path.join(ctx.archiveRoot, headerRel));
      assertFragmentText(header, headerRel);
      values.header = header;
      values.attributeDefinitions = composeSection(
        ctx.archiveRoot,
        joinRel(typeDir, 'attribute-definitions'),
        ctx.archiveName,
        ctx.filter,
        { role: 'CA', element: 'attribute-definition', idAttrs: ['attribute-id'] },
      );
      values.groupDefinition = composeSection(
        ctx.archiveRoot,
        joinRel(typeDir, 'group-definitions'),
        ctx.archiveName,
        ctx.filter,
        { role: 'G', ordered: true, element: 'attribute-group', idAttrs: ['group-id'] },
      );
    } else {
      values.systemAttributeDefinitions = composeSection(
        ctx.archiveRoot,
        joinRel(typeDir, 'system-attribute-definitions'),
        ctx.archiveName,
        ctx.filter,
        { role: 'SA', element: 'attribute-definition', idAttrs: ['attribute-id'] },
      );
      values.customAttributeDefinitions = composeSection(
        ctx.archiveRoot,
        joinRel(typeDir, 'custom-attribute-definitions'),
        ctx.archiveName,
        ctx.filter,
        { role: 'CA', element: 'attribute-definition', idAttrs: ['attribute-id'] },
      );
      values.groupDefinition = composeSection(
        ctx.archiveRoot,
        joinRel(typeDir, 'group-definitions'),
        ctx.archiveName,
        ctx.filter,
        { role: 'G', ordered: true, element: 'attribute-group', idAttrs: ['group-id'] },
      );
    }
    const filled = fillPlaceholders(`${typeWrapper}\n`, values).replace(/\n$/, '');
    if (!filled.includes(`type-id="${typeId}"`)) throw new Error(`${folder} : wrapper illisible`);
    if (!filled.includes(elementName === 'custom-type' ? '<custom-type' : '<type-extension')) {
      throw new Error(`${folder} : ${elementName} attendu`);
    }
    units.push(filled);
  }
  return fillPlaceholders(wrapper, { 0: units.join('\n') });
}

export const metadataRules = [
  {
    kind: 'unit',
    match: (rel) => rel === 'meta/system-objecttype-extensions.xml',
    paths: (rel) => ({
      monolith: rel,
      unitDir: 'meta/system-objecttype-extensions',
      wrapper: 'meta/system-objecttype-extensions/system-objecttype-extensions.wrapper.xml',
    }),
    split: (ctx) => splitTypes(ctx, { elementName: 'type-extension', sequence: 'system-objecttype-extensions' }),
    compose: (ctx) => composeTypes(ctx, { elementName: 'type-extension' }),
  },
  {
    kind: 'unit',
    match: (rel) => rel === 'meta/custom-objecttype-definitions.xml',
    paths: (rel) => ({
      monolith: rel,
      unitDir: 'meta/custom-objecttype-definitions',
      wrapper: 'meta/custom-objecttype-definitions/custom-objecttype-definitions.wrapper.xml',
    }),
    split: (ctx) => splitTypes(ctx, {
      elementName: 'custom-type',
      sequence: 'custom-objecttype-definitions',
      custom: true,
    }),
    compose: (ctx) => composeTypes(ctx, { elementName: 'custom-type', custom: true }),
  },
];
