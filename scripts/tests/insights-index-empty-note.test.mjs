import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  removeDuplicateEmptyNoteFragments,
  replaceInsightsIndexCards,
} from '../lib/insights-public-sync.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const BROKEN = `<!-- INSIGHTS_CARDS_START -->
      <a class="insight-card" href="/insights/example/" data-insight-slug="example"><h3>Example</h3></a>
    <p class="empty-note reveal" id="insights-empty" hidden>
      公開中の記事はまだありません。
    </p> hidden>
      公開中の記事はまだありません。
    </p> hidden>
      公開中の記事はまだありません。
    </p>
  </div>
</section>`;

test('replaceInsightsIndexCards consumes the broken empty-note tail', () => {
  const once = replaceInsightsIndexCards(BROKEN, '      <a class="insight-card">card</a>', {
    publishedCount: 2,
    hasPlanned: true,
  });
  assert.equal(once.includes('</p> hidden>'), false);
  assert.equal((once.match(/公開中の記事はまだありません。/g) || []).length, 1);
  assert.match(once, /id="insights-empty" hidden>/);
  const twice = replaceInsightsIndexCards(once, '      <a class="insight-card">card</a>', {
    publishedCount: 2,
    hasPlanned: true,
  });
  assert.equal((twice.match(/公開中の記事はまだありません。/g) || []).length, 1);
  assert.equal(twice.includes('</p> hidden>'), false);
  assert.match(twice, /insight-card">card<\/a>/);
});

test('duplicate fragment cleaner leaves one empty note', () => {
  const cleaned = removeDuplicateEmptyNoteFragments(BROKEN);
  assert.equal((cleaned.match(/公開中の記事はまだありません。/g) || []).length, 1);
  assert.equal(cleaned.includes('hidden>'), true);
  assert.equal(cleaned.includes('</p> hidden>'), false);
});

test('checked-in insights index has a single empty note', () => {
  const html = fs.readFileSync(path.join(ROOT, 'insights/index.html'), 'utf8');
  assert.equal(html.includes('</p> hidden>'), false);
  assert.equal((html.match(/公開中の記事はまだありません。/g) || []).length, 1);
  assert.match(html, /<p class="empty-note reveal" id="insights-empty" hidden>\s*公開中の記事はまだありません。\s*<\/p>/);
});
