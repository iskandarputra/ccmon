/**
 * @file daykey.ts
 * @brief The single timestamp → calendar conversion point, zone-aware.
 * @author Iskandar Putra <www.iskandarputra.com>
 *
 * ccmon buckets usage by calendar day, and which day a timestamp falls in
 * depends on a timezone. Every such conversion goes through here so the parser,
 * the aggregator, the range resolver and the renderer can never disagree.
 *
 * `zone` is an IANA name (`'UTC'`, `'Asia/Tokyo'`) or null/'' meaning "the
 * system zone" — the default, and ccmon's behaviour before this existed.
 *
 * NOT for calendar arithmetic on day keys. Adding days to a 'YYYY-MM-DD',
 * finding its weekday, or walking back a week is zone-independent when anchored
 * at noon (no real offset shifts a noon across a date boundary), so that math
 * stays in plain `Date` at the call sites.
 */

/** IANA zone name, or null/'' for the system zone. */
export type Zone = string | null | undefined;

const pad2 = (n: number): string => String(n).padStart(2, '0');

/**
 * Offsets are cached per zone per 15-minute bucket. Every modern IANA offset is
 * a whole multiple of 15 minutes, so within one bucket the offset is constant —
 * which makes the cached value exact rather than an approximation, including
 * across a DST transition (the transition lands on a bucket edge).
 *
 * Bounded so a long-running app indexing years of transcripts can't grow it
 * without limit; a clear costs only re-derivation.
 */
const MAX_CACHE = 200_000;
const BUCKET_MS = 900_000; // 15 minutes
const offsetCache = new Map<string, number>();
const formatters = new Map<string, Intl.DateTimeFormat>();

function formatterFor(zone: string): Intl.DateTimeFormat {
  let f = formatters.get(zone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: zone,
      hour12: false,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    formatters.set(zone, f);
  }
  return f;
}

/**
 * Milliseconds to add to a UTC timestamp so the UTC getters read as `zone`
 * wall-clock. Derived from Intl once per zone per 15-minute bucket, then reused.
 *
 * An unknown or malformed zone makes `Intl` throw; that resolves to offset 0
 * rather than crashing, because a bad setting must not take the app down. The
 * setting layer validates and reports before it ever gets here.
 */
function zoneOffsetMs(ts: number, zone: string): number {
  const bucket = Math.floor(ts / BUCKET_MS);
  const key = `${zone}@${bucket}`;
  const hit = offsetCache.get(key);
  if (hit !== undefined) return hit;

  let offset: number;
  try {
    const parts = formatterFor(zone).formatToParts(new Date(ts));
    const get = (type: string): number => Number(parts.find((p) => p.type === type)?.value ?? '0');
    // Intl renders hour 24 for midnight in some locales/zones; normalize.
    const hour = get('hour') % 24;
    const asUtc = Date.UTC(
      get('year'),
      get('month') - 1,
      get('day'),
      hour,
      get('minute'),
      get('second'),
    );
    // second-granularity round-trip; snap to the second to kill float dust
    offset = asUtc - Math.floor(ts / 1000) * 1000;
  } catch {
    offset = 0;
  }

  if (offsetCache.size >= MAX_CACHE) offsetCache.clear();
  offsetCache.set(key, offset);
  return offset;
}

/** True when the zone should be treated as "the system zone". */
const isSystem = (zone: Zone): boolean => !zone;

/**
 * A `Date` whose UTC getters read as the zone's wall clock. For the system zone
 * the original Date already does, via its local getters — so callers must use
 * {@link zonedParts} rather than reaching for getters themselves.
 */
function shifted(ts: number, zone: string): Date {
  return new Date(ts + zoneOffsetMs(ts, zone));
}

export interface ZonedParts {
  year: number;
  /** 1-12 */
  month: number;
  /** 1-31 */
  day: number;
  /** 0-23 */
  hour: number;
  /** 0 = Monday … 6 = Sunday, matching the hourly heatmap's orientation */
  weekday: number;
}

/** Calendar fields of `ts` as seen in `zone`. */
export function zonedParts(ts: number, zone: Zone = null): ZonedParts {
  if (isSystem(zone)) {
    const d = new Date(ts);
    return {
      year: d.getFullYear(),
      month: d.getMonth() + 1,
      day: d.getDate(),
      hour: d.getHours(),
      weekday: (d.getDay() + 6) % 7,
    };
  }
  const d = shifted(ts, zone as string);
  return {
    year: d.getUTCFullYear(),
    month: d.getUTCMonth() + 1,
    day: d.getUTCDate(),
    hour: d.getUTCHours(),
    weekday: (d.getUTCDay() + 6) % 7,
  };
}

/**
 * The 'YYYY-MM-DD' bucket `ts` belongs to in `zone`. This is THE function that
 * decides which day a message counts against.
 */
export function dayKeyFor(ts: number, zone: Zone = null): string {
  if (isSystem(zone)) {
    const d = new Date(ts);
    return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
  }
  const d = shifted(ts, zone as string);
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
}

/**
 * Is `zone` a name this runtime can actually resolve? Used by the settings
 * layer to reject a typo loudly instead of silently bucketing into UTC.
 */
export function isValidZone(zone: string): boolean {
  if (!zone) return true; // '' means system, always valid
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}

/** The runtime's own zone name, for labelling the "system" choice in the UI. */
export function systemZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

/** Test seam: drop the memo tables. */
export function resetZoneCaches(): void {
  offsetCache.clear();
  formatters.clear();
}
