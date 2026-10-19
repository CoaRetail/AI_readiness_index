const TZ = 'Asia/Tokyo';

export function toJstDateString(date) {
  return date.toLocaleDateString('en-CA', { timeZone: TZ });
}

export function isWeekday(date) {
  const wd = new Date(
    date.toLocaleString('en-US', { timeZone: TZ })
  ).getDay();
  return wd >= 1 && wd <= 5;
}

/**
 * Extra closures on top of weekends and Japanese public holidays.
 * 2026-10-12 is also Sports Day in the holiday calendar; it stays here so a
 * pulled-forward slot cannot land on it if the calendar is bypassed.
 */
export const CLOSED_PUBLISH_DATES = Object.freeze([
  '2026-10-12',
]);

function shiftYmd(ymd, days) {
  const [y, m, d] = String(ymd).split('-').map(Number);
  const cur = new Date(Date.UTC(y, m - 1, d));
  cur.setUTCDate(cur.getUTCDate() + days);
  const month = String(cur.getUTCMonth() + 1).padStart(2, '0');
  const day = String(cur.getUTCDate()).padStart(2, '0');
  return `${cur.getUTCFullYear()}-${month}-${day}`;
}

function weekdayIndex(ymd) {
  const [y, m, d] = String(ymd).split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

function nthMonday(year, monthIndex, n) {
  const firstWd = new Date(Date.UTC(year, monthIndex, 1)).getUTCDay();
  return 1 + ((8 - firstWd) % 7) + (n - 1) * 7;
}

/** Equinox day-of-month for 1980–2099. vernal → March, autumnal → September. */
function equinoxDay(year, kind) {
  const diff = year - 1980;
  const base = kind === 'vernal' ? 20.8431 : 23.2488;
  return Math.floor(base + 0.242194 * diff) - Math.floor(diff / 4);
}

const holidayCache = new Map();

/**
 * Japanese public holidays for one year (国民の祝日), including 振替休日 and 国民の休日.
 * Covers the statutory rules used from 2000 through 2099. One-off transfer holidays
 * outside that statute are not included.
 */
export function japanesePublicHolidays(year) {
  const y = Number(year);
  if (!Number.isInteger(y) || y < 1980 || y > 2099) return Object.freeze([]);
  if (holidayCache.has(y)) return holidayCache.get(y);

  const set = new Set();
  const add = (month, day) => {
    set.add(`${y}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`);
  };
  add(1, 1);
  add(1, nthMonday(y, 0, 2));
  add(2, 11);
  add(2, 23);
  add(3, equinoxDay(y, 'vernal'));
  add(4, 29);
  add(5, 3);
  add(5, 4);
  add(5, 5);
  add(7, nthMonday(y, 6, 3));
  add(8, 11);
  add(9, nthMonday(y, 8, 3));
  add(9, equinoxDay(y, 'autumnal'));
  add(10, nthMonday(y, 9, 2));
  add(11, 3);
  add(11, 23);

  for (const date of [...set]) {
    if (weekdayIndex(date) !== 0) continue;
    let cursor = shiftYmd(date, 1);
    while (set.has(cursor)) cursor = shiftYmd(cursor, 1);
    set.add(cursor);
  }

  let changed = true;
  while (changed) {
    changed = false;
    for (const date of [...set]) {
      const mid = shiftYmd(date, 1);
      if (!set.has(mid) && set.has(shiftYmd(mid, 1))) {
        set.add(mid);
        changed = true;
      }
    }
  }

  const frozen = Object.freeze([...set].sort());
  holidayCache.set(y, frozen);
  return frozen;
}

export function isJapanesePublicHoliday(ymd) {
  const date = String(ymd || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
  return japanesePublicHolidays(Number(date.slice(0, 4))).includes(date);
}

export function isClosedPublishDate(ymd) {
  const date = String(ymd || '').slice(0, 10);
  return CLOSED_PUBLISH_DATES.includes(date) || isJapanesePublicHoliday(date);
}

/** Monday–Friday that is not a Japanese public holiday or an extra closure. */
export function isOpenPublishDay(ymd) {
  const date = String(ymd || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
  const [y, m, d] = date.split('-').map(Number);
  const instant = new Date(Date.UTC(y, m - 1, d, 3, 0, 0));
  return isWeekday(instant) && !isClosedPublishDate(date);
}

/** @param {string} startYmd YYYY-MM-DD */
export function businessDaysFrom(startYmd, count) {
  const [y, m, d] = startYmd.split('-').map(Number);
  const cur = new Date(Date.UTC(y, m - 1, d, 1, 0, 0));
  const out = [];
  while (out.length < count) {
    const ymd = toJstDateString(cur);
    if (isOpenPublishDay(ymd)) out.push(ymd);
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
  return out;
}

export function isoAtJst(ymd, hm = '10:00') {
  return `${ymd}T${hm}:00+09:00`;
}

/** Next open publish day after `ymd` (skips weekends and Japanese public holidays). */
export function nextPublishDayAfterUnlock(unlockYmd) {
  const [y, m, d] = unlockYmd.split('-').map(Number);
  const cur = new Date(Date.UTC(y, m - 1, d, 1, 0, 0));
  cur.setUTCDate(cur.getUTCDate() + 1);
  while (!isOpenPublishDay(toJstDateString(cur))) {
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
  return toJstDateString(cur);
}

/** Previous open publish day before startYmd. */
export function previousBusinessDay(startYmd) {
  const [y, m, d] = startYmd.split('-').map(Number);
  const cur = new Date(Date.UTC(y, m - 1, d, 1, 0, 0));
  cur.setUTCDate(cur.getUTCDate() - 1);
  while (!isOpenPublishDay(toJstDateString(cur))) {
    cur.setUTCDate(cur.getUTCDate() - 1);
  }
  return toJstDateString(cur);
}

export function articleTimesForPublishDay(publishYmd) {
  return {
    web: isoAtJst(publishYmd, '10:00'),
    bufferTransfer: isoAtJst(publishYmd, '10:30'),
    linkedin: isoAtJst(publishYmd, '11:30'),
    facebook: isoAtJst(publishYmd, '11:45'),
    x: isoAtJst(publishYmd, '12:00'),
  };
}

export function charCountNoSpace(text) {
  return String(text || '').replace(/\s/g, '').length;
}
