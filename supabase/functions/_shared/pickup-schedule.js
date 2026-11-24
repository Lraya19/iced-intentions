// ═══════════════════════════════════════════════════════════════
// Iced Intentions — pickup schedule rules
// ───────────────────────────────────────────────────────────────
// ONE copy of "when can someone order, and for when", imported by both the
// browser (src/) and the process-payment Edge Function. The checkout uses it
// to decide what to offer; the Edge Function uses it to refuse anything the
// checkout shouldn't have offered. Keeping them in one file is what stops
// the two from drifting apart.
//
// Plain JS, no imports, no DOM, no Deno APIs — it has to run in both.
//
// The schedule itself lives in store_settings.pickup_schedule and is edited
// from the owner dashboard. Shape:
//
//   {
//     weekdays:    { "1": { start: "06:00", end: "09:00" }, ... }  // 0=Sun … 6=Sat
//     cutoff:      { daysBefore: 1, time: "17:00" }                // shop time
//     specialDays: [{ date: "2026-11-26", open: true,
//                     start: "06:00", end: "09:00", label: "Thanksgiving Day" },
//                   { date: "2026-12-25", open: false, label: "Christmas" }]
//   }
//
// A special day overrides its weekday entirely: it can open a day that's
// normally closed (a holiday sale) or close a day that's normally open.
//
// Every date and time here is the SHOP's wall clock (Pacific), never the
// customer's browser and never the Edge runtime's UTC.
// ═══════════════════════════════════════════════════════════════

export const SHOP_TZ = 'America/Los_Angeles';
export const SLOT_MINUTES = 15;
export const MAX_CUTOFF_DAYS = 7;
export const WEEKDAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export const DEFAULT_PICKUP_SCHEDULE = Object.freeze({
  weekdays: {
    1: { start: '06:00', end: '09:00' }, // Monday
    5: { start: '06:00', end: '09:00' }, // Friday
  },
  cutoff: { daysBefore: 1, time: '17:00' },
  specialDays: [],
});

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const pad = (n) => String(n).padStart(2, '0');

export const isTime = (s) => typeof s === 'string' && TIME_RE.test(s);
export const isIsoDate = (s) => typeof s === 'string' && DATE_RE.test(s)
  && !Number.isNaN(Date.parse(`${s}T00:00:00Z`));

export const toMinutes = (hhmm) => {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
};

// "06:15" → "6:15 AM"
export const displayTime = (hhmm) => {
  const [h, m] = hhmm.split(':').map(Number);
  return `${((h + 11) % 12) + 1}:${pad(m)} ${h >= 12 ? 'PM' : 'AM'}`;
};

export const hoursLabel = ({ start, end }) => `${displayTime(start)} – ${displayTime(end)}`;

// ── Calendar arithmetic ─────────────────────────────────────────
// Done on bare YYYY-MM-DD strings via UTC so daylight saving can never
// nudge a date across midnight.
const utc = (iso) => {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
};

export const addDays = (iso, n) => {
  const dt = utc(iso);
  dt.setUTCDate(dt.getUTCDate() + n);
  return dt.toISOString().slice(0, 10);
};

export const weekdayOf = (iso) => utc(iso).getUTCDay();

// "Thursday, Nov 26" style labels for a bare date, independent of the
// viewer's timezone.
export const formatDate = (iso, opts = { weekday: 'long', month: 'short', day: 'numeric' }) =>
  utc(iso).toLocaleDateString('en-US', { ...opts, timeZone: 'UTC' });

// The shop's current date and minute-of-day.
export function nowInShopTz(at = new Date()) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', {
      timeZone: SHOP_TZ,
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', hour12: false,
    }).formatToParts(at).map((p) => [p.type, p.value]),
  );
  // Some runtimes render midnight as "24" rather than "00".
  const hour = Number(parts.hour) % 24;
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    minutes: hour * 60 + Number(parts.minute),
  };
}

// ── Normalisation ───────────────────────────────────────────────
// Whatever is in the database, hand back a schedule every function below
// can trust. Bad entries are dropped rather than thrown on: a typo in one
// special day must not take the whole checkout down.

function cleanHours(h) {
  if (!h || !isTime(h.start) || !isTime(h.end)) return null;
  if (toMinutes(h.end) < toMinutes(h.start)) return null;
  return { start: h.start, end: h.end };
}

export function normalizeSchedule(raw) {
  const src = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};

  // A missing `weekdays` means "never configured" → defaults. A present but
  // empty one means the owner deliberately closed every standard day.
  const weekdays = {};
  const srcWeekdays = src.weekdays && typeof src.weekdays === 'object'
    ? src.weekdays
    : DEFAULT_PICKUP_SCHEDULE.weekdays;
  for (let d = 0; d < 7; d++) {
    const h = cleanHours(srcWeekdays[d] ?? srcWeekdays[String(d)]);
    if (h) weekdays[d] = h;
  }

  const c = src.cutoff && typeof src.cutoff === 'object' ? src.cutoff : {};
  const days = Number(c.daysBefore);
  // Never fewer than one day before: same-day ordering is not offered.
  const cutoff = {
    daysBefore: Number.isInteger(days) ? Math.min(MAX_CUTOFF_DAYS, Math.max(1, days)) : DEFAULT_PICKUP_SCHEDULE.cutoff.daysBefore,
    time: isTime(c.time) ? c.time : DEFAULT_PICKUP_SCHEDULE.cutoff.time,
  };

  const byDate = new Map();
  for (const s of Array.isArray(src.specialDays) ? src.specialDays : []) {
    if (!s || !isIsoDate(s.date)) continue;
    const label = typeof s.label === 'string' ? s.label.trim().slice(0, 60) : '';
    if (s.open) {
      const h = cleanHours(s);
      if (!h) continue;
      byDate.set(s.date, { date: s.date, open: true, ...h, label });
    } else {
      byDate.set(s.date, { date: s.date, open: false, label });
    }
  }
  const specialDays = [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));

  return { weekdays, cutoff, specialDays };
}

// ── Queries ─────────────────────────────────────────────────────

export const specialDayFor = (schedule, iso) =>
  schedule.specialDays.find((d) => d.date === iso) || null;

// Pickup hours for a date, or null if there's no pickup that day.
export function hoursFor(schedule, iso) {
  if (!isIsoDate(iso)) return null;
  const sp = specialDayFor(schedule, iso);
  if (sp) return sp.open ? { start: sp.start, end: sp.end, label: sp.label, special: true } : null;
  const wk = schedule.weekdays[weekdayOf(iso)];
  return wk ? { ...wk, label: '', special: false } : null;
}

// The moment ordering closes for a pickup date, in shop time.
export function cutoffFor(schedule, iso) {
  return { date: addDays(iso, -schedule.cutoff.daysBefore), time: schedule.cutoff.time };
}

// "Wednesday, Nov 25 at 5:00 PM"
export function cutoffLabel(schedule, iso) {
  const c = cutoffFor(schedule, iso);
  return `${formatDate(c.date)} at ${displayTime(c.time)}`;
}

// Is `iso` a pickup day whose cutoff hasn't passed yet?
export function isOrderable(schedule, iso, at = new Date()) {
  if (!hoursFor(schedule, iso)) return false;
  const c = cutoffFor(schedule, iso);
  const now = nowInShopTz(at);
  if (now.date !== c.date) return now.date < c.date;
  return now.minutes < toMinutes(c.time);
}

// 15-minute pickup windows for a date, start and end inclusive.
export function slotsFor(schedule, iso) {
  const h = hoursFor(schedule, iso);
  if (!h) return [];
  const out = [];
  for (let t = toMinutes(h.start); t <= toMinutes(h.end); t += SLOT_MINUTES) {
    const time = `${pad(Math.floor(t / 60))}:${pad(t % 60)}`;
    out.push({ time, display: displayTime(time) });
  }
  return out;
}

// The server's question: may this exact date + time be booked right now?
export function isValidPickup(schedule, iso, time, at = new Date()) {
  return isOrderable(schedule, iso, at) && slotsFor(schedule, iso).some((s) => s.time === time);
}

// Bookable pickup dates, soonest first.
export function upcomingPickupDays(schedule, at = new Date(), { limit = 8, horizonDays = 28 } = {}) {
  const today = nowInShopTz(at).date;
  const out = [];
  for (let i = 0; i < horizonDays && out.length < limit; i++) {
    const iso = addDays(today, i);
    if (!isOrderable(schedule, iso, at)) continue;
    out.push({ iso, ...hoursFor(schedule, iso) });
  }
  return out;
}

// Today's date in shop time — handy for "is this in the past?" checks.
export const shopToday = (at = new Date()) => nowInShopTz(at).date;
