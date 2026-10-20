/**
 * Pure helpers for the meetings calendar: date math (local, Sunday-first weeks)
 * and side-by-side layout of overlapping meetings in a time grid.
 */

export type CalendarView = 'day' | 'week' | 'month';

/** Meeting times arrive as "HH:MM[:SS]" or as a 1970 ISO timestamp (UTC). */
export function timeToMinutes(time: string | null | undefined): number {
  if (!time) return 0;
  if (time.includes('T')) {
    const d = new Date(time);
    return d.getUTCHours() * 60 + d.getUTCMinutes();
  }
  const [h, m] = time.split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
}

export function formatMinutes(total: number): string {
  const h = Math.floor(total / 60).toString().padStart(2, '0');
  const m = (total % 60).toString().padStart(2, '0');
  return `${h}:${m}`;
}

/** "YYYY-MM-DD" in local time — never via toISOString (timezone shifts the day). */
export function toDateKey(d: Date): string {
  const y = d.getFullYear();
  const m = (d.getMonth() + 1).toString().padStart(2, '0');
  const day = d.getDate().toString().padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function fromDateKey(key: string): Date {
  const [y, m, d] = key.slice(0, 10).split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function addDays(d: Date, days: number): Date {
  const r = new Date(d);
  r.setDate(r.getDate() + days);
  return r;
}

export function startOfWeek(d: Date): Date {
  return addDays(new Date(d.getFullYear(), d.getMonth(), d.getDate()), -d.getDay());
}

/** Visible date range for a view. Month view covers whole Sunday-first weeks. */
export function getRange(view: CalendarView, anchor: Date): { start: Date; end: Date } {
  if (view === 'day') {
    const day = new Date(anchor.getFullYear(), anchor.getMonth(), anchor.getDate());
    return { start: day, end: day };
  }
  if (view === 'week') {
    const start = startOfWeek(anchor);
    return { start, end: addDays(start, 6) };
  }
  const first = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
  const last = new Date(anchor.getFullYear(), anchor.getMonth() + 1, 0);
  return { start: startOfWeek(first), end: addDays(startOfWeek(last), 6) };
}

export function shiftAnchor(view: CalendarView, anchor: Date, dir: 1 | -1): Date {
  if (view === 'day') return addDays(anchor, dir);
  if (view === 'week') return addDays(anchor, 7 * dir);
  return new Date(anchor.getFullYear(), anchor.getMonth() + dir, 1);
}

export interface TimedItem {
  id: string;
  start: number; // minutes from midnight
  end: number;
}

export interface PlacedItem<T extends TimedItem> {
  item: T;
  column: number;
  columns: number;
  cluster: number; // index of the overlap group the item belongs to
}

/**
 * Assign overlapping items to side-by-side columns. Items that overlap
 * (directly or through a chain) form a cluster that shares one column count,
 * so cards inside a cluster all have the same width.
 */
export function layoutOverlaps<T extends TimedItem>(items: T[]): PlacedItem<T>[] {
  const sorted = [...items].sort((a, b) => a.start - b.start || b.end - a.end);
  const placed: PlacedItem<T>[] = [];
  let cluster: PlacedItem<T>[] = [];
  let columnEnds: number[] = [];
  let clusterEnd = -1;
  let clusterIndex = 0;

  const flush = () => {
    const n = columnEnds.length || 1;
    for (const p of cluster) {
      p.columns = n;
      p.cluster = clusterIndex;
    }
    clusterIndex++;
    placed.push(...cluster);
    cluster = [];
    columnEnds = [];
  };

  for (const item of sorted) {
    const end = Math.max(item.end, item.start + 1);
    if (cluster.length && item.start >= clusterEnd) flush();
    let column = columnEnds.findIndex((e) => e <= item.start);
    if (column === -1) {
      column = columnEnds.length;
      columnEnds.push(end);
    } else {
      columnEnds[column] = end;
    }
    cluster.push({ item, column, columns: 1, cluster: 0 });
    clusterEnd = cluster.length === 1 ? end : Math.max(clusterEnd, end);
  }
  if (cluster.length) flush();
  return placed;
}

/** Stable colour per key (instructor / branch) from a readable palette. */
const PALETTE = [
  { bg: '#dbeafe', border: '#2563eb', text: '#1e3a8a' },
  { bg: '#dcfce7', border: '#16a34a', text: '#14532d' },
  { bg: '#fef3c7', border: '#d97706', text: '#78350f' },
  { bg: '#fce7f3', border: '#db2777', text: '#831843' },
  { bg: '#ede9fe', border: '#7c3aed', text: '#4c1d95' },
  { bg: '#cffafe', border: '#0891b2', text: '#164e63' },
  { bg: '#ffedd5', border: '#ea580c', text: '#7c2d12' },
  { bg: '#e0e7ff', border: '#4f46e5', text: '#312e81' },
  { bg: '#ecfccb', border: '#65a30d', text: '#365314' },
  { bg: '#fee2e2', border: '#dc2626', text: '#7f1d1d' },
  { bg: '#f3e8ff', border: '#9333ea', text: '#581c87' },
  { bg: '#ccfbf1', border: '#0d9488', text: '#134e4a' },
];

export function colorFor(key: string | null | undefined) {
  const s = key || '';
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return PALETTE[h % PALETTE.length];
}
