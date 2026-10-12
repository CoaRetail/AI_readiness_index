import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
import { socialCopyBlockersForEntry, validateSocialContentForSlug } from '../lib/validate-social-content.mjs';
import { CHANNEL_CONTENT_DIRS } from '../lib/social-channels.mjs';
import { validateChannelContent } from '../lib/buffer-dispatcher.mjs';
import { findDuplicatedSocialUnits } from '../lib/social-copy-units.mjs';

const VENDOR_SENTENCE = '施策を増やしてもAIに選ばれない理由は、情報の連続性の欠如にあることがあります。';

function writeSocial(root, slug, channel, body) {
  const dir = path.join(root, CHANNEL_CONTENT_DIRS[channel]);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${slug}.md`), body, 'utf8');
}

test('validateSocialContentForSlug passes compliant copy', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ari-social-validate-'));
  const slug = 'sample-article';
  const url = `https://readiness.coaretail.com/insights/${slug}/`;
  writeSocial(root, slug, 'linkedin', `${'a'.repeat(450)} ${url} #AgentReadiness #AI`);
  writeSocial(root, slug, 'facebook', `${'b'.repeat(300)} ${url} #AI`);
  writeSocial(root, slug, 'x', `${'c'.repeat(80)} ${url} #AI`);
  const result = validateSocialContentForSlug(slug, { root, articleUrlOverride: url });
  assert.equal(result.ok, true);
  fs.rmSync(root, { recursive: true, force: true });
});

test('validateSocialContentForSlug fails short linkedin copy', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ari-social-validate-'));
  const slug = 'short-copy';
  const url = `https://readiness.coaretail.com/insights/${slug}/`;
  writeSocial(root, slug, 'linkedin', `too short ${url} #AgentReadiness #AI`);
  writeSocial(root, slug, 'facebook', `${'b'.repeat(300)} ${url} #AI`);
  writeSocial(root, slug, 'x', `${'c'.repeat(80)} ${url} #AI`);
  const result = validateSocialContentForSlug(slug, { root, articleUrlOverride: url });
  assert.equal(result.ok, false);
  assert.equal(result.errors[0].channel, 'linkedin');
  fs.rmSync(root, { recursive: true, force: true });
});

test('socialCopyBlockersForEntry blocks scheduled copy outside Buffer length', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ari-social-validate-'));
  const slug = 'short-copy';
  const url = `https://readiness.coaretail.com/insights/${slug}/`;
  writeSocial(root, slug, 'linkedin', `too short ${url} #AgentReadiness #AI`);
  writeSocial(root, slug, 'facebook', `${'b'.repeat(300)} ${url} #AI`);
  writeSocial(root, slug, 'x', `${'c'.repeat(80)} ${url} #AI`);
  const blockers = socialCopyBlockersForEntry(slug, { status: 'scheduled' }, { root });
  assert.equal(blockers.length, 1);
  assert.equal(blockers[0].code, 'SOCIAL_COPY_LENGTH');
  assert.match(blockers[0].message, /linkedin: length \d+ outside 450-900/);
  assert.deepEqual(socialCopyBlockersForEntry(slug, { status: 'published' }, { root }), []);
  fs.rmSync(root, { recursive: true, force: true });
});

test('vendor-selection LinkedIn copy is rejected for the sentence repeated four times', () => {
  const text = fs.readFileSync(
    path.join(ROOT, 'insights/_social/linkedin/posts/vendor-selection.md'),
    'utf8',
  ).trim();
  assert.equal((text.split(VENDOR_SENTENCE).length - 1), 4);
  const url = 'https://readiness.coaretail.com/insights/vendor-selection/';
  const result = validateChannelContent('linkedin', text, url);
  assert.equal(result.ok, false);
  assert.match(result.errors.join('\n'), /duplicated sentence \(4\): 施策を増やしてもAIに選ばれない理由は、情報の連続性の欠如にあることがあります。/);
  assert.equal(result.errors.some((error) => error.startsWith('length ')), false);
});

test('whitespace-normalized repeats of the vendor-selection sentence are duplicates', () => {
  const spaced = '施策を増やしてもAIに選ばれない理由は、  情報の連続性の欠如にあることがあります。';
  const text = `${VENDOR_SENTENCE}\n\n${spaced}`;
  const units = findDuplicatedSocialUnits(text);
  assert.ok(units.some((unit) => unit.kind === 'sentence' && unit.count === 2 && unit.text === VENDOR_SENTENCE));
});

test('socialCopyBlockersForEntry blocks a scheduled duplicate sentence', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ari-social-dup-'));
  const slug = 'vendor-selection';
  const url = `https://readiness.coaretail.com/insights/${slug}/`;
  const linkedin = fs.readFileSync(
    path.join(ROOT, 'insights/_social/linkedin/posts/vendor-selection.md'),
    'utf8',
  );
  writeSocial(root, slug, 'linkedin', linkedin);
  writeSocial(root, slug, 'facebook', `${'b'.repeat(300)} ${url} #AI`);
  writeSocial(root, slug, 'x', `${'c'.repeat(80)} ${url} #AI`);
  const blockers = socialCopyBlockersForEntry(slug, { status: 'scheduled' }, { root });
  assert.ok(
    blockers.some((b) => b.code === 'SOCIAL_COPY_DUPLICATE' && b.message.includes('duplicated sentence')),
    JSON.stringify(blockers),
  );
  assert.deepEqual(socialCopyBlockersForEntry(slug, { status: 'published' }, { root }), []);
  fs.rmSync(root, { recursive: true, force: true });
});

test('10/07 Facebook copy is rejected for its repeated closing sentences', () => {
  const text = fs.readFileSync(
    path.join(ROOT, 'insights/_social/facebook/posts/uk-cma-choice-screens-three-shelves.md'),
    'utf8',
  ).trim();
  const result = validateChannelContent(
    'facebook',
    text,
    'https://readiness.coaretail.com/insights/uk-cma-choice-screens-three-shelves/',
  );
  assert.equal(result.ok, false);
  assert.match(result.errors.join('\n'), /duplicated sentence \(2\): 出典は本文の一次情報に置いています。/);
  assert.match(result.errors.join('\n'), /duplicated sentence \(2\): 推測の数字は足していません。/);
});
