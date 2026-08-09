import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const workerConfig = readFileSync(new URL('../worker/wrangler.jsonc', import.meta.url), 'utf8');
const corsExample = JSON.parse(readFileSync(new URL('../worker/r2-cors.example.json', import.meta.url), 'utf8'));
const gitignore = readFileSync(new URL('../.gitignore', import.meta.url), 'utf8');

const requiredPlaceholders = [
  'REPLACE_WITH_D1_DATABASE_ID',
  'REPLACE_WITH_CLOUDFLARE_ACCOUNT_ID',
  'https://files.example.com',
];

for (const placeholder of requiredPlaceholders) {
  if (!workerConfig.includes(placeholder)) {
    throw new Error(`public Worker config must retain placeholder: ${placeholder}`);
  }
}

for (const ignored of ['worker/wrangler.production.local.jsonc', 'worker/r2-cors.production.local.json']) {
  if (!gitignore.split(/\r?\n/).includes(ignored)) {
    throw new Error(`local production config must be ignored: ${ignored}`);
  }
}

for (const rule of corsExample.rules ?? []) {
  for (const origin of rule.allowed?.origins ?? []) {
    const hostname = new URL(origin).hostname;
    if (hostname !== 'localhost' && hostname !== '127.0.0.1' && !hostname.endsWith('.example.com')) {
      throw new Error(`CORS example contains a non-example origin: ${origin}`);
    }
  }
}

const scan = spawnSync('git', ['grep', '-n', '-I', '-E',
  String.raw`/Users/[^/[:space:]]+|[[:alnum:]._%+-]+@(gmail|qq|outlook|hotmail|icloud)\.[[:alpha:]]+`,
  '--', '.'], { encoding: 'utf8' });

if (scan.status !== 0 && scan.status !== 1) {
  throw new Error(`identity scan failed: ${scan.stderr}`);
}
if (scan.stdout.trim()) {
  throw new Error(`tracked files contain local identity data:\n${scan.stdout}`);
}

console.log('public repository configuration contains placeholders only');
