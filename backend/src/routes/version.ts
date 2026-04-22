import { Router, Request, Response } from 'express';
import fs from 'fs';
import path from 'path';

type VersionInfo = {
  version: string;
  commit: string;
  branch: string;
  builtAt: string;
};

const fallback: VersionInfo = {
  version: 'unknown',
  commit: 'unknown',
  branch: 'unknown',
  builtAt: new Date().toISOString(),
};

function loadVersion(): VersionInfo {
  const candidates = [
    path.resolve(process.cwd(), 'dist/version.json'),
    path.resolve(process.cwd(), 'src/version.json'),
    path.resolve(process.cwd(), 'version.json'),
  ];
  for (const p of candidates) {
    try {
      if (fs.existsSync(p)) {
        return JSON.parse(fs.readFileSync(p, 'utf8')) as VersionInfo;
      }
    } catch {
      // ignore and try next
    }
  }
  return fallback;
}

const cached = loadVersion();

export const versionRouter = Router();

versionRouter.get('/', (_req: Request, res: Response) => {
  res.json(cached);
});
