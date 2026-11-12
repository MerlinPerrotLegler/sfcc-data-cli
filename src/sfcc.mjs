import { execFileSync } from 'node:child_process';
import { createReadStream, createWriteStream, readFileSync, statSync } from 'node:fs';
import https from 'node:https';
import os from 'node:os';
import path from 'node:path';
import tls from 'node:tls';

const OCAPI_DATA = '/s/-/dw/data/v19_5';

export const DEFAULT_EXPORT = {
  global_data: {
    csrf_whitelists: true,
    custom_preference_groups: true,
    custom_quota_settings: true,
    custom_types: true,
    geolocations: true,
    global_custom_objects: true,
    job_schedules: true,
    locales: true,
    meta_data: true,
    oauth_providers: true,
    page_meta_tags: true,
    preferences: true,
    price_adjustment_limits: true,
    services: true,
    sorting_rules: true,
    static_resources: true,
    system_type_definitions: true,
  },
  sites: { all: true },
  catalogs: { all: true },
  catalog_static_resources: { all: true },
  libraries: { all: true },
  library_static_resources: { all: true },
  inventory_lists: { all: true },
  price_books: { all: true },
};

export function hostnameOf(url) {
  const withProto = /^https?:\/\//i.test(url) ? url : `https://${url}`;
  const host = new URL(withProto).host;
  if (!host) throw new Error(`URL d'instance illisible : ${url}`);
  return host;
}

export function authEnv(alias) {
  return {
    SFCC_OAUTH_CLIENT_ID: alias.clientId,
    SFCC_OAUTH_CLIENT_SECRET: alias.clientSecret,
  };
}

export function certificateArgs(alias) {
  if (!alias.staging || !alias.certificate) return [];
  const args = ['-c', alias.certificate];
  if (alias.passphrase) args.push('-p', alias.passphrase);
  return args;
}

export function newestDownloadFile(entries, pattern) {
  const source = String(pattern || '');
  if (!source) throw new Error('download-file-pattern is empty.');
  const expression = new RegExp(`^${source
    .replace(/[.+?^${}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '.*')}$`, 'i');
  const matches = entries.filter((entry) => expression.test(entry.name) && !entry.collection);
  if (!matches.length) {
    throw new Error(`No WebDAV file matches ${source}.`);
  }
  return matches.sort((left, right) => {
    const leftTime = Date.parse(left.modified || '') || 0;
    const rightTime = Date.parse(right.modified || '') || 0;
    if (leftTime !== rightTime) return rightTime - leftTime;
    return right.name.localeCompare(left.name);
  })[0];
}

export function webdavInstancePath(file) {
  const name = file.toLowerCase().endsWith('.zip') ? file : `${file}.zip`;
  return `/impex/src/instance/${name}`;
}

function sfccMissing(error) {
  return error?.code === 'ENOENT' || error?.status === 127;
}

export function runSfcc(args, env = {}) {
  try {
    execFileSync('sfcc-ci', args, {
      stdio: 'inherit',
      cwd: os.tmpdir(),
      env: { ...process.env, ...env },
    });
  } catch (error) {
    if (sfccMissing(error)) throw new Error('sfcc-ci introuvable. Installez-le : npm install -g sfcc-ci');
    throw error;
  }
}

export function sfccToken(env = {}) {
  let out = '';
  try {
    out = execFileSync('sfcc-ci', ['client:auth:token'], {
      encoding: 'utf8',
      cwd: os.tmpdir(),
      env: { ...process.env, ...env },
    });
  } catch (error) {
    if (sfccMissing(error)) throw new Error('sfcc-ci introuvable. Installez-le : npm install -g sfcc-ci');
    throw error;
  }
  const line = out.trim().split('\n').filter(Boolean).pop();
  if (!line || line.includes(' ')) throw new Error('sfcc-ci client:auth:token n\'a pas rendu de jeton');
  return line;
}

export function authenticate(alias) {
  runSfcc(['client:auth'], authEnv(alias));
}

function ocapiJson({ host, method, requestPath, token, body, certificate, passphrase }) {
  const payload = body == null ? null : JSON.stringify(body);
  const headers = {
    Authorization: `Bearer ${token}`,
    Accept: 'application/json',
  };
  if (payload) {
    headers['Content-Type'] = 'application/json';
    headers['Content-Length'] = Buffer.byteLength(payload);
  }
  const options = {
    protocol: 'https:',
    hostname: host.split(':')[0],
    method,
    path: requestPath,
    headers,
  };
  if (certificate) {
    options.pfx = readFileSync(certificate);
    if (passphrase) options.passphrase = passphrase;
  }
  return new Promise((resolve, reject) => {
    const req = https.request(options, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        let parsed = null;
        if (text) {
          try {
            parsed = JSON.parse(text);
          } catch {
            parsed = null;
          }
        }
        resolve({ status: res.statusCode, body: parsed });
      });
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

function jobStartError(jobId, host, response) {
  const fault = response.body?.fault;
  const message = fault?.message || `HTTP ${response.status}`;
  const hint = fault?.type === 'ClientAccessForbiddenException'
    ? ' In Business Manager, open Administration > Site Development > Open Commerce API Settings, select the Data API, and allow this client to POST /jobs/*/executions and GET /jobs/*/executions/*.'
    : '';
  return new Error(`Starting job "${jobId}" on ${host} failed: ${message}${hint}`);
}

export async function importInstanceArchive(alias, fileName) {
  const name = fileName.toLowerCase().endsWith('.zip') ? fileName : `${fileName}.zip`;
  // sfcc-ci 2.13 instance:import has no certificate option. Staging OCAPI needs the P12.
  if (alias.staging && alias.certificate) {
    return importArchiveWithCertificate(alias, name);
  }
  runSfcc([
    'instance:import', name,
    '-i', alias.host,
    '-s',
    '--failfast',
  ], authEnv(alias));
}

async function importArchiveWithCertificate(alias, fileName) {
  const token = sfccToken(authEnv(alias));
  const host = alias.host.split(':')[0];
  const certificate = alias.certificate;
  const jobId = 'sfcc-site-archive-import';
  const started = await ocapiJson({
    host,
    method: 'POST',
    requestPath: `${OCAPI_DATA}/jobs/${jobId}/executions`,
    token,
    body: { file_name: fileName },
    certificate,
    passphrase: alias.passphrase,
  });
  if (started.status !== 200 && started.status !== 202) throw jobStartError(jobId, host, started);
  const executionId = started.body?.id;
  if (!executionId) throw new Error(`Starting job "${jobId}" on ${host} failed: no execution id`);
  console.log(`Job "${jobId}" started on ${host}. Execution id is: ${executionId}`);
  for (;;) {
    await new Promise((resolve) => setTimeout(resolve, 5000));
    const status = await ocapiJson({
      host,
      method: 'GET',
      requestPath: `${OCAPI_DATA}/jobs/${jobId}/executions/${executionId}`,
      token,
      certificate,
      passphrase: alias.passphrase,
    });
    if (status.status !== 200) {
      const message = status.body?.fault?.message || `HTTP ${status.status}`;
      throw new Error(`Polling job "${jobId}" on ${host} failed: ${message}`);
    }
    if (status.body.status === 'RUNNING') continue;
    const exitStatus = status.body.exit_status;
    if (exitStatus && exitStatus.status === 'error') {
      const detail = exitStatus.message ? ` ${exitStatus.message}` : '';
      throw new Error(`Job "${jobId}" on ${host} ended with error.${detail}`);
    }
    console.log(`Job "${jobId}" finished on ${host}. Status is: ${status.body.execution_status} (${status.body.status})`);
    return status.body;
  }
}

export async function uploadAndImport(alias, zipPath) {
  authenticate(alias);
  await putInstanceZip(alias, zipPath);
  await importInstanceArchive(alias, path.basename(zipPath));
}

export function exportOnInstance(alias, { dataFile, file }) {
  authenticate(alias);
  runSfcc([
    'instance:export',
    '-i', alias.host,
    '--data', dataFile,
    '--file', file,
    '-s',
    '--failfast',
  ], authEnv(alias));
}

function webdavFailure(status, host, remotePath) {
  const where = `${host}${remotePath}`;
  if (status === 521) {
    return new Error(`WebDAV 521 on ${where}. The instance is not running. Start it, then retry.`);
  }
  return new Error(`WebDAV ${status} on ${where}`);
}

function authorizationHeader({ token, user, password }) {
  if (user && password) {
    return `Basic ${Buffer.from(`${user}:${password}`).toString('base64')}`;
  }
  if (token) return `Bearer ${token}`;
  throw new Error('WebDAV needs a user and password, or an OCAPI token');
}

function attachCertificate(options, certificate, passphrase) {
  if (!certificate) return;
  const pfx = readFileSync(certificate);
  try {
    tls.createSecureContext({ pfx, passphrase: passphrase || undefined });
  } catch (error) {
    console.warn(`Skipping certificate ${certificate}: ${error.message}`);
    return;
  }
  options.pfx = pfx;
  if (passphrase) options.passphrase = passphrase;
}

function webdavOptions({ host, remotePath, method, token, user, password, certificate, passphrase }) {
  const options = {
    protocol: 'https:',
    hostname: host,
    path: `/on/demandware.servlet/webdav/Sites${remotePath}`,
    method,
    headers: { Authorization: authorizationHeader({ token, user, password }) },
  };
  attachCertificate(options, certificate, passphrase);
  return options;
}

export function parseWebdavListing(xml) {
  return String(xml).split(/<response\b/i).slice(1).map((block) => ({
    name: block.match(/<displayname>([^<]*)<\/displayname>/i)?.[1] || '',
    modified: block.match(/<getlastmodified>([^<]*)<\/getlastmodified>/i)?.[1] || '',
    collection: /<collection\s*\/>/i.test(block),
  })).filter((entry) => entry.name);
}

export function listWebdav({ host, remotePath, token, user, password, certificate, passphrase }) {
  const options = webdavOptions({
    host, remotePath, method: 'PROPFIND', token, user, password, certificate, passphrase,
  });
  options.headers.Depth = '1';
  return new Promise((resolve, reject) => {
    const req = https.request(options, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        if (res.statusCode !== 207 && res.statusCode !== 200) {
          reject(webdavFailure(res.statusCode, host, remotePath));
          return;
        }
        resolve(parseWebdavListing(text));
      });
    });
    req.on('error', reject);
    req.end();
  });
}

function webdavAuth(alias) {
  return {
    host: alias.host.split(':')[0],
    token: alias.webdavUser && alias.webdavPassword ? '' : sfccToken(authEnv(alias)),
    user: alias.webdavUser,
    password: alias.webdavPassword,
    certificate: alias.staging ? alias.certificate : '',
    passphrase: alias.passphrase,
  };
}

export async function downloadConfiguredExport(alias, instance, destDir) {
  const pattern = instance['download-file-pattern'];
  const auth = webdavAuth(alias);
  const entries = await listWebdav({ ...auth, remotePath: '/impex/src/instance/' });
  const file = newestDownloadFile(entries, pattern);
  const local = path.join(destDir, file.name);
  await downloadWebdav({ ...auth, remotePath: webdavInstancePath(file.name), dest: local });
  return { local, name: file.name };
}

export function downloadWebdav({ host, remotePath, dest, token, user, password, certificate, passphrase }) {
  const options = webdavOptions({
    host, remotePath, method: 'GET', token, user, password, certificate, passphrase,
  });
  return new Promise((resolve, reject) => {
    const req = https.request(options, (res) => {
      if (res.statusCode !== 200) {
        res.resume();
        reject(webdavFailure(res.statusCode, host, remotePath));
        return;
      }
      const file = createWriteStream(dest);
      res.pipe(file);
      file.on('finish', () => file.close(() => resolve(dest)));
      file.on('error', reject);
    });
    req.on('error', reject);
    req.end();
  });
}

export function uploadWebdav({ host, remotePath, file, token, user, password, certificate, passphrase }) {
  const options = webdavOptions({
    host, remotePath, method: 'PUT', token, user, password, certificate, passphrase,
  });
  options.headers['Content-Length'] = statSync(file).size;
  return new Promise((resolve, reject) => {
    const req = https.request(options, (res) => {
      res.resume();
      if (res.statusCode !== 200 && res.statusCode !== 201 && res.statusCode !== 204) {
        reject(webdavFailure(res.statusCode, host, remotePath));
        return;
      }
      resolve(file);
    });
    req.on('error', reject);
    createReadStream(file).pipe(req);
  });
}

export async function putInstanceZip(alias, zipPath) {
  if (alias.webdavUser && alias.webdavPassword) {
    await uploadWebdav({
      host: alias.host.split(':')[0],
      remotePath: webdavInstancePath(path.basename(zipPath)),
      file: zipPath,
      user: alias.webdavUser,
      password: alias.webdavPassword,
      certificate: alias.staging ? alias.certificate : '',
      passphrase: alias.passphrase,
    });
    return;
  }
  runSfcc(['instance:upload', zipPath, '-i', alias.host, ...certificateArgs(alias)], authEnv(alias));
}
