#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { runApply } from '../src/apply-site-export.mjs';
import { getAlias, listAliases, removeAlias, saveAlias } from '../src/keys.mjs';
import { composeAll, splitAll } from '../src/lib/engine.mjs';
import { copyCatalogConfig, installSplitLayout } from '../src/lib/layout.mjs';
import { installProject } from '../src/init.mjs';
import {
  ensureGitignore,
  ensureInstancesFile,
  INSTANCES_FILE,
  linkInstance,
  missingFields,
  sitesFolderForDownload,
  readInstances,
  setField,
  writeInstances,
} from '../src/instances.mjs';
import { EXPORT_JOB_ID, exportJobXml } from '../src/job.mjs';
import { findProjectConfig, findProjectRoot, loadProjectConfig } from '../src/project-config.mjs';
import { buildImportZip, splitIntoProject } from '../src/project.mjs';
import { ask, isInteractive } from '../src/prompt.mjs';
import {
  DEFAULT_EXPORT,
  authEnv,
  downloadConfiguredExport,
  downloadWebdav,
  exportOnInstance,
  sfccToken,
  uploadAndImport,
  webdavInstancePath,
} from '../src/sfcc.mjs';

const USAGE = `sfcc-data <command> [options]

  compose                         fragments → import archive
  split <site-import.zip>         zip → project folders (sfcc-data-config.yaml)
  split --input <export> --out    SFCC export → raw tree, not placed in the project
  merge <archive.zip>             build an import zip (--from sites-dev)
  apply-export                    apply an STG/PROD/DEV export into ecom-data
  install-layout                  place a raw split into the project folders
  ocapi add|rm|list             OCAPI client id and secret
  job install [instance...]       install the site-export job on the instances
  download <instance>             WebDAV file from .sfcc-data-instances.yaml, then split
  upload <alias>                  merge, WebDAV upload, import on the instance
  init                            install the MCP server and the contribution rule
  init --check                    fail when this install is no longer this CLI version
  install mcp                     same as init

The project is described by sfcc-data-config.yaml, found from the current
directory up to the filesystem root. Aliases live in ~/.sfcc-data-keys,
encrypted with the key ~/.sfcc-data-salt.
`;

function parseArgs(argv) {
  const out = { _: [], only: [], flags: new Set() };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--update-ranks' || arg === '--check') {
      out.flags.add(arg);
    } else if (arg.startsWith('--')) {
      const value = argv[i + 1];
      if (!value || value.startsWith('--')) throw new Error(`${arg} requires a value`);
      const key = arg.slice(2);
      if (key === 'only') {
        out.only.push(...value.split(',').map((item) => item.trim()).filter(Boolean));
      } else {
        out[key] = value;
      }
      i += 1;
    } else {
      out._.push(arg);
    }
  }
  return out;
}

function rejectExtra(args) {
  if (args._.length) throw new Error(`Unexpected argument: ${args._[0]}`);
}

function dataPath(name = '') {
  return path.join(process.cwd(), 'ecom-data', name);
}

function projectOrNull() {
  return findProjectConfig() ? loadProjectConfig() : null;
}

function composeDefaults(args) {
  const project = projectOrNull();
  const dataRoot = project ? path.dirname(project.meta) : dataPath('');
  return {
    source: args.source ?? dataRoot,
    out: args.out ?? (project ? path.join(dataRoot, '.composed') : dataPath('.composed')),
    config: args.config ?? (project ? project.splitter : dataPath('data-splitter.yaml')),
  };
}

function compose(argv) {
  const args = parseArgs(argv);
  rejectExtra(args);
  const defaults = composeDefaults(args);
  const result = composeAll({
    source: defaults.source,
    out: defaults.out,
    config: defaults.config,
    only: args.only,
  });
  console.log(`compose : ${result.written} files`);
}

function split(argv) {
  const args = parseArgs(argv);
  if (args.input || args.out || args.config || args.flags.has('--check') || args.only.length) {
    rejectExtra(args);
    if (!args.input) throw new Error('--input requires a value');
    const project = projectOrNull();
    const result = splitAll({
      input: args.input,
      out: args.out ?? (project ? path.dirname(project.meta) : dataPath('')),
      config: args.config ?? (project ? project.splitter : dataPath('data-splitter.yaml')),
      only: args.only,
      updateRanks: args.flags.has('--update-ranks'),
      check: args.flags.has('--check'),
    });
    const mode = args.flags.has('--check') ? 'check' : 'split';
    console.log(`${mode} : ${result.written} files`);
    for (const key of result.added) console.log(`rank added : ${key}`);
    return;
  }
  const zip = args._[0];
  if (!zip || args._.length > 1) throw new Error('Usage: sfcc-data split <site-import.zip>');
  const result = splitIntoProject(zip, { updateRanks: args.flags.has('--update-ranks') });
  console.log(`split : ${result.written} files`);
  for (const key of result.added) console.log(`rank added : ${key}`);
}

function merge(argv) {
  const args = parseArgs(argv);
  const zip = args._[0];
  if (!zip || args._.length > 1) {
    throw new Error('Usage: sfcc-data merge <archive.zip> [--from sites-dev|sites|meta|test/<case>]');
  }
  const dest = buildImportZip(zip, { from: args.from ?? 'sites-dev' });
  console.log(`merge : ${dest}`);
}

function installLayout(argv) {
  const args = parseArgs(argv);
  rejectExtra(args);
  if (args['overlay-config'] || args['overlay-complete']) {
    if (!args['overlay-config'] || !args['overlay-complete']) {
      throw new Error('Usage: sfcc-data install-layout --overlay-config <ecom-data-sites> --overlay-complete <ecom-data-sites-dev>');
    }
    copyCatalogConfig(path.resolve(args['overlay-config']), path.resolve(args['overlay-complete']));
    return;
  }
  if (!args.from || !args.into) {
    throw new Error('Usage: sfcc-data install-layout --from <split> --into <ecom-data>');
  }
  installSplitLayout(path.resolve(args.from), path.resolve(args.into));
}

async function valueOrAsk(current, flag, label, { secret = false } = {}) {
  if (current) return String(current).trim();
  if (!isInteractive()) throw new Error(`${flag} is required outside a terminal`);
  const answer = (await ask(label, { secret })).trim();
  if (!answer) throw new Error(`${flag} is required`);
  return answer;
}

async function collectAlias(args) {
  const alias = await valueOrAsk(args.alias, '--alias', 'Alias: ');
  const clientId = await valueOrAsk(args['ocapi-key'] || args['client-id'], '--ocapi-key', 'OCAPI client id : ');
  const clientSecret = await valueOrAsk(
    args['ocapi-pass'] || args['client-secret'] || process.env.SFCC_OCAPI_PASS,
    '--ocapi-pass',
    'OCAPI client secret : ',
    { secret: true },
  );
  return { alias, clientId, clientSecret };
}

async function ocapi(argv) {
  const args = parseArgs(argv);
  const action = args._[0];
  if (action === 'list') {
    if (args._.length > 1) throw new Error('Usage: sfcc-data ocapi list');
    const aliases = listAliases();
    if (!aliases.length) {
      console.log('No alias.');
      return;
    }
    for (const alias of aliases) console.log(alias.alias);
    return;
  }
  if (action === 'add') {
    if (args._.length > 1) throw new Error('Usage: sfcc-data ocapi add');
    const record = await collectAlias(args);
    saveAlias(record);
    console.log(`alias saved: ${record.alias}`);
    return;
  }
  if (action === 'rm') {
    const name = args._[1];
    if (!name || args._.length > 2) throw new Error('Usage: sfcc-data ocapi rm <alias>');
    removeAlias(name);
    console.log(`alias removed: ${name}`);
    return;
  }
  if (!action) throw new Error('Usage: sfcc-data ocapi add|rm|list');
  throw new Error(`Usage: sfcc-data ocapi [${action} is unknown]`);
}

async function downloadInstance(argv) {
  const args = parseArgs(argv);
  const name = args._[0];
  if (!name || args._.length > 1) throw new Error('Usage: sfcc-data download <instance> [--data <file.json>] [--update-ranks]');
  const { instance, connection: alias } = linkInstance(findProjectRoot(), name);
  const work = mkdtempSync(path.join(os.tmpdir(), 'sfcc-data-export-'));
  try {
    let local;
    if (!args.data && instance['download-file-pattern']) {
      const fetched = await downloadConfiguredExport(alias, instance, work);
      local = fetched.local;
      console.log(`file : ${fetched.name}`);
    } else {
      const units = args.data ? JSON.parse(readFileSync(path.resolve(args.data), 'utf8')) : DEFAULT_EXPORT;
      const dataFile = path.join(work, 'units.json');
      writeFileSync(dataFile, JSON.stringify(units));
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
    const folder = sitesFolderForDownload(instance, path.basename(local));
    if (folder) console.log(`folder : ${folder}`);
    const result = splitIntoProject(local, {
      updateRanks: args.flags.has('--update-ranks'),
      folder,
    });
    console.log(`download : ${result.written} files`);
    for (const key of result.added) console.log(`rank added : ${key}`);
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

async function uploadInstance(argv) {
  const args = parseArgs(argv);
  const name = args._[0];
  if (!name || args._.length > 1) {
    throw new Error('Usage: sfcc-data upload <instance> [--from sites-dev|sites|meta|test/<case>]');
  }
  const { connection: alias } = linkInstance(findProjectRoot(), name);
  const work = mkdtempSync(path.join(os.tmpdir(), 'sfcc-data-import-'));
  try {
    const zip = path.join(work, `sfcc-data-import-${Date.now()}.zip`);
    buildImportZip(zip, { from: args.from ?? 'sites-dev' });
    await uploadAndImport(alias, zip);
    console.log(`upload : ${path.basename(zip)} → ${alias.host}`);
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

async function completeInstances(project, { check }) {
  const gitignore = ensureGitignore(project, { check });
  const instances = ensureInstancesFile(project, { check });
  const fileExists = existsSync(instances.file);
  const missing = fileExists ? missingFields(readInstances(project)) : [INSTANCES_FILE];
  if (check) {
    const stale = [];
    if (!gitignore.present) stale.push(`.gitignore is missing ${INSTANCES_FILE}`);
    if (!fileExists) stale.push(instances.file);
    for (const field of missing) {
      if (field !== INSTANCES_FILE) stale.push(`${instances.file} ${field}`);
    }
    if (stale.length) {
      throw new Error(`sfcc-data init is out of date:\n${stale.join('\n')}\nRun: sfcc-data init`);
    }
    return { file: instances.file, created: false };
  }
  if (missing.length && missing[0] !== INSTANCES_FILE && isInteractive()) {
    const raw = readInstances(project);
    for (const field of missing) {
      const value = (await ask(`${field}: `, { secret: field.endsWith('password') })).trim();
      if (!value) throw new Error(`${field} is required`);
      setField(raw, field, value);
    }
    writeInstances(project, raw);
    return { file: instances.file, created: instances.created, filled: missing };
  }
  if (missing.length && missing[0] !== INSTANCES_FILE) {
    throw new Error(`${INSTANCES_FILE} is incomplete:\n${missing.join('\n')}\nFill them in, or run sfcc-data init in a terminal.`);
  }
  return { file: instances.file, created: instances.created, filled: [] };
}

async function init(argv) {
  const args = parseArgs(argv);
  rejectExtra(args);
  const project = args.project ? path.resolve(args.project) : findProjectRoot();
  const check = args.flags.has('--check');
  const result = installProject(project, { check });
  const instances = await completeInstances(project, { check });
  if (check) console.log('init : up to date');
  else {
    console.log(`config : ${result.configFile}${result.configCreated ? '' : ' (already present)'}`);
    console.log(`instances : ${instances.file}${instances.created ? '' : ' (already present)'}`);
    if (instances.filled?.length) console.log(`filled : ${instances.filled.join(', ')}`);
    console.log(`MCP : ${result.mcpFile}`);
    console.log(`rule : ${result.ruleFile}`);
  }
}

async function installJobs(argv) {
  const args = parseArgs(argv);
  if (args._[0] !== 'install') throw new Error('Usage: sfcc-data job install [instance...]');
  const root = findProjectRoot();
  const names = args._.slice(1);
  const selected = names.length ? names : Object.keys(readInstances(root).instances).filter((name) => name !== 'all');
  if (!selected.length) throw new Error(`No instance in ${INSTANCES_FILE}.`);
  for (const name of selected) {
    const { instance, connection } = linkInstance(root, name);
    const work = mkdtempSync(path.join(os.tmpdir(), 'sfcc-data-job-'));
    try {
      writeFileSync(path.join(work, 'jobs.xml'), exportJobXml(instance));
      const zip = path.join(work, `${EXPORT_JOB_ID}.zip`);
      execFileSync('zip', ['-q', zip, 'jobs.xml'], { cwd: work });
      await uploadAndImport(connection, zip);
      console.log(`job installed: ${EXPORT_JOB_ID} on ${name} (${connection.host})`);
    } finally {
      rmSync(work, { recursive: true, force: true });
    }
  }
}

function install(argv) {
  if (argv[0] !== 'mcp') throw new Error('Usage: sfcc-data install mcp [--project <dir>] [--check]');
  return init(argv.slice(1));
}

const commands = {
  compose,
  split,
  merge,
  init,
  install,
  'apply-export': (argv) => runApply(argv),
  'install-layout': installLayout,
  ocapi,
  job: installJobs,
  download: downloadInstance,
  upload: uploadInstance,
};

async function main() {
  const [command, ...rest] = process.argv.slice(2);
  if (!command || command === '--help' || command === '-h') {
    process.stdout.write(USAGE);
    process.exit(command ? 0 : 1);
  }
  const run = commands[command];
  if (!run) throw new Error(`Unknown command: ${command}\n\n${USAGE}`);
  await run(rest);
}

const isMain = process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
if (isMain) {
  main().catch((error) => {
    console.error(error.message || error);
    process.exit(1);
  });
}
