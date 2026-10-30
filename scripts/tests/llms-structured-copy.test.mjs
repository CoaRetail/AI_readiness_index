import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

test('llms.txt Definitions use framework DefinedTerm descriptions', () => {
  const llms = read('llms.txt');
  const framework = read('framework/index.html');
  for (const term of ['Discovery', 'Recommendation', 'Action']) {
    const line = llms.match(new RegExp(`^- ${term}: (.+)$`, 'm'))?.[1];
    assert.ok(line, `${term} definition missing`);
    assert.ok(framework.includes(line), `${term} not found on framework page`);
  }
});

test('llms.txt /report/ FAQ answers are verbatim from report/index.html', () => {
  const report = read('report/index.html');
  const llms = read('llms.txt');
  const faqBlock = llms.match(/## FAQ: ARI診断レポート[\s\S]*?(?=\n## Core)/)?.[0] ?? '';
  const answers = [...faqBlock.matchAll(/^- .+?: (.+)$/gm)].map((m) => m[1]);
  assert.ok(answers.length >= 4);
  for (const answer of answers) {
    assert.ok(report.includes(answer), `report missing FAQ answer: ${answer.slice(0, 48)}…`);
  }
});
