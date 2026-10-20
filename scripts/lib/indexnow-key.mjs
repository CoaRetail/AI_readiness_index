/**
 * Hosted IndexNow key. The file at the site root is the verification document
 * IndexNow fetches. It is public by design and is the source of truth for
 * submissions. INDEXNOW_KEY may match it; a different value cannot be verified
 * while this file is what the site serves.
 */
import fs from 'node:fs';
import path from 'node:path';

const KEY_FILE_RE = /^[a-zA-Z0-9-]{8,128}\.txt$/;

/**
 * @param {string} root
 * @returns {string|null}
 */
export function loadCommittedIndexNowKey(root) {
  if (!root || !fs.existsSync(root)) return null;
  const matches = [];
  for (const name of fs.readdirSync(root)) {
    if (!KEY_FILE_RE.test(name)) continue;
    const key = name.slice(0, -'.txt'.length);
    let body = '';
    try {
      body = fs.readFileSync(path.join(root, name), 'utf8').trim();
    } catch {
      continue;
    }
    if (body === key) matches.push({ key, name });
  }
  matches.sort((a, b) => a.name.localeCompare(b.name));
  return matches[0]?.key || null;
}

/**
 * @param {string} root
 * @param {string} key
 */
export function committedIndexNowKeyPath(root, key) {
  return path.join(root, `${key}.txt`);
}
