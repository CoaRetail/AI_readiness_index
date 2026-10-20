#!/usr/bin/env node
/**
 * Copy the hosted IndexNow key into the deploy output.
 *
 * The key file lives at the repo root (`{key}.txt`) and is copied to
 * public_build/ by this script, which `build:all` runs. Vercel therefore
 * serves https://readiness.coaretail.com/{key}.txt even when INDEXNOW_KEY
 * is unset in the Vercel project.
 *
 * A previous INDEXNOW_KEY that is not this file is also written, so an
 * in-flight secret still has a verification URL, but submissions use the
 * committed file.
 *
 * Usage:
 *   node scripts/generate-indexnow-key-file.mjs [--out public_build] [--env-only]
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateIndexNowKey, maskIndexNowKey } from './lib/indexnow-client.mjs';
import { loadCommittedIndexNowKey } from './lib/indexnow-key.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

const outArgIdx = process.argv.indexOf('--out');
const outDir = outArgIdx >= 0 ? path.resolve(process.argv[outArgIdx + 1]) : path.join(ROOT, 'public_build');
const envOnly = process.argv.includes('--env-only');

function writeKeyFile(key) {
  fs.mkdirSync(outDir, { recursive: true });
  const filePath = path.join(outDir, `${key}.txt`);
  fs.writeFileSync(filePath, `${key}\n`, 'utf8');
  console.log(`IndexNow key file: wrote ${filePath} (key ${maskIndexNowKey(key)})`);
}

const committed = envOnly ? null : loadCommittedIndexNowKey(ROOT);
if (committed) writeKeyFile(committed);

const envKey = process.env.INDEXNOW_KEY;
if (!envKey) {
  if (!committed) {
    console.warn('IndexNow key file: SKIPPED — no hosted key file and INDEXNOW_KEY is unset');
    process.exit(0);
  }
  process.exit(0);
}

const keyCheck = validateIndexNowKey(envKey);
if (!keyCheck.ok) {
  console.warn(`IndexNow key file: SKIPPED env key — ${keyCheck.error}`);
  process.exit(committed ? 0 : 0);
}

if (envKey === committed) process.exit(0);

if (committed) {
  console.warn(`IndexNow: INDEXNOW_KEY ${maskIndexNowKey(envKey)} does not match hosted key ${maskIndexNowKey(committed)}. Submissions use the hosted file.`);
}
writeKeyFile(envKey);
