import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const viteCli = fileURLToPath(new URL('../node_modules/vite/bin/vite.js', import.meta.url));
const envFile = existsSync(resolve(root, '.env')) && process.env.WORKSPACE_SKIP_ENV_FILE !== '1'
  ? ['--env-file=.env']
  : [];
const api = spawn(process.execPath, [...envFile, '--watch', 'server/index.js'], { cwd: root, stdio: 'inherit' });
const web = spawn(process.execPath, [viteCli, ...process.argv.slice(2)], { cwd: root, stdio: 'inherit' });
let shuttingDown = false;

function stop(code = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  api.kill('SIGTERM');
  web.kill('SIGTERM');
  process.exitCode = code;
}

api.on('exit', (code) => stop(code || 0));
web.on('exit', (code) => stop(code || 0));
process.on('SIGINT', () => stop(0));
process.on('SIGTERM', () => stop(0));
