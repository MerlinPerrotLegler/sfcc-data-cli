import { attr, childText, children, nameOf, textOf } from './xml.mjs';

const SCOPES = new Set(['all-instances', 'development', 'staging', 'production']);

function keyOf(el) {
  const name = nameOf(el);
  switch (name) {
    case 'attribute-definition':
    case 'preference':
    case 'preference-definition':
      return attr(el, name === 'preference' || name === 'preference-definition' ? 'preference-id' : 'attribute-id');
    case 'job':
      return attr(el, 'job-id');
    case 'service-credential':
      return attr(el, 'service-credential-id');
    case 'service-profile':
      return attr(el, 'service-profile-id');
    case 'service':
      return attr(el, 'service-id');
    case 'customer-group':
    case 'sourcecode-group':
      return attr(el, 'group-id');
    case 'group-assignment':
      return `${attr(el, 'group-id')}__${attr(el, 'customer-no')}`;
    case 'payment-processor':
      return attr(el, 'processor-id');
    case 'tax-class':
      return attr(el, 'class-id');
    case 'tax-jurisdiction':
      return attr(el, 'jurisdiction-id');
    case 'tax-rate':
      return `${attr(el, 'jurisdiction-id')}__${attr(el, 'class-id')}`;
    case 'searchable-attribute':
      return childText(el, 'attribute-path');
    case 'stopword-list':
    case 'synonym-list':
    case 'hypernym-list':
    case 'suggestion-list':
    case 'compound-word-list':
    case 'common-phrase-list':
    case 'category-exclusion-list':
    case 'stemming-exception-list':
    case 'pipeline-aliases':
    case 'character-replacements':
    case 'category-search-refinements':
    case 'folder-search-refinements':
      return attr(el, 'xml:lang');
    case 'folder':
      return attr(el, 'folder-id');
    case 'content':
      return attr(el, 'content-id');
    case 'slot-configuration':
      return [attr(el, 'slot-id'), attr(el, 'context'), attr(el, 'context-id'), attr(el, 'configuration-id')].filter(Boolean).join('__');
    case 'slot-configuration-campaign-assignment':
      return [attr(el, 'slot-id'), attr(el, 'context'), attr(el, 'context-id'), attr(el, 'configuration-id'), attr(el, 'campaign-id')].filter(Boolean).join('__');
    case 'custom-object':
      return attr(el, 'object-id');
    case 'category':
      return attr(el, 'category-id');
    case 'product':
    case 'price-table':
    case 'record':
      return attr(el, 'product-id');
    case 'product-option':
      return attr(el, 'option-id');
    case 'variation-attribute':
      return attr(el, 'variation-attribute-id') || attr(el, 'attribute-id');
    case 'category-assignment':
      return `${attr(el, 'category-id')}__${attr(el, 'product-id')}`;
    case 'recommendation':
      return [attr(el, 'source-id'), attr(el, 'source-type'), attr(el, 'target-id'), attr(el, 'type')].join('__');
    case 'customer':
      return attr(el, 'customer-no');
    case 'campaign':
      return attr(el, 'campaign-id');
    case 'promotion':
      return attr(el, 'promotion-id');
    case 'promotion-campaign-assignment':
      return `${attr(el, 'promotion-id')}__${attr(el, 'campaign-id')}`;
    case 'coupon':
    case 'coupon-codes':
      return attr(el, 'coupon-id');
    case 'store':
      return attr(el, 'store-id');
    case 'store-group':
      return attr(el, 'store-group-id');
    case 'ab-test':
      return attr(el, 'test-id');
    case 'user':
      return attr(el, 'login');
    case 'access-role':
      return attr(el, 'role-id');
    case 'locale':
      return attr(el, 'locale-id');
    case 'pipeline-alias':
      return attr(el, 'pipeline');
    case 'character-replacement':
      return childText(el, 'character');
    case 'url-search-refinement':
      return childText(el, 'search-refinement-name');
    case 'page-meta-tag-definition':
      return `${attr(el, 'meta-tag-id')}__${attr(el, 'type')}`;
    case 'dynamic-attribute':
      return attr(el, 'dynamic-attribute-id');
    case 'sorting-rule':
      return attr(el, 'rule-id');
    case 'sorting-rule-assignment':
    case 'keyword-search-sorting-rule-assignment':
      return `${attr(el, 'rule-id')}__${attr(el, 'category-id') || attr(el, 'keyword-group-id')}`;
    case 'sorting-rule-campaign-assignment':
    case 'keyword-search-sorting-rule-campaign-assignment':
      return `${attr(el, 'rule-id')}__${attr(el, 'category-id') || attr(el, 'keyword-group-id')}__${attr(el, 'campaign-id')}`;
    case 'boost-bury-rule':
      return attr(el, 'rule-id');
    case 'custom-preference-group':
      return attr(el, 'group-id');
    default:
      return null;
  }
}

function normalizeKids(nodes) {
  const out = [];
  let index = 0;
  while (index < nodes.length) {
    const name = nameOf(nodes[index]);
    let end = index + 1;
    while (end < nodes.length && nameOf(nodes[end]) === name) end += 1;
    let run = nodes.slice(index, end);
    const keyed = run.map((node) => keyOf(node));
    if (keyed.every((key) => key != null)) {
      run = run
        .map((node, offset) => ({ node, key: keyed[offset], offset }))
        .sort((a, b) => a.key.localeCompare(b.key, 'fr', { numeric: true }) || a.offset - b.offset)
        .map((item) => item.node);
    }
    out.push(...run);
    index = end;
  }
  return out;
}

function stripEmptyScopes(el) {
  if (nameOf(el) !== 'preferences') return;
  for (const block of [...children(el)]) {
    const blockName = nameOf(block);
    if (blockName !== 'standard-preferences' && blockName !== 'custom-preferences') continue;
    for (const scope of [...children(block)]) {
      if (SCOPES.has(nameOf(scope)) && children(scope).length === 0 && !textOf(scope)) {
        block.removeChild(scope);
      }
    }
    if (children(block).length === 0) el.removeChild(block);
  }
}

function sameAttrs(a, b) {
  const left = attrsOf(a);
  const right = attrsOf(b);
  if (left.length !== right.length) return false;
  for (let i = 0; i < left.length; i += 1) {
    if (left[i].name !== right[i].name || left[i].value !== right[i].value) return false;
  }
  return true;
}

function attrsOf(el) {
  const list = [];
  const attributes = el.attributes;
  if (!attributes) return list;
  for (let i = 0; i < attributes.length; i += 1) {
    const item = attributes.item(i);
    const name = item.name || item.nodeName;
    if (name === 'xmlns' || name.startsWith('xmlns:')) continue;
    list.push({ name, value: item.value });
  }
  return list.sort((a, b) => a.name.localeCompare(b.name));
}

export function diffNodes(a, b, path = '') {
  stripEmptyScopes(a);
  stripEmptyScopes(b);
  if (nameOf(a) !== nameOf(b)) return `${path || '/'} : <${nameOf(a)}> != <${nameOf(b)}>`;
  if (!sameAttrs(a, b)) return `${path}/${nameOf(a)} : attributs différents`;
  if (textOf(a) !== textOf(b)) {
    return `${path}/${nameOf(a)} : texte « ${textOf(a)} » != « ${textOf(b)} »`;
  }
  const left = normalizeKids(children(a));
  const right = normalizeKids(children(b));
  if (left.length !== right.length) {
    return `${path}/${nameOf(a)} : ${left.length} enfants != ${right.length}`;
  }
  for (let i = 0; i < left.length; i += 1) {
    const id = keyOf(left[i]);
    const label = id ? `${nameOf(left[i])}[${id}]` : `${nameOf(left[i])}[${i}]`;
    const diff = diffNodes(left[i], right[i], `${path}/${nameOf(a)}/${label}`);
    if (diff) return diff;
  }
  return null;
}

export function jsonEqual(a, b) {
  return JSON.stringify(sortJson(a)) === JSON.stringify(sortJson(b));
}

function sortJson(value) {
  if (Array.isArray(value)) return value.map(sortJson);
  if (value && typeof value === 'object') {
    const out = {};
    for (const key of Object.keys(value).sort()) out[key] = sortJson(value[key]);
    return out;
  }
  return value;
}
