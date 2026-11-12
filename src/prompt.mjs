import readline from 'node:readline';
import { stdin, stdout } from 'node:process';

export function isInteractive() {
  return Boolean(stdin.isTTY && stdout.isTTY);
}

function question(rl, prompt) {
  return new Promise((resolve, reject) => {
    rl.once('error', reject);
    rl.question(prompt, resolve);
  });
}

export async function ask(prompt, { secret = false } = {}) {
  const rl = readline.createInterface({
    input: stdin,
    output: stdout,
    terminal: Boolean(stdin.isTTY),
  });
  if (secret) {
    const original = rl._writeToOutput.bind(rl);
    rl._writeToOutput = (text) => {
      if (String(text).includes(prompt)) original(text);
    };
  }
  try {
    const answer = (await question(rl, prompt)).trim();
    if (secret) stdout.write('\n');
    return answer;
  } finally {
    rl.close();
  }
}

export async function askYes(prompt) {
  const answer = (await ask(`${prompt} [y/N] `)).toLowerCase();
  return answer === 'y' || answer === 'yes' || answer === 'o' || answer === 'oui';
}
