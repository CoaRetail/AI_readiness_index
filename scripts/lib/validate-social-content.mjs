/**
 * Validate per-channel social copy before scheduling / unlock.
 */
import path from 'node:path';
import { ROOT, articleUrl } from './insights-v2-paths.mjs';
import { CHANNEL_KEYS, CHANNEL_CONTENT_DIRS } from './social-channels.mjs';
import { loadChannelText, validateChannelContent } from './buffer-dispatcher.mjs';

export function validateSocialContentForSlug(slug, { root = ROOT, articleUrlOverride = null } = {}) {
  const url = articleUrlOverride || articleUrl(slug);
  const errors = [];

  for (const channel of CHANNEL_KEYS) {
    const rel = `${CHANNEL_CONTENT_DIRS[channel]}/${slug}.md`;
    const abs = path.join(root, rel);
    try {
      const text = loadChannelText(abs);
      const result = validateChannelContent(channel, text, url);
      if (!result.ok) {
        errors.push({ channel, file: rel, errors: result.errors });
      }
    } catch (error) {
      errors.push({ channel, file: rel, errors: [String(error?.message || error)] });
    }
  }

  return {
    ok: errors.length === 0,
    slug,
    errors,
  };
}

export function formatSocialValidationFailure(validation) {
  if (validation.ok) return '';
  return validation.errors
    .map(({ channel, errors }) => `${channel}: ${errors.join('; ')}`)
    .join(' | ');
}

function blockerCodeForSocialError(error) {
  return String(error).startsWith('duplicated ') ? 'SOCIAL_COPY_DUPLICATE' : 'SOCIAL_COPY_LENGTH';
}

/**
 * Blocking prepublish findings for articles that are still `scheduled`.
 * Uses the same trim + `text.length` rule as Buffer handoff (`validateChannelContent`).
 * Published and held articles are left alone: their copy is not waiting on this gate.
 */
export function socialCopyBlockersForEntry(slug, entry, { root = ROOT } = {}) {
  if (entry?.status !== 'scheduled') return [];
  const validation = validateSocialContentForSlug(slug, { root });
  if (validation.ok) return [];
  return validation.errors.flatMap(({ channel, errors }) => {
    const groups = new Map();
    for (const error of errors) {
      const code = blockerCodeForSocialError(error);
      if (!groups.has(code)) groups.set(code, []);
      groups.get(code).push(error);
    }
    return [...groups.entries()].map(([code, list]) => ({
      code,
      message: `${slug} ${channel}: ${list.join('; ')}`,
    }));
  });
}
