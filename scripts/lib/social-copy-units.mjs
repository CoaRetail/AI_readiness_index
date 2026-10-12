/**
 * Sentence and paragraph units for social copy.
 *
 * Short copy is a validation failure. Do not pad it by repeating a sentence
 * or paragraph until a channel minimum is met.
 */

const SENTENCE_SPLIT = /(?<=[。！？])/u;

export function normalizeSocialWhitespace(text) {
  return String(text).replace(/\s+/gu, ' ').trim();
}

function hasLetterOrNumber(text) {
  return /[\p{L}\p{N}]/u.test(text);
}

function stripSocialChrome(text) {
  return String(text)
    .replace(/https?:\/\/\S+/g, '\n')
    .replace(/#[\p{L}\p{N}_]+/gu, '\n');
}

function comparisonKey(text) {
  return text.replace(/\s+/gu, '');
}

function duplicated(items, kind) {
  const counts = new Map();
  const display = new Map();
  for (const item of items) {
    const key = comparisonKey(item);
    if (!key || key.length < 8 || !hasLetterOrNumber(key)) continue;
    counts.set(key, (counts.get(key) || 0) + 1);
    if (!display.has(key)) display.set(key, item);
  }
  return [...counts.entries()]
    .filter(([, count]) => count > 1)
    .map(([key, count]) => ({ kind, text: display.get(key), count }));
}

/**
 * @returns {{ kind: 'paragraph' | 'sentence', text: string, count: number }[]}
 */
export function findDuplicatedSocialUnits(text) {
  const stripped = stripSocialChrome(text);
  const paragraphs = stripped
    .split(/\n\s*\n/u)
    .map(normalizeSocialWhitespace)
    .filter(Boolean);
  const lines = stripped
    .split(/\n/u)
    .map(normalizeSocialWhitespace)
    .filter(Boolean);
  const sentences = [];
  for (const paragraph of paragraphs) {
    const parts = paragraph.split(SENTENCE_SPLIT).map(normalizeSocialWhitespace).filter(Boolean);
    if (parts.length) sentences.push(...parts);
    else sentences.push(paragraph);
  }
  const found = [
    ...duplicated(paragraphs, 'paragraph'),
    ...duplicated(lines, 'paragraph'),
    ...duplicated(sentences, 'sentence'),
  ];
  const byKey = new Map();
  for (const unit of found) {
    const key = `${unit.kind}\0${unit.text}`;
    const prev = byKey.get(key);
    if (!prev || unit.count > prev.count) byKey.set(key, unit);
  }
  return [...byKey.values()];
}

export function formatDuplicatedSocialUnit(unit) {
  const sample = unit.text.length > 80 ? `${unit.text.slice(0, 80)}…` : unit.text;
  return `duplicated ${unit.kind} (${unit.count}): ${sample}`;
}
