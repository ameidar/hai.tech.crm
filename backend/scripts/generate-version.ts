import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const backendRoot = path.resolve(__dirname, '..');
const repoRoot = path.resolve(backendRoot, '..');

function tryGit(cmd: string, cwd: string): string | null {
  try {
    return execSync(cmd, { cwd, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
  } catch {
    return null;
  }
}

const pkg = JSON.parse(fs.readFileSync(path.join(backendRoot, 'package.json'), 'utf8'));

const version = process.env.APP_VERSION || pkg.version || '0.0.0';
const commit =
  process.env.COMMIT_SHA ||
  tryGit('git rev-parse --short HEAD', repoRoot) ||
  tryGit('git rev-parse --short HEAD', backendRoot) ||
  'unknown';
const branch =
  process.env.GIT_BRANCH ||
  tryGit('git rev-parse --abbrev-ref HEAD', repoRoot) ||
  'unknown';
const builtAt = process.env.BUILD_TIME || new Date().toISOString();

const info = { version, commit, branch, builtAt };

const outPath = path.join(backendRoot, 'src', 'version.json');
fs.writeFileSync(outPath, JSON.stringify(info, null, 2) + '\n');

console.log(`[version] wrote ${outPath}: ${JSON.stringify(info)}`);
