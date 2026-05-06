/**
 * Returns the ISO 8601 week of `d` in `YYYY-Www` format.
 * Weeks start Monday; week 1 contains the year's first Thursday.
 * The returned year may differ from `d.getUTCFullYear()` near year boundaries.
 */
export function isoWeek(d: Date): string {
  // Move to Thursday of the same ISO week, which determines the ISO week year.
  const target = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const dayNum = (target.getUTCDay() + 6) % 7; // Mon=0..Sun=6
  target.setUTCDate(target.getUTCDate() - dayNum + 3);

  const isoYear = target.getUTCFullYear();
  // First Thursday of ISO year: Jan 4 + offset to Thursday.
  const firstThursday = new Date(Date.UTC(isoYear, 0, 4));
  const firstThursdayDayNum = (firstThursday.getUTCDay() + 6) % 7;
  firstThursday.setUTCDate(firstThursday.getUTCDate() - firstThursdayDayNum + 3);

  const weekNum = 1 + Math.round((target.getTime() - firstThursday.getTime()) / (7 * 86400 * 1000));
  return `${isoYear}-W${weekNum.toString().padStart(2, '0')}`;
}
