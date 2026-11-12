import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';

import { CONTRIBUTIONS, contributionById, contributionView } from './contribute.mjs';
import {
  createFragment,
  deleteFragment,
  findFragments,
  updateFragment,
  validateFragment,
} from './fragments.mjs';
import { listAliases } from './keys.mjs';
import { linkInstance, sitesFolderForDownload } from './instances.mjs';
import { composeAll } from './lib/engine.mjs';
import { loadProjectConfig } from './project-config.mjs';
import { buildImportZip, splitIntoProject } from './project.mjs';
import {
  DEFAULT_EXPORT,
  authEnv,
  downloadConfiguredExport,
  downloadWebdav,
  exportOnInstance,
  sfccToken,
  uploadAndImport,
  webdavInstancePath,
} from './sfcc.mjs';

const version = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version;
const PROTOCOLS = new Set(['2024-11-05', '2025-03-26', '2025-06-18']);

const schema = (properties, required = []) => ({
  type: 'object',
  properties,
  required,
});

const parentFields = {
  siteId: { type: 'string' },
  typeId: { type: 'string' },
  libraryId: { type: 'string' },
  catalogId: { type: 'string' },
  scope: { type: 'string' },
  block: { type: 'string' },
  pageType: { type: 'string' },
  lang: { type: 'string' },
  objectType: { type: 'string' },
  pricebookId: { type: 'string' },
  inventoryId: { type: 'string' },
  customerListId: { type: 'string' },
  file: { type: 'string' },
  parents: { type: 'object' },
};

export const tools = [
  {
    name: 'list_rules',
    description: 'Contribution rules for ecom-data XML: path, element, archive, and how to write it.',
    inputSchema: schema({ type: { type: 'string' } }),
  },
  {
    name: 'find',
    description: 'Find a fragment by id or by part of its path.',
    inputSchema: schema({ query: { type: 'string' } }, ['query']),
  },
  {
    name: 'create_fragment',
    description: 'Write a new fragment. Refuses to overwrite. Creates the wrapper when it only holds placeholders.',
    inputSchema: schema({
      type: { type: 'string' },
      xml: { type: 'string' },
      json: { type: 'string' },
      name: { type: 'string' },
      line: { type: 'string' },
      between: { type: 'array', items: { type: 'number' } },
      ...parentFields,
    }, ['type']),
  },
  {
    name: 'update_fragment',
    description: 'Replace the XML of a fragment whose id already exists.',
    inputSchema: schema({ type: { type: 'string' }, xml: { type: 'string' }, ...parentFields }, ['type']),
  },
  {
    name: 'delete_fragment',
    description: 'Delete the file. Does not renumber. Reports groups that still cite an attribute.',
    inputSchema: schema({ type: { type: 'string' }, path: { type: 'string' }, xml: { type: 'string' }, ...parentFields }, ['type']),
  },
  {
    name: 'validate',
    description: 'Check the fragment: one element, the right name, the required ids, no XML declaration and no xmlns.',
    inputSchema: schema({ type: { type: 'string' }, xml: { type: 'string' }, name: { type: 'string' }, json: { type: 'string' }, line: { type: 'string' }, ...parentFields }, ['type']),
  },
  {
    name: 'compose',
    description: 'Recompose the project fragments into an output folder.',
    inputSchema: schema({
      out: { type: 'string' },
      only: { type: 'array', items: { type: 'string' } },
    }),
  },
  {
    name: 'split_archive',
    description: 'Split an export zip into the project folders.',
    inputSchema: schema({
      zip: { type: 'string' },
      updateRanks: { type: 'boolean' },
    }, ['zip']),
  },
  {
    name: 'merge_archive',
    description: 'Write an import zip. from: sites-dev, sites, meta, or test/<case>.',
    inputSchema: schema({
      zip: { type: 'string' },
      from: { type: 'string' },
    }, ['zip']),
  },
  {
    name: 'list_aliases',
    description: 'OCAPI alias names. Never the secret. Hosts and Staging certificates live in .sfcc-data-instances.yaml.',
    inputSchema: schema({}),
  },
  {
    name: 'download_instance',
    description: 'Download the instance over WebDAV, then split it into the project. The instance is a key of .sfcc-data-instances.yaml.',
    inputSchema: schema({
      instance: { type: 'string' },
      updateRanks: { type: 'boolean' },
    }, ['instance']),
  },
  {
    name: 'upload_instance',
    description: 'Build a zip and upload it to the instance. from is the same as merge_archive.',
    inputSchema: schema({
      instance: { type: 'string' },
      from: { type: 'string' },
    }, ['instance']),
  },
];

function project() {
  return loadProjectConfig();
}

async function exportInstance(args) {
  const { instance, connection: alias } = linkInstance(project().root, args.instance);
  const config = project();
  const work = mkdtempSync(path.join(os.tmpdir(), 'sfcc-data-mcp-export-'));
  try {
    let local;
    if (instance['download-file-pattern']) {
      local = (await downloadConfiguredExport(alias, instance, work)).local;
    } else {
      const dataFile = path.join(work, 'units.json');
      writeFileSync(dataFile, JSON.stringify(DEFAULT_EXPORT));
      const stem = `sfcc-data-${alias.alias}-${Date.now()}`;
      exportOnInstance(alias, { dataFile, file: stem });
      local = path.join(work, `${stem}.zip`);
      await downloadWebdav({
        host: alias.host.split(':')[0],
        remotePath: webdavInstancePath(stem),
        dest: local,
        token: alias.webdavUser && alias.webdavPassword ? '' : sfccToken(authEnv(alias)),
        user: alias.webdavUser,
        password: alias.webdavPassword,
        certificate: alias.staging ? alias.certificate : '',
        passphrase: alias.passphrase,
      });
    }
    return splitIntoProject(local, {
      updateRanks: Boolean(args.updateRanks),
      config,
      folder: sitesFolderForDownload(instance, path.basename(local)),
    });
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

async function importInstance(args) {
  const { connection: alias } = linkInstance(project().root, args.instance);
  const work = mkdtempSync(path.join(os.tmpdir(), 'sfcc-data-mcp-import-'));
  try {
    const zip = path.join(work, `sfcc-data-import-${Date.now()}.zip`);
    buildImportZip(zip, { from: args.from || 'sites-dev' });
    await uploadAndImport(alias, zip);
    return { zip: path.basename(zip), host: alias.host };
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

export async function callTool(name, args = {}) {
  switch (name) {
    case 'list_rules':
      return args.type
        ? contributionView(contributionById(args.type))
        : CONTRIBUTIONS.map(contributionView);
    case 'find':
      return findFragments(args.query);
    case 'create_fragment':
      return createFragment(args);
    case 'update_fragment':
      return updateFragment(args);
    case 'delete_fragment':
      return deleteFragment(args);
    case 'validate':
      return validateFragment(args);
    case 'compose': {
      const config = project();
      const source = path.dirname(config.meta);
      return composeAll({
        source,
        out: args.out || path.join(source, '.composed'),
        config: config.splitter,
        only: args.only || [],
      });
    }
    case 'split_archive':
      return splitIntoProject(args.zip, { updateRanks: Boolean(args.updateRanks) });
    case 'merge_archive':
      return { zip: buildImportZip(args.zip, { from: args.from || 'sites-dev' }) };
    case 'list_aliases':
      return listAliases().map((alias) => ({ alias: alias.alias }));
    case 'download_instance':
      return exportInstance(args);
    case 'upload_instance':
      return importInstance(args);
    default:
      throw new Error(`Outil inconnu : ${name}`);
  }
}

export function handleMessage(message) {
  const { id, method, params } = message;
  if (method === 'notifications/initialized' || method === 'notifications/cancelled') return null;
  if (id == null && method?.startsWith('notifications/')) return null;
  const result = (value) => ({ jsonrpc: '2.0', id, result: value });
  const failure = (code, text) => ({ jsonrpc: '2.0', id, error: { code, message: text } });
  if (method === 'initialize') {
    const requested = params?.protocolVersion;
    return result({
      protocolVersion: PROTOCOLS.has(requested) ? requested : '2024-11-05',
      capabilities: { tools: { listChanged: false } },
      serverInfo: { name: 'sfcc-data', version },
      instructions: 'SFCC fragments. Call list_rules before writing XML. create_fragment refuses to overwrite.',
    });
  }
  if (method === 'tools/list') return result({ tools });
  if (method === 'ping') return result({});
  if (method === 'tools/call') {
    return callTool(params?.name, params?.arguments || {}).then(
      (value) => result({
        content: [{ type: 'text', text: JSON.stringify(value, null, 2) }],
        isError: false,
      }),
      (error) => result({
        content: [{ type: 'text', text: error.message || String(error) }],
        isError: true,
      }),
    );
  }
  return failure(-32601, `Unknown method: ${method}`);
}

export function startServer() {
  const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity, terminal: false });
  rl.on('line', (line) => {
    if (!line.trim()) return;
    let message;
    try {
      message = JSON.parse(line);
    } catch (error) {
      process.stderr.write(`${error.message}\n`);
      return;
    }
    Promise.resolve(handleMessage(message)).then((response) => {
      if (response) process.stdout.write(`${JSON.stringify(response)}\n`);
    }).catch((error) => {
      if (message.id != null) {
        process.stdout.write(`${JSON.stringify({
          jsonrpc: '2.0',
          id: message.id,
          error: { code: -32603, message: error.message || String(error) },
        })}\n`);
      } else {
        process.stderr.write(`${error.message}\n`);
      }
    });
  });
}
