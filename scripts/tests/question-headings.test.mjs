import test from 'node:test';
import assert from 'node:assert/strict';
import { validateQuestionShapedHeadings } from '../lib/question-headings.mjs';

test('question headings accept an answer paragraph and exempt structural H2s', () => {
  const markdown = `
## 料金はいくらですか？

¥29,800（税別）です。

- プランは1つ

## 関連リソース

テンプレート側の見出しは本文規則の対象外です。
`;
  const result = validateQuestionShapedHeadings(markdown);
  assert.equal(result.ok, true, JSON.stringify(result.issues));
});

test('question headings reject a label and a list-first section', () => {
  const markdown = `
## 背景にある構造

説明が先にありません。

## 何を確認するか？

- 箇条書きから始まっている
`;
  const result = validateQuestionShapedHeadings(markdown);
  assert.equal(result.ok, false);
  assert.ok(result.issues.some((issue) => issue.code === 'h2_not_question'));
  assert.ok(result.issues.some((issue) => issue.code === 'answer_not_first'));
});
