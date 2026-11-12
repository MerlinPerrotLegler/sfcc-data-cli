import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { isKept } from './filter.mjs';
import { compareNames, joinId, orderWidth, pad, sanitize } from './names.mjs';
import { fillPlaceholders } from './placeholders.mjs';
import { orderRank } from './ranks.mjs';
import {
  assertFragmentText,
  attr,
  attrs,
  children,
  childText,
  nameOf,
  openTag,
  parseFragment,
  parseXml,
  serialize,
} from './xml.mjs';

export const NS = {
  jobs: 'http://www.demandware.com/xml/impex/jobs/2015-07-01',
  services: 'http://www.demandware.com/xml/impex/services/2014-09-26',
  customerGroup: 'http://www.demandware.com/xml/impex/customergroup/2007-06-30',
  shipping: 'http://www.demandware.com/xml/impex/shipping/2007-03-31',
  tax: 'http://www.demandware.com/xml/impex/tax/2007-02-14',
  search2: 'http://www.demandware.com/xml/impex/search2/2010-02-19',
  sort: 'http://www.demandware.com/xml/impex/sort/2009-05-15',
  library: 'http://www.demandware.com/xml/impex/library/2006-10-31',
  slot: 'http://www.demandware.com/xml/impex/slot/2008-09-08',
  paymentSettings: 'http://www.demandware.com/xml/impex/paymentsettings/2009-09-15',
  paymentProcessor: 'http://www.demandware.com/xml/impex/paymentprocessor/2007-03-31',
  pricebook: 'http://www.demandware.com/xml/impex/pricebook/2006-10-31',
  inventory: 'http://www.demandware.com/xml/impex/inventory/2007-05-31',
  customer: 'http://www.demandware.com/xml/impex/customer/2006-10-31',
  customObject: 'http://www.demandware.com/xml/impex/customobject/2006-10-31',
  catalog: 'http://www.demandware.com/xml/impex/catalog/2006-10-31',
  promotion: 'http://www.demandware.com/xml/impex/promotion/2008-01-31',
  coupon: 'http://www.demandware.com/xml/impex/coupon/2008-06-17',
  store: 'http://www.demandware.com/xml/impex/store/2007-04-30',
  abtest: 'http://www.demandware.com/xml/impex/abtest/2010-04-01',
  redirecturl: 'http://www.demandware.com/xml/impex/redirecturl/2011-09-01',
  sourcecode: 'http://www.demandware.com/xml/impex/sourcecode/2007-03-31',
  user: 'http://www.demandware.com/xml/impex/user/2007-09-05',
  locales: 'http://www.demandware.com/xml/impex/locales/2015-04-30',
};

function at(fileName, where = 'both') {
  const escaped = fileName.replace(/\./g, '\\.');
  return (rel) => {
    if (where !== 'site' && rel === fileName) return true;
    if (where !== 'root' && new RegExp(`^sites/[^/]+/${escaped}$`).test(rel)) return true;
    return false;
  };
}

function section(key, element, extra = {}) {
  return {
    key,
    element,
    dir: extra.dir ?? element,
    ...extra,
  };
}

function slotStem(el, withCampaign) {
  return joinId([
    attr(el, 'slot-id'),
    attr(el, 'context'),
    attr(el, 'context-id'),
    attr(el, 'configuration-id'),
    withCampaign ? attr(el, 'campaign-id') : '',
  ]);
}

function redirectKey(el) {
  const text = childText(el, 'keywords').replace(/\s+/g, ' ').trim();
  return sanitize(text).slice(0, 80) || 'redirect';
}

export function defaultPaths(rel) {
  if (/^sites\/[^/]+\/library\/library\.xml$/.test(rel)) {
    const unitDir = rel.slice(0, rel.lastIndexOf('/'));
    return { monolith: rel, unitDir, wrapper: `${unitDir}/library.wrapper.xml` };
  }
  const unitDir = rel.replace(/\.xml$/, '');
  const base = unitDir.split('/').pop();
  return { monolith: rel, unitDir, wrapper: `${unitDir}/${base}.wrapper.xml` };
}

function stemOf(el, sectionSpec) {
  if (sectionSpec.stem) return sectionSpec.stem(el);
  if (sectionSpec.idText) return sanitize(childText(el, sectionSpec.idText));
  if (sectionSpec.idAttrs) return joinId(sectionSpec.idAttrs.map((name) => attr(el, name)));
  return '';
}

function rawId(el, sectionSpec) {
  if (sectionSpec.orderKey) return sectionSpec.orderKey(el);
  if (sectionSpec.idText) return childText(el, sectionSpec.idText);
  if (sectionSpec.idAttrs) {
    return sectionSpec.idAttrs.map((name) => attr(el, name)).filter(Boolean).join('__');
  }
  return stemOf(el, sectionSpec);
}

export function assertFragmentName(filename, el, sectionSpec) {
  const stem = filename.replace(/\.xml$/, '').normalize('NFC');
  if (sectionSpec.orderOnly) {
    if (!/^\d+$/.test(stem)) throw new Error(`${filename} : nom d'ordre attendu`);
    return;
  }
  let rest = stem;
  if (sectionSpec.role) {
    const match = rest.match(/^(\d+)-([A-Z]+)-(.*)$/);
    if (!match || match[2] !== sectionSpec.role) {
      throw new Error(`${filename} : préfixe de rôle ${sectionSpec.role} attendu`);
    }
    rest = match[3];
  }
  if (sectionSpec.ordered) {
    const match = rest.match(/^\d+-(.*)$/);
    if (!match) throw new Error(`${filename} : rang d'ordre attendu`);
    rest = match[1];
  }
  const expected = stemOf(el, sectionSpec);
  if (rest.replace(/--\d+$/, '') !== expected) {
    throw new Error(`${filename} : « ${rawId(el, sectionSpec)} » devrait finir par ${expected}`);
  }
}

function fragmentName(el, sectionSpec, order) {
  if (sectionSpec.orderOnly) return `${pad(order, orderWidth(order))}.xml`;
  const stem = stemOf(el, sectionSpec);
  if (!stem) throw new Error(`Identifiant vide pour <${sectionSpec.element}>`);
  if (sectionSpec.ordered) return `${pad(order, orderWidth(order))}-${stem}.xml`;
  if (sectionSpec.role) {
    return `${pad(sectionSpec.typeRank, sectionSpec.width)}-${sectionSpec.role}-${stem}.xml`;
  }
  return `${stem}.xml`;
}

function joinRel(...parts) {
  return parts.filter(Boolean).join('/').replace(/\/+/g, '/');
}

function attrText(attributes) {
  return attributes.map((item) => ` ${item.name}="${String(item.value).replace(/&/g, '&amp;').replace(/"/g, '&quot;')}"`).join('');
}

export function writeText(dest, rel, content) {
  const abs = path.join(dest, rel);
  mkdirSync(path.dirname(abs), { recursive: true });
  const text = content.endsWith('\n') ? content : `${content}\n`;
  writeFileSync(abs, text);
}

function writeFragment(dest, rel, body) {
  assertFragmentText(body, rel);
  writeText(dest, rel, body);
}

function localSections(spec) {
  return spec.sections.map((item) => ({ ...item }));
}

function collect(parent, sections, rel) {
  const groups = new Map(sections.map((item) => [item.key, []]));
  for (const child of children(parent)) {
    const name = nameOf(child);
    const match = sections.find((item) => (item.container ? item.container === name : item.element === name));
    if (!match) throw new Error(`${rel} : <${name}> sans règle`);
    if (match.container) {
      match.present = true;
      for (const grand of children(child)) {
        if (nameOf(grand) !== match.element) {
          throw new Error(`${rel} : <${nameOf(grand)}> inattendu dans <${name}>`);
        }
        groups.get(match.key).push(grand);
      }
      continue;
    }
    if (match.single) {
      if (match.singleEl) throw new Error(`${rel} : <${name}> dupliqué`);
      match.singleEl = child;
      continue;
    }
    groups.get(match.key).push(child);
  }
  return groups;
}

export function splitList(ctx, spec) {
  const root = parseXml(readFileSync(ctx.abs, 'utf8'));
  if (nameOf(root) !== spec.root) {
    throw new Error(`${ctx.rel} : racine <${nameOf(root)}> au lieu de <${spec.root}>`);
  }
  const paths = (spec.paths ?? defaultPaths)(ctx.rel);
  const sections = localSections(spec);
  let parent = root;
  let shellAttributes = [];
  if (spec.shell) {
    const shells = children(root).filter((el) => nameOf(el) === spec.shell);
    if (shells.length !== 1) throw new Error(`${ctx.rel} : un seul <${spec.shell}> attendu`);
    parent = shells[0];
    shellAttributes = attrs(parent);
  }
  const groups = collect(parent, sections, ctx.rel);
  const blocks = [];
  const seen = new Map();
  const claim = (rel, id) => {
    let chosen = rel;
    let n = 2;
    while (seen.has(chosen.normalize('NFC').toLocaleLowerCase('fr'))) {
      chosen = rel.replace(/\.xml$/, `--${n}.xml`);
      n += 1;
    }
    seen.set(chosen.normalize('NFC').toLocaleLowerCase('fr'), id);
    return chosen;
  };
  if (spec.shell) blocks.push(`    <${spec.shell}${attrText(shellAttributes)}>`);
  for (const item of sections) {
    if (item.single) {
      if (!item.singleEl) {
        if (item.required) throw new Error(`${ctx.rel} : <${item.element}> obligatoire`);
        continue;
      }
      const fileRel = joinRel(paths.unitDir, item.file);
      writeFragment(ctx.dest, fileRel, serialize(item.singleEl));
      blocks.push(`{${item.key}}`);
      continue;
    }
    const items = groups.get(item.key);
    if (item.container && item.present && items.length === 0) {
      blocks.push(`    <${item.container}/>`);
      continue;
    }
    if (!items.length) continue;
    const chunks = [];
    const usedKeys = new Set();
    items.forEach((el, index) => {
      const position = index + 1;
      let identity = rawId(el, item);
      if (item.ordered || item.orderOnly) {
        let unique = identity || String(position);
        let suffix = 2;
        while (usedKeys.has(unique)) {
          unique = `${identity || 'item'}-${suffix}`;
          suffix += 1;
        }
        usedKeys.add(unique);
        identity = unique;
        const scope = `${paths.unitDir}/${item.dir === '.' ? item.element : item.dir}/${identity}`;
        const order = orderRank(ctx.ranks, scope, position, ctx.updateRanks);
        const filename = fragmentName(el, item, order);
        const dir = item.dir === '.' ? paths.unitDir : joinRel(paths.unitDir, item.dir);
        const fileRel = claim(joinRel(dir, filename), identity);
        const body = serialize(el);
        writeFragment(ctx.dest, fileRel, body);
        chunks.push(body);
        return;
      }
      const filename = fragmentName(el, item, position);
      const dir = item.dir === '.' ? paths.unitDir : joinRel(paths.unitDir, item.dir);
      const fileRel = claim(joinRel(dir, filename), identity);
      const body = serialize(el);
      writeFragment(ctx.dest, fileRel, body);
      chunks.push(body);
    });
    if (item.container) {
      blocks.push(`    <${item.container}>`);
      blocks.push(`{${item.key}}`);
      blocks.push(`    </${item.container}>`);
    } else {
      blocks.push(`{${item.key}}`);
    }
  }
  if (spec.shell) blocks.push(`    </${spec.shell}>`);
  const xmlns = root.getAttribute('xmlns') || spec.xmlns;
  const rootAttributes = attrs(root);
  const declaration = '<?xml version="1.0" encoding="UTF-8"?>\n';
  const wrapper = blocks.length
    ? `${declaration}${openTag(spec.root, xmlns, rootAttributes)}\n${blocks.join('\n')}\n</${spec.root}>\n`
    : `${declaration}${openTag(spec.root, xmlns, rootAttributes, true)}\n`;
  writeText(ctx.dest, paths.wrapper, wrapper);
}

function listXml(dir, reserved) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((name) => name.endsWith('.xml') && !name.endsWith('.wrapper.xml') && !reserved.has(name))
    .sort(compareNames);
}

export function composeList(ctx, spec) {
  const paths = (spec.paths ?? defaultPaths)(ctx.rel);
  const wrapperAbs = path.join(ctx.archiveRoot, paths.wrapper);
  if (!isKept(`${ctx.archiveName}/${paths.wrapper}`, ctx.filter)) return null;
  const wrapper = readFileSync(wrapperAbs, 'utf8');
  const sections = localSections(spec);
  const reserved = new Set(sections.filter((item) => item.file).map((item) => item.file));
  const values = {};
  for (const item of sections) {
    const placeholder = new RegExp(`\\{${item.key}\\}`);
    if (item.single) {
      const fileRel = joinRel(paths.unitDir, item.file);
      const abs = path.join(ctx.archiveRoot, fileRel);
      if (!existsSync(abs) || !isKept(`${ctx.archiveName}/${fileRel}`, ctx.filter)) {
        if (item.required && placeholder.test(wrapper)) {
          throw new Error(`${fileRel} : élément obligatoire absent`);
        }
        values[item.key] = '';
        continue;
      }
      const text = readFileSync(abs, 'utf8').replace(/\n$/, '');
      assertFragmentText(text, fileRel);
      parseFragment(text);
      values[item.key] = text;
      continue;
    }
    const dirRel = item.dir === '.' ? paths.unitDir : joinRel(paths.unitDir, item.dir);
    const names = listXml(path.join(ctx.archiveRoot, dirRel), item.dir === '.' ? reserved : new Set());
    if (!placeholder.test(wrapper) && names.length) {
      throw new Error(`${dirRel} : fragments sans placeholder {${item.key}}`);
    }
    const chunks = [];
    for (const name of names) {
      const fileRel = joinRel(dirRel, name);
      if (!isKept(`${ctx.archiveName}/${fileRel}`, ctx.filter)) continue;
      const text = readFileSync(path.join(ctx.archiveRoot, fileRel), 'utf8').replace(/\n$/, '');
      assertFragmentText(text, fileRel);
      const elements = parseFragment(text);
      if (elements.length !== 1 || nameOf(elements[0]) !== item.element) {
        throw new Error(`${fileRel} : <${item.element}> attendu`);
      }
      assertFragmentName(name, elements[0], item);
      chunks.push(text);
    }
    if (item.required && placeholder.test(wrapper) && chunks.length === 0) {
      throw new Error(`${ctx.rel} : section obligatoire ${item.element} vide`);
    }
    values[item.key] = chunks.join('\n');
  }
  return fillPlaceholders(wrapper, values);
}

const librarySections = [
  section('header', 'header', { single: true, file: 'header.xml', dir: '.' }),
  section('folders', 'folder', { dir: 'folder', idAttrs: ['folder-id'] }),
  section('contents', 'content', { dir: 'content', idAttrs: ['content-id'] }),
];

const sortSections = [
  section('dynamicAttribute', 'dynamic-attribute', { idAttrs: ['dynamic-attribute-id'] }),
  section('sortingRule', 'sorting-rule', { idAttrs: ['rule-id'] }),
  section('sortingRuleAssignment', 'sorting-rule-assignment', {
    stem: (el) => joinId([attr(el, 'rule-id'), attr(el, 'category-id')]),
  }),
  section('sortingRuleCampaignAssignment', 'sorting-rule-campaign-assignment', {
    stem: (el) => joinId([attr(el, 'rule-id'), attr(el, 'category-id'), attr(el, 'campaign-id')]),
  }),
  section('sortingOptions', 'sorting-options', { single: true, file: 'sorting-options.xml', dir: '.' }),
  section('keywordSearchSortingRuleAssignment', 'keyword-search-sorting-rule-assignment', {
    stem: (el) => joinId([attr(el, 'rule-id'), attr(el, 'keyword-group-id')]),
  }),
  section('keywordSearchSortingRuleCampaignAssignment', 'keyword-search-sorting-rule-campaign-assignment', {
    stem: (el) => joinId([attr(el, 'rule-id'), attr(el, 'keyword-group-id'), attr(el, 'campaign-id')]),
  }),
  section('boostBuryRule', 'boost-bury-rule', { idAttrs: ['rule-id'] }),
];

const searchSections = [
  section('searchableAttributes', 'searchable-attribute', {
    container: 'searchable-attributes',
    dir: 'searchable-attributes',
    idText: 'attribute-path',
  }),
  section('stopwordList', 'stopword-list', { idAttrs: ['xml:lang'] }),
  section('synonymList', 'synonym-list', { idAttrs: ['xml:lang'] }),
  section('hypernymList', 'hypernym-list', { idAttrs: ['xml:lang'] }),
  section('redirects', 'redirect', {
    container: 'redirect-list',
    dir: 'redirect-list',
    orderOnly: true,
    orderKey: redirectKey,
  }),
  section('suggestionList', 'suggestion-list', { idAttrs: ['xml:lang'] }),
  section('compoundWordList', 'compound-word-list', { idAttrs: ['xml:lang'] }),
  section('commonPhraseList', 'common-phrase-list', { idAttrs: ['xml:lang'] }),
  section('categoryExclusionList', 'category-exclusion-list', { idAttrs: ['xml:lang'] }),
  section('stemmingExceptionList', 'stemming-exception-list', { idAttrs: ['xml:lang'] }),
  section('indexSettings', 'index-settings', { single: true, file: 'index-settings.xml', dir: '.' }),
  section('keywordGroupList', 'keyword-group-list', { single: true, file: 'keyword-group-list.xml', dir: '.' }),
];

function rule(match, spec) {
  return {
    kind: 'unit',
    match,
    paths: spec.paths ?? defaultPaths,
    split: (ctx) => splitList(ctx, spec),
    compose: (ctx) => composeList(ctx, spec),
  };
}

export const listRules = [
  rule((rel) => rel === 'jobs.xml', {
    root: 'jobs',
    xmlns: NS.jobs,
    sections: [section('0', 'job', { dir: '.', idAttrs: ['job-id'] })],
  }),
  rule((rel) => rel === 'services.xml', {
    root: 'services',
    xmlns: NS.services,
    sections: [
      section('serviceCredentials', 'service-credential', { dir: 'service-credential', idAttrs: ['service-credential-id'] }),
      section('serviceProfiles', 'service-profile', { dir: 'service-profile', idAttrs: ['service-profile-id'] }),
      section('services', 'service', { dir: 'service', idAttrs: ['service-id'] }),
    ],
  }),
  rule(at('customer-groups.xml', 'site'), {
    root: 'customer-groups',
    xmlns: NS.customerGroup,
    sections: [
      section('customerGroups', 'customer-group', { dir: 'customer-group', idAttrs: ['group-id'] }),
      section('groupAssignments', 'group-assignment', {
        dir: 'group-assignment',
        idAttrs: ['group-id', 'customer-no'],
      }),
    ],
  }),
  rule(at('payment-methods.xml', 'site'), {
    root: 'payment-settings',
    xmlns: NS.paymentSettings,
    sections: [
      section('paymentMethods', 'payment-method', { dir: 'payment-method', idAttrs: ['method-id'], ordered: true }),
      section('paymentCards', 'payment-card', { dir: 'payment-card', idAttrs: ['card-type'], ordered: true }),
    ],
  }),
  rule(at('payment-processors.xml', 'site'), {
    root: 'payment-processors',
    xmlns: NS.paymentProcessor,
    sections: [section('paymentProcessors', 'payment-processor', { dir: '.', idAttrs: ['processor-id'] })],
  }),
  rule(at('shipping.xml', 'site'), {
    root: 'shipping',
    xmlns: NS.shipping,
    sections: [section('shippingMethods', 'shipping-method', { dir: '.', idAttrs: ['method-id'], ordered: true })],
  }),
  rule(at('tax.xml', 'site'), {
    root: 'tax',
    xmlns: NS.tax,
    sections: [
      section('taxClasses', 'tax-class', { container: 'tax-classes', dir: 'tax-classes', idAttrs: ['class-id'] }),
      section('taxJurisdictions', 'tax-jurisdiction', {
        container: 'tax-jurisdictions',
        dir: 'tax-jurisdictions',
        idAttrs: ['jurisdiction-id'],
      }),
      section('taxRates', 'tax-rate', {
        container: 'tax-rates',
        dir: 'tax-rates',
        idAttrs: ['jurisdiction-id', 'class-id'],
      }),
    ],
  }),
  rule(at('search2.xml', 'site'), { root: 'search', xmlns: NS.search2, sections: searchSections }),
  rule(at('sort.xml'), { root: 'sort', xmlns: NS.sort, sections: sortSections }),
  rule(
    (rel) => /^libraries\/[^/]+\/library\.xml$/.test(rel) || /^sites\/[^/]+\/library\/library\.xml$/.test(rel),
    { root: 'library', xmlns: NS.library, sections: librarySections },
  ),
  rule(at('slots.xml', 'site'), {
    root: 'slot-configurations',
    xmlns: NS.slot,
    sections: [
      section('configurations', 'slot-configuration', { dir: 'configurations', stem: (el) => slotStem(el, false) }),
      section('campaignAssignments', 'slot-configuration-campaign-assignment', {
        dir: 'campaign-assignments',
        stem: (el) => slotStem(el, true),
      }),
    ],
  }),
  rule((rel) => /^pricebooks\/[^/]+\.xml$/.test(rel), {
    root: 'pricebooks',
    xmlns: NS.pricebook,
    shell: 'pricebook',
    sections: [
      section('header', 'header', { single: true, required: true, file: 'header.xml', dir: '.' }),
      section('priceTables', 'price-table', {
        container: 'price-tables',
        dir: 'price-tables',
        idAttrs: ['product-id'],
      }),
    ],
  }),
  rule((rel) => /^inventory-lists\/[^/]+\.xml$/.test(rel), {
    root: 'inventory',
    xmlns: NS.inventory,
    shell: 'inventory-list',
    sections: [
      section('header', 'header', { single: true, required: true, file: 'header.xml', dir: '.' }),
      section('records', 'record', { container: 'records', dir: 'records', idAttrs: ['product-id'] }),
    ],
  }),
  rule((rel) => /^customer-lists\/[^/]+\.xml$/.test(rel), {
    root: 'customer-list',
    xmlns: NS.customer,
    sections: [
      section('header', 'header', { single: true, required: true, file: 'header.xml', dir: '.' }),
      section('customers', 'customer', { dir: 'customer', idAttrs: ['customer-no'] }),
    ],
  }),
  rule(
    (rel) => /^custom-objects\/[^/]+\.xml$/.test(rel) || /^sites\/[^/]+\/custom-objects\/[^/]+\.xml$/.test(rel),
    {
      root: 'custom-objects',
      xmlns: NS.customObject,
      sections: [section('customObjects', 'custom-object', { dir: '.', idAttrs: ['object-id'] })],
    },
  ),
  rule((rel) => /^catalogs\/[^/]+\/catalog\.xml$/.test(rel), {
    root: 'catalog',
    xmlns: NS.catalog,
    sections: [
      section('header', 'header', { single: true, file: 'header.xml', dir: '.' }),
      section('categories', 'category', { dir: 'category', idAttrs: ['category-id'] }),
      section('products', 'product', { dir: 'product', idAttrs: ['product-id'] }),
      section('productOptions', 'product-option', { dir: 'product-option', idAttrs: ['option-id'] }),
      section('variationAttributes', 'variation-attribute', {
        dir: 'variation-attribute',
        idAttrs: ['variation-attribute-id'],
      }),
      section('categoryAssignments', 'category-assignment', {
        dir: 'category-assignment',
        idAttrs: ['category-id', 'product-id'],
      }),
      section('recommendations', 'recommendation', {
        dir: 'recommendation',
        idAttrs: ['source-id', 'source-type', 'target-id', 'type'],
      }),
    ],
  }),
  rule(at('promotions.xml', 'site'), {
    root: 'promotions',
    xmlns: NS.promotion,
    sections: [
      section('campaigns', 'campaign', { dir: 'campaign', idAttrs: ['campaign-id'] }),
      section('globalPromotionSettings', 'global-promotion-settings', {
        single: true,
        file: 'global-promotion-settings.xml',
        dir: '.',
      }),
      section('promotions', 'promotion', { dir: 'promotion', idAttrs: ['promotion-id'] }),
      section('promotionCampaignAssignments', 'promotion-campaign-assignment', {
        dir: 'promotion-campaign-assignment',
        idAttrs: ['promotion-id', 'campaign-id'],
      }),
    ],
  }),
  rule(at('coupons.xml', 'site'), {
    root: 'coupons',
    xmlns: NS.coupon,
    sections: [
      section('coupons', 'coupon', { dir: 'coupon', idAttrs: ['coupon-id'] }),
      section('couponCodes', 'coupon-codes', { dir: 'coupon-codes', idAttrs: ['coupon-id'] }),
    ],
  }),
  rule(at('stores.xml', 'site'), {
    root: 'stores',
    xmlns: NS.store,
    sections: [
      section('stores', 'store', { dir: 'store', idAttrs: ['store-id'] }),
      section('storeGroups', 'store-group', { dir: 'store-group', idAttrs: ['store-group-id'] }),
    ],
  }),
  rule(at('abtests.xml', 'site'), {
    root: 'ab-tests',
    xmlns: NS.abtest,
    sections: [section('abTests', 'ab-test', { dir: '.', idAttrs: ['test-id'] })],
  }),
  rule(at('redirect-urls.xml', 'site'), {
    root: 'redirect-urls',
    xmlns: NS.redirecturl,
    sections: [
      section('redirectUrls', 'redirect-url', {
        dir: '.',
        ordered: true,
        stem: (el) => sanitize(attr(el, 'uri') || `${attr(el, 'source-type')}-${attr(el, 'source-id')}`),
      }),
    ],
  }),
  rule(at('sourcecodes.xml', 'site'), {
    root: 'sourcecodes',
    xmlns: NS.sourcecode,
    sections: [section('sourcecodeGroups', 'sourcecode-group', { dir: '.', idAttrs: ['group-id'] })],
  }),
  rule((rel) => rel === 'users.xml', {
    root: 'users',
    xmlns: NS.user,
    sections: [section('users', 'user', { dir: '.', idAttrs: ['login'] })],
  }),
  rule((rel) => rel === 'access-roles.xml', {
    root: 'access-roles',
    xmlns: NS.user,
    sections: [section('accessRoles', 'access-role', { dir: '.', idAttrs: ['role-id'] })],
  }),
  rule((rel) => rel === 'locales.xml', {
    root: 'locales',
    xmlns: NS.locales,
    sections: [section('locales', 'locale', { dir: '.', idAttrs: ['locale-id'] })],
  }),
];
