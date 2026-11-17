// Find meeting times when everyone's calendar is clear, inside office hours.
// busy: [{ start, end }] (ISO strings) merged from every attendee's Google free/busy.
// Times are in the browser's local time zone.

const toMin = (hhmm) => { const [h, m] = String(hhmm).split(':').map(Number); return h * 60 + (m || 0); };

export function findFreeSlots({
  busy, from = new Date(), days = 7, duration = 30, workStart = '10:00', workEnd = '19:30',
  workDays = [1, 2, 3, 4, 5, 6], step = 30, limit = 6, perDay = 2, minLeadMinutes = 15,
}) {
  const intervals = busy.map((b) => [new Date(b.start).getTime(), new Date(b.end).getTime()]);
  const earliest = from.getTime() + minLeadMinutes * 60000;
  const out = [];
  const day0 = new Date(from); day0.setHours(0, 0, 0, 0);
  for (let d = 0; d < days && out.length < limit; d++) {
    const day = new Date(day0); day.setDate(day0.getDate() + d);
    if (!workDays.includes(day.getDay())) continue;
    let taken = 0;
    for (let m = toMin(workStart); m + duration <= toMin(workEnd) && taken < perDay && out.length < limit; m += step) {
      const s = new Date(day); s.setHours(0, m, 0, 0);
      const e = new Date(s.getTime() + duration * 60000);
      if (s.getTime() < earliest) continue;
      if (intervals.some(([bs, be]) => bs < e.getTime() && be > s.getTime())) continue;
      out.push({ start: s, end: e });
      taken++;
    }
  }
  return out;
}

// True if [start, end) overlaps any busy interval
export const overlaps = (busy, start, end) =>
  busy.some((b) => new Date(b.start) < end && new Date(b.end) > start);
