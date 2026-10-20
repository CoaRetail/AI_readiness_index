/**
 * Insight H2s are real user questions. The first block under each H2 answers
 * that question before lists, asides, or further detail.
 *
 * Structural headings inserted by the page template (related links, resource
 * CTA) are not article sections.
 *
 * Already published articles are not rewritten to satisfy this. The generator
 * and new drafts are. Pre-publish gates do not fail reserved articles on it.
 */

export const STRUCTURAL_H2S = new Set([
  '関連Insights',
  '関連するInsights',
  '関連Insight',
  '関連リソース',
  '次のリソース',
]);

/**
 * @param {string} title
 */
export function isQuestionHeading(title) {
  const text = String(title || '').replace(/<[^>]+>/g, '').trim();
  if (!text) return false;
  if (STRUCTURAL_H2S.has(text)) return true;
  return /[?？]\s*$/.test(text);
}

/**
 * @param {string} markdown
 */
function markdownSections(markdown) {
  const lines = String(markdown || '').split(/\r?\n/);
  const sections = [];
  let current = null;
  for (const line of lines) {
    if (line.startsWith('## ')) {
      if (current) sections.push(current);
      current = { title: line.slice(3).trim(), body: [] };
      continue;
    }
    if (current) current.body.push(line);
  }
  if (current) sections.push(current);
  return sections.map((section) => {
    const content = section.body.map((line) => line.trim()).filter(Boolean);
    const first = content[0] || '';
    const openingKind = /^[-*]\s/.test(first) || /^\d+\.\s/.test(first)
      ? 'list'
      : first.startsWith('>')
        ? 'quote'
        : first
          ? 'paragraph'
          : 'empty';
    return { title: section.title, opening: first, openingKind };
  });
}

/**
 * @param {string} html
 */
function htmlSections(html) {
  const article = String(html || '').match(/<article\b[^>]*class="[^"]*article-body[^"]*"[\s\S]*?<\/article>/i)?.[0]
    || String(html || '');
  const re = /<h2>([^<]*)<\/h2>([\s\S]*?)(?=<h2>|$)/gi;
  const sections = [];
  let match;
  while ((match = re.exec(article))) {
    const rest = match[2] || '';
    const paragraph = rest.match(/<p(?:\s[^>]*)?>([\s\S]*?)<\/p>/i);
    const list = rest.match(/<(ul|ol)\b/i);
    const paragraphAt = paragraph ? rest.indexOf(paragraph[0]) : -1;
    const listAt = list ? rest.indexOf(list[0]) : -1;
    const openingKind = paragraph && (listAt < 0 || paragraphAt < listAt)
      ? 'paragraph'
      : list
        ? 'list'
        : 'empty';
    const opening = paragraph ? paragraph[1].replace(/<[^>]+>/g, '').trim() : '';
    sections.push({ title: match[1].trim(), opening, openingKind });
  }
  return sections;
}

/**
 * @param {string} source
 * @param {{ format?: 'markdown'|'html' }} [opts]
 * @returns {{ ok: boolean, issues: { code: string, title: string }[] }}
 */
export function validateQuestionShapedHeadings(source, { format = 'markdown' } = {}) {
  const sections = format === 'html' ? htmlSections(source) : markdownSections(source);
  const issues = [];
  for (const section of sections) {
    if (STRUCTURAL_H2S.has(section.title)) continue;
    if (!isQuestionHeading(section.title)) {
      issues.push({ code: 'h2_not_question', title: section.title });
    }
    if (section.openingKind !== 'paragraph' || !section.opening) {
      issues.push({ code: 'answer_not_first', title: section.title });
    }
  }
  return { ok: issues.length === 0, issues };
}
