import { execFileSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SCOPES = ['development', 'staging', 'production'];
const SCOPE_ORDER = ['all-instances', 'development', 'staging', 'production'];

const ENV_BY_PREFIX = [
  ['STG', 'staging'],
  ['PROD', 'production'],
  ['PRD', 'production'],
  ['DEV', 'development'],
  ['SB', 'development'],
];

export function envFromExportName(name) {
  const base = path.basename(name).replace(/\.zip$/i, '');
  const upper = base.toUpperCase();
  const match = ENV_BY_PREFIX.find(([prefix]) => upper.startsWith(prefix));
  return match ? match[1] : null;
}

export function findExportRoot(dir) {
  if (isExportRoot(dir)) return dir;
  const names = readdirSync(dir).filter((entry) => entry !== '__MACOSX' && !entry.startsWith('.'));
  if (names.length === 1) {
    const nested = path.join(dir, names[0]);
    if (statSync(nested).isDirectory() && isExportRoot(nested)) return nested;
  }
  throw new Error(`Racine d'export introuvable dans ${dir}`);
}

export function applyExport({ exportRoot, dataRoot, env, mode }) {
  if (!SCOPES.includes(env)) throw new Error(`Environnement inconnu : ${env}`);
  if (mode !== 'merge' && mode !== 'replace') throw new Error(`Mode inconnu : ${mode}`);
  const written = [];
  for (const rel of walkFiles(exportRoot)) {
    const sourcePath = path.join(exportRoot, rel);
    for (const destRel of destinations(rel)) {
      const destPath = path.join(dataRoot, destRel);
      const next = renderFile(sourcePath, destPath, env, mode);
      if (next == null) continue;
      mkdirSync(path.dirname(destPath), { recursive: true });
      writeFileSync(destPath, next);
      written.push(destRel);
    }
  }
  return { written };
}

export function scopeOuterXml(xml, parentPath, scopeName) {
  const element = scopeBlocks(scanXml(xml)).find((entry) => (
    entry.name === scopeName && parentPathOf(entry) === parentPath
  ));
  return element ? xml.slice(element.start, element.end) : null;
}

function isExportRoot(dir) {
  return [
    'meta',
    'sites',
    'libraries',
    'catalogs',
    'jobs.xml',
    'services.xml',
    'preferences.xml',
    'version.txt',
    'ecom-data-meta',
    'ecom-data-sites',
  ].some((name) => existsSync(path.join(dir, name)));
}

function walkFiles(dir, base = '') {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === '.DS_Store' || entry.name === '__MACOSX') continue;
    const rel = base ? `${base}/${entry.name}` : entry.name;
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walkFiles(abs, rel));
    else if (entry.isFile()) out.push(rel);
  }
  return out;
}

function destinations(rel) {
  const norm = rel.split(path.sep).join('/');
  if (norm.startsWith('ecom-data-meta/') || norm.startsWith('ecom-data-sites/')) return [norm];
  if (norm === 'version.txt') return ['ecom-data-meta/version.txt', 'ecom-data-sites/version.txt'];
  if (norm.startsWith('meta/')) return [`ecom-data-meta/${norm}`];
  return [`ecom-data-sites/${norm}`];
}

function renderFile(sourcePath, destPath, env, mode) {
  const source = readFileSync(sourcePath);
  const hasTarget = existsSync(destPath);
  const target = hasTarget ? readFileSync(destPath) : null;
  if (!sourcePath.toLowerCase().endsWith('.xml')) {
    if (target && source.equals(target)) return null;
    return source;
  }
  const sourceXml = source.toString('utf8').replace(/^\uFEFF/, '');
  const targetXml = target ? target.toString('utf8').replace(/^\uFEFF/, '') : null;
  const next = mode === 'replace'
    ? replaceXml(sourceXml, targetXml, env)
    : mergeXml(sourceXml, targetXml, env);
  if (targetXml != null && next === targetXml) return null;
  return next.endsWith('\n') ? next : `${next}\n`;
}

function replaceXml(sourceXml, targetXml, env) {
  if (!targetXml) return stripScopes(sourceXml, env);
  if (!hasScope(sourceXml) && !hasScope(targetXml)) return sourceXml;
  return restoreScopes(sourceXml, targetXml, env);
}

function mergeXml(sourceXml, targetXml, env) {
  if (!targetXml) return stripScopes(sourceXml, env);
  const sourceRoots = scanXml(sourceXml);
  const targetRoots = scanXml(targetXml);
  const targetIds = indexIdentified(targetRoots, env);
  const edits = [];
  let seq = 0;
  const inserts = new Map();

  const rememberInsert = (parent, element) => {
    if (!parent) return;
    const list = inserts.get(parent) ?? [];
    list.push(element);
    inserts.set(parent, list);
  };

  const walk = (nodes) => {
    for (const element of nodes) {
      if (isDisallowedScope(element, env)) continue;
      if (SCOPES.includes(element.name)) {
        const found = targetIds.scopes.get(scopeKey(element));
        if (!found) rememberInsert(targetParent(element, targetIds), element);
        else walk(element.children);
        continue;
      }
      const id = identityOf(element);
      if (id && element.parent) {
        const found = targetIds.byId.get(elementKey(element));
        if (!found) rememberInsert(targetParent(element, targetIds), element);
        else if (sourceXml.slice(element.start, element.end) !== targetXml.slice(found.start, found.end)) {
          edits.push({
            start: found.start,
            end: found.end,
            text: sourceXml.slice(element.start, element.end),
            seq: seq++,
          });
        }
        continue;
      }
      if (isSingletonLeaf(element)) {
        const found = targetIds.singletons.get(elementKey(element));
        if (!found) rememberInsert(targetParent(element, targetIds), element);
        else if (sourceXml.slice(element.start, element.end) !== targetXml.slice(found.start, found.end)) {
          edits.push({
            start: found.start,
            end: found.end,
            text: sourceXml.slice(element.start, element.end),
            seq: seq++,
          });
        }
        continue;
      }
      walk(element.children);
    }
  };
  walk(sourceRoots);

  for (const [parent, elements] of inserts) {
    edits.push(insertEdit(targetXml, parent, sourceXml, elements, seq++));
  }
  if (!edits.length) return targetXml;
  return applyEdits(targetXml, edits);
}

function restoreScopes(sourceXml, targetXml, env) {
  const sourceRoots = scanXml(sourceXml);
  const sourceBlocks = scopeBlocks(sourceRoots);
  const targetBlocks = scopeBlocks(scanXml(targetXml));
  const edits = [];
  let seq = 0;
  for (const block of sourceBlocks) {
    if (block.name === env) continue;
    const kept = targetBlocks.find((entry) => scopeKey(entry) === scopeKey(block));
    const range = blockRange(sourceXml, block);
    edits.push({
      start: range.start,
      end: range.end,
      text: kept ? targetXml.slice(blockRange(targetXml, kept).start, blockRange(targetXml, kept).end) : '',
      seq: seq++,
    });
  }
  const missing = targetBlocks.filter((block) => (
    block.name !== env && !sourceBlocks.some((entry) => scopeKey(entry) === scopeKey(block))
  ));
  const missingByParent = new Map();
  for (const block of missing) {
    const key = parentPathOf(block);
    const list = missingByParent.get(key) ?? [];
    list.push(block);
    missingByParent.set(key, list);
  }
  for (const [parentPath, blocks] of missingByParent) {
    const parent = findByPath(sourceRoots, parentPath);
    if (!parent) continue;
    const ordered = [...blocks].sort((a, b) => SCOPE_ORDER.indexOf(a.name) - SCOPE_ORDER.indexOf(b.name));
    const anchor = insertAnchor(sourceXml, parent, ordered[0].name);
    const text = ordered.map((block) => targetXml.slice(
      blockRange(targetXml, block).start,
      blockRange(targetXml, block).end,
    )).join('');
    edits.push({ start: anchor, end: anchor, text, seq: seq++ });
  }
  return applyEdits(sourceXml, edits);
}

function stripScopes(xml, env) {
  const edits = scopeBlocks(scanXml(xml))
    .filter((block) => block.name !== env)
    .map((block, seq) => {
      const range = blockRange(xml, block);
      return { start: range.start, end: range.end, text: '', seq };
    });
  return edits.length ? applyEdits(xml, edits) : xml;
}

function insertEdit(targetXml, parent, sourceXml, elements, seq) {
  const indent = childIndent(targetXml, parent);
  const bodies = elements.map((element) => sourceXml.slice(element.start, element.end));
  if (parent.selfClosing) {
    const raw = targetXml.slice(parent.start, parent.end).replace(/\s*\/\s*>$/, '>');
    const kids = bodies.map((body) => `${indent}${body}`).join('\n');
    const own = indentAt(targetXml, parent);
    return {
      start: parent.start,
      end: parent.end,
      text: `${raw}\n${kids}\n${own}</${parent.name}>`,
      seq,
    };
  }
  const line = closingLine(targetXml, parent);
  return {
    start: line.start,
    end: parent.closeStart,
    text: `${bodies.map((body) => `${indent}${body}`).join('\n')}\n${line.indent}`,
    seq,
  };
}

function closingLine(xml, parent) {
  let cursor = parent.closeStart - 1;
  while (cursor >= 0 && (xml[cursor] === ' ' || xml[cursor] === '\t')) cursor -= 1;
  if (cursor >= 0 && xml[cursor] === '\n') {
    return { start: cursor + 1, indent: xml.slice(cursor + 1, parent.closeStart) };
  }
  return { start: parent.closeStart, indent: '' };
}

function insertAnchor(xml, parent, scopeName) {
  const later = parent.children.find((child) => (
    SCOPE_ORDER.includes(child.name) && SCOPE_ORDER.indexOf(child.name) > SCOPE_ORDER.indexOf(scopeName)
  ));
  if (later) return blockRange(xml, later).start;
  return parent.closeStart;
}

function hasScope(xml) {
  return scopeBlocks(scanXml(xml)).length > 0;
}

function isDisallowedScope(element, env) {
  return SCOPES.includes(element.name) && element.name !== env;
}

function scopeBlocks(nodes, acc = []) {
  for (const element of nodes) {
    if (SCOPES.includes(element.name)) acc.push(element);
    else scopeBlocks(element.children, acc);
  }
  return acc;
}

function indexIdentified(nodes, env) {
  const byId = new Map();
  const singletons = new Map();
  const scopes = new Map();
  const byPath = new Map();
  const walk = (list) => {
    for (const element of list) {
      byPath.set(pathOf(element), element);
      if (isDisallowedScope(element, env)) continue;
      if (SCOPES.includes(element.name)) scopes.set(scopeKey(element), element);
      const id = identityOf(element);
      if (id && element.parent) byId.set(elementKey(element), element);
      else if (isSingletonLeaf(element)) singletons.set(elementKey(element), element);
      walk(element.children);
    }
  };
  walk(nodes);
  return { byId, singletons, scopes, byPath };
}

function targetParent(sourceElement, targetIds) {
  if (!sourceElement.parent) return null;
  return targetIds.byPath.get(pathOf(sourceElement.parent)) ?? null;
}

function identityOf(element) {
  const ids = element.attrs.filter((attr) => (
    attr.name === 'id' || attr.name.endsWith('-id') || attr.name === 'lang'
  ));
  if (!ids.length) return null;
  return ids.map((attr) => `${attr.name}=${attr.value}`).sort().join('&');
}

function isSingletonLeaf(element) {
  if (!element.parent || identityOf(element) || element.children.length || SCOPES.includes(element.name)) {
    return false;
  }
  const same = element.parent.children.filter((entry) => entry.name === element.name && !identityOf(entry));
  return same.length === 1;
}

function elementKey(element) {
  return `${parentPathOf(element)}|${element.name}|${identityOf(element) ?? 'singleton'}`;
}

function scopeKey(element) {
  return `${parentPathOf(element)}|${element.name}`;
}

function parentPathOf(element) {
  const parts = [];
  for (let node = element.parent; node; node = node.parent) parts.push(node.name);
  return parts.reverse().join('/');
}

function pathOf(element) {
  const id = identityOf(element);
  const own = id ? `${element.name}[${id}]` : element.name;
  const parent = parentPathOf(element);
  return parent ? `${parent}/${own}` : own;
}

function findByPath(roots, elementPath) {
  if (!elementPath) return roots[0] ?? null;
  const parts = elementPath.split('/');
  let nodes = roots;
  let current = null;
  for (const name of parts) {
    current = nodes.find((element) => element.name === name);
    if (!current) return null;
    nodes = current.children;
  }
  return current;
}

function blockRange(xml, element) {
  let start = element.start;
  let cursor = start - 1;
  while (cursor >= 0 && (xml[cursor] === ' ' || xml[cursor] === '\t')) cursor -= 1;
  if (cursor >= 0 && xml[cursor] === '\n') start = cursor;
  return { start, end: element.end };
}

function indentAt(xml, element) {
  let indent = '';
  for (let cursor = element.start - 1; cursor >= 0 && (xml[cursor] === ' ' || xml[cursor] === '\t'); cursor -= 1) {
    indent = xml[cursor] + indent;
  }
  return indent;
}

function childIndent(xml, parent) {
  const child = parent.children[0];
  if (child) return indentAt(xml, child);
  return `${indentAt(xml, parent)}    `;
}

function applyEdits(xml, edits) {
  const ranged = edits.filter((edit) => edit.end > edit.start).sort((a, b) => a.start - b.start);
  for (let i = 1; i < ranged.length; i += 1) {
    if (ranged[i].start < ranged[i - 1].end) {
      throw new Error('Chevauchement en appliquant l\'export');
    }
  }
  const combined = [];
  const ordered = [...edits].sort((a, b) => a.start - b.start || a.seq - b.seq);
  for (const edit of ordered) {
    const prev = combined[combined.length - 1];
    if (prev && prev.start === edit.start && prev.end === edit.end) prev.text += edit.text;
    else combined.push({ ...edit });
  }
  combined.sort((a, b) => b.start - a.start);
  let out = xml;
  for (const edit of combined) {
    out = out.slice(0, edit.start) + edit.text + out.slice(edit.end);
  }
  return out;
}

function scanXml(xml) {
  const roots = [];
  const stack = [];
  let cursor = 0;
  while (cursor < xml.length) {
    if (xml.startsWith('<?', cursor)) {
      cursor = xml.indexOf('?>', cursor);
      if (cursor < 0) throw new Error('XML illisible');
      cursor += 2;
      continue;
    }
    if (xml.startsWith('<!--', cursor)) {
      cursor = xml.indexOf('-->', cursor);
      if (cursor < 0) throw new Error('XML illisible');
      cursor += 3;
      continue;
    }
    if (xml.startsWith('<![CDATA[', cursor)) {
      cursor = xml.indexOf(']]>', cursor);
      if (cursor < 0) throw new Error('XML illisible');
      cursor += 3;
      continue;
    }
    if (xml.startsWith('<!', cursor)) {
      cursor = xml.indexOf('>', cursor);
      if (cursor < 0) throw new Error('XML illisible');
      cursor += 1;
      continue;
    }
    if (xml[cursor] !== '<') {
      cursor += 1;
      continue;
    }
    if (xml[cursor + 1] === '/') {
      const end = xml.indexOf('>', cursor);
      const name = localName(xml.slice(cursor + 2, end).trim());
      const element = stack.pop();
      if (!element || element.name !== name) throw new Error(`Balise fermante inattendue : ${name}`);
      element.end = end + 1;
      element.closeStart = cursor;
      cursor = end + 1;
      continue;
    }
    const end = findTagEnd(xml, cursor);
    const raw = xml.slice(cursor + 1, end);
    const selfClosing = /\/\s*$/.test(raw);
    const body = selfClosing ? raw.replace(/\/\s*$/, '') : raw;
    const name = localName(body.match(/^[\w:.-]+/)?.[0] ?? '');
    if (!name) throw new Error('Balise illisible');
    const element = {
      name,
      attrs: parseAttrs(body),
      start: cursor,
      end: selfClosing ? end + 1 : -1,
      closeStart: selfClosing ? cursor : -1,
      selfClosing,
      parent: stack.at(-1) ?? null,
      children: [],
    };
    if (element.parent) element.parent.children.push(element);
    else roots.push(element);
    if (!selfClosing) stack.push(element);
    cursor = end + 1;
  }
  if (stack.length) throw new Error(`Balise non fermée : ${stack.at(-1).name}`);
  return roots;
}

function findTagEnd(xml, start) {
  let quote = '';
  for (let cursor = start + 1; cursor < xml.length; cursor += 1) {
    const char = xml[cursor];
    if (quote) {
      if (char === quote) quote = '';
      continue;
    }
    if (char === '"' || char === '\'') {
      quote = char;
      continue;
    }
    if (char === '>') return cursor;
  }
  throw new Error('Balise non fermée');
}

function parseAttrs(body) {
  const attrs = [];
  const pattern = /([\w:.-]+)\s*=\s*("([^"]*)"|'([^']*)')/g;
  let match = pattern.exec(body);
  while (match) {
    attrs.push({ name: localName(match[1]), value: match[3] ?? match[4] ?? '' });
    match = pattern.exec(body);
  }
  return attrs;
}

function localName(name) {
  return String(name).replace(/^.*:/, '');
}

function listDrops(dir) {
  return readdirSync(dir, { withFileTypes: true })
    .filter((entry) => !entry.name.startsWith('.') && !entry.name.endsWith('.sh'))
    .filter((entry) => entry.isDirectory() || entry.name.toLowerCase().endsWith('.zip'))
    .map((entry) => entry.name)
    .sort((a, b) => a.localeCompare(b, 'fr'));
}

export function runApply(argv) {
  const args = argv;
  const mode = readArg(args, '--mode');
  const dir = path.resolve(readArg(args, '--dir'));
  if (mode !== 'merge' && mode !== 'replace') {
    throw new Error('Usage: sfcc-data apply-export --mode merge|replace --dir <dossier> [--data-root <ecom-data>]');
  }
  const drops = listDrops(dir);
  if (!drops.length) {
    console.log('Aucun export dans le dossier. Déposer un zip ou un dossier dont le nom commence par STG, PROD, PRD, DEV ou SB.');
    return;
  }
  const unknown = drops.filter((name) => !envFromExportName(name));
  if (unknown.length) {
    throw new Error(`Nom refusé : ${unknown.join(', ')}. Le nom doit commencer par STG, PROD, PRD, DEV ou SB.`);
  }
  const dataRoot = path.resolve(readOptional(args, '--data-root') || path.resolve(dir, '..'));
  for (const name of drops) {
    const env = envFromExportName(name);
    const abs = path.join(dir, name);
    console.log(`${name} → ${label(env)} (${mode})`);
    const written = withExport(abs, (exportRoot) => applyExport({ exportRoot, dataRoot, env, mode }).written);
    if (!written.length) console.log('  aucun fichier modifié');
    for (const rel of written) console.log(`  ${rel}`);
  }
}

function label(env) {
  if (env === 'staging') return 'partagé + staging';
  if (env === 'production') return 'partagé + production';
  return 'partagé + development';
}

function withExport(abs, run) {
  if (statSync(abs).isDirectory()) return run(findExportRoot(abs));
  const tmp = path.join(os.tmpdir(), `site-export-${process.pid}-${Date.now()}`);
  mkdirSync(tmp, { recursive: true });
  try {
    execFileSync('unzip', ['-q', abs, '-d', tmp], { stdio: 'inherit' });
    return run(findExportRoot(tmp));
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

function readOptional(args, flag) {
  const index = args.indexOf(flag);
  if (index < 0) return '';
  const value = args[index + 1];
  if (!value || value.startsWith('--')) throw new Error(`${flag} attend une valeur`);
  return value;
}

function readArg(args, flag) {
  const index = args.indexOf(flag);
  const value = index >= 0 ? args[index + 1] : '';
  if (!value || value.startsWith('--')) throw new Error(`${flag} attend une valeur`);
  return value;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  try {
    runApply(process.argv.slice(2));
  } catch (error) {
    console.error(error.message || error);
    process.exit(1);
  }
}
