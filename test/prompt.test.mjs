import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function runAsk(secret) {
  const script = `
    import { ask } from './src/prompt.mjs';
    const answer = await ask('Alias: ', { secret: ${secret} });
    process.stdout.write('ANSWER:' + answer);
  `;
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--input-type=module', '-e', script], { cwd: root });
    let out = '';
    let err = '';
    child.stdout.on('data', (chunk) => { out += chunk; });
    child.stderr.on('data', (chunk) => { err += chunk; });
    child.on('error', reject);
    child.on('close', (code) => resolve({ code, out, err }));
    child.stdin.write('stg\n');
    child.stdin.end();
  });
}

test('ask reads a line without the promises readline bind crash', async () => {
  const plain = await runAsk(false);
  assert.equal(plain.code, 0, plain.err);
  assert.match(plain.out, /ANSWER:stg/);

  const secret = await runAsk(true);
  assert.equal(secret.code, 0, secret.err);
  assert.match(secret.out, /ANSWER:stg/);
  assert.doesNotMatch(secret.err, /bind/);
});
