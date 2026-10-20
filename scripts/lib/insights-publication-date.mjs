import fs from 'node:fs';
import path from 'node:path';

const YMD_RE = /^\d{4}-\d{2}-\d{2}$/;

function toJstDateParts(iso) {
  if (!iso) return null;

  if (YMD_RE.test(iso)) {
    const [y, m, day] = iso.split('-');
    return { ymd: iso, dot: `${y}.${m}.${day}` };
  }

  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;

  const y = d.toLocaleString('en-CA', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric',
  });
  const m = d.toLocaleString('en-CA', {
    timeZone: 'Asia/Tokyo',
    month: '2-digit',
  });
  const day = d.toLocaleString('en-CA', {
    timeZone: 'Asia/Tokyo',
    day: '2-digit',
  });

  return {
    ymd: `${y}-${m}-${day}`,
    dot: `${y}.${m}.${day}`,
  };
}

/** Parse canonical listing dates from insights/index.html cards. */
export function parseListingInsightDates(indexHtml) {
  const dates = new Map();
  const re = /data-insight-slug="([^"]+)"[\s\S]*?<time datetime="(\d{4}-\d{2}-\d{2})"/g;
  let match;
  while ((match = re.exec(indexHtml))) {
    dates.set(match[1], match[2]);
  }
  return dates;
}

export function extractInsightPublicationDate(html) {
  const jsonLd = html.match(/"datePublished"\s*:\s*"(\d{4}-\d{2}-\d{2})"/);
  if (jsonLd) return jsonLd[1];
  const time = html.match(/<time\b[^>]*datetime="(\d{4}-\d{2}-\d{2})"/);
  return time?.[1] || null;
}

export function syncInsightPublicationDateToYmd(html, ymd) {
  const parts = toJstDateParts(ymd);
  if (!parts) {
    return {
      html,
      changed: false,
      reason: 'missing_or_invalid_ymd',
    };
  }

  const { dot } = parts;
  let next = html;

  next = next.replace(
    /("datePublished"\s*:\s*")\d{4}-\d{2}-\d{2}(")/,
    `$1${ymd}$2`
  );

  const modified = next.match(/"dateModified"\s*:\s*"(\d{4}-\d{2}-\d{2})"/);
  if (!modified || modified[1] <= ymd) {
    next = next.replace(
      /("dateModified"\s*:\s*")\d{4}-\d{2}-\d{2}(")/,
      `$1${ymd}$2`
    );
  }

  next = next.replace(
    /(<p class="article-meta">\s*)<time\b[\s\S]*?<\/time>/,
    `$1<time datetime="${ymd}">${dot}</time>`
  );

  next = next.replace(
    /(Version 1\.0 · Last Updated )\d{4}-\d{2}-\d{2}/,
    `$1${ymd}`
  );

  return {
    html: next,
    changed: next !== html,
    ymd,
    dot,
  };
}

/**
 * Record a freshness addendum by moving dateModified forward.
 * Does not change datePublished or the article body.
 * @param {string} html
 * @param {string} ymd
 */
export function applyInsightFreshnessAddendum(html, ymd) {
  if (!YMD_RE.test(ymd || '')) {
    return { html, changed: false, reason: 'invalid_ymd' };
  }
  const published = html.match(/"datePublished"\s*:\s*"(\d{4}-\d{2}-\d{2})"/);
  if (!published) return { html, changed: false, reason: 'missing_datePublished' };
  if (ymd < published[1]) return { html, changed: false, reason: 'before_publish' };
  const modified = html.match(/"dateModified"\s*:\s*"(\d{4}-\d{2}-\d{2})"/);
  if (!modified) return { html, changed: false, reason: 'missing_dateModified' };
  if (modified[1] === ymd) return { html, changed: false, reason: 'unchanged', ymd };
  const next = html.replace(
    /("dateModified"\s*:\s*")\d{4}-\d{2}-\d{2}(")/,
    `$1${ymd}$2`
  );
  return { html: next, changed: next !== html, ymd };
}

export function syncInsightPublicationDate(html, publishAt) {
  const parts = toJstDateParts(publishAt);
  if (!parts) {
    return {
      html,
      changed: false,
      reason: 'missing_or_invalid_publishAt',
    };
  }

  return syncInsightPublicationDateToYmd(html, parts.ymd);
}

/**
 * @param {string} root
 * @param {{ dryRun?: boolean, slugs?: string[]|null }} [opts]
 */
export function syncPublishedInsightDatesFromListing(root, { dryRun = false, slugs = null } = {}) {
  const indexPath = path.join(root, 'insights/index.html');
  const indexHtml = fs.readFileSync(indexPath, 'utf8');
  const listingDates = parseListingInsightDates(indexHtml);

  const result = {
    synced: [],
    skipped: [],
    missing: [],
    mismatchesBefore: [],
  };

  for (const [slug, listingYmd] of listingDates.entries()) {
    if (slugs && !slugs.includes(slug)) continue;

    const articlePath = path.join(root, 'insights', slug, 'index.html');
    if (!fs.existsSync(articlePath)) {
      result.missing.push(slug);
      continue;
    }

    const before = fs.readFileSync(articlePath, 'utf8');
    const articleYmd = extractInsightPublicationDate(before);
    if (articleYmd !== listingYmd) {
      result.mismatchesBefore.push({ slug, listingYmd, articleYmd });
    }

    const synced = syncInsightPublicationDateToYmd(before, listingYmd);
    if (!synced.changed) {
      result.skipped.push(slug);
      continue;
    }

    if (!dryRun) {
      fs.writeFileSync(articlePath, synced.html, 'utf8');
    }

    result.synced.push({ slug, from: articleYmd, to: listingYmd });
  }

  return result;
}
