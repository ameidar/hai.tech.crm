import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ChevronRight, ChevronLeft, CalendarDays, CheckCircle2, Clock, MapPin, User, Video, ExternalLink } from 'lucide-react';
import PageHeader from '../components/ui/PageHeader';
import Modal from '../components/ui/Modal';
import SearchableSelect from '../components/ui/SearchableSelect';
import Loading from '../components/ui/Loading';
import { useMeetings, useBranches, useInstructors } from '../hooks/useApi';
import { meetingStatusHebrew } from '../types';
import type { Meeting } from '../types';
import {
  type CalendarView,
  type PlacedItem,
  addDays,
  colorFor,
  formatMinutes,
  fromDateKey,
  getRange,
  layoutOverlaps,
  shiftAnchor,
  timeToMinutes,
  toDateKey,
} from '../utils/calendarLayout';

const HOUR_HEIGHT = 64; // px per hour in day/week grids
const DAY_NAMES = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];
const MONTH_NAMES = ['ינואר', 'פברואר', 'מרץ', 'אפריל', 'מאי', 'יוני', 'יולי', 'אוגוסט', 'ספטמבר', 'אוקטובר', 'נובמבר', 'דצמבר'];
const VIEW_LABELS: Record<CalendarView, string> = { day: 'יום', week: 'שבוע', month: 'חודש' };
const INACTIVE = new Set(['cancelled', 'postponed']);
const PENDING = new Set(['pending_cancellation', 'pending_postponement']);

type ColorBy = 'instructor' | 'branch';

interface CalItem {
  id: string;
  start: number;
  end: number;
  dateKey: string;
  meeting: Meeting;
}

function rangeTitle(view: CalendarView, anchor: Date): string {
  if (view === 'day') {
    return `יום ${DAY_NAMES[anchor.getDay()]}, ${anchor.getDate()} ב${MONTH_NAMES[anchor.getMonth()]} ${anchor.getFullYear()}`;
  }
  if (view === 'month') return `${MONTH_NAMES[anchor.getMonth()]} ${anchor.getFullYear()}`;
  const { start, end } = getRange('week', anchor);
  const sameMonth = start.getMonth() === end.getMonth();
  return sameMonth
    ? `${start.getDate()}–${end.getDate()} ב${MONTH_NAMES[end.getMonth()]} ${end.getFullYear()}`
    : `${start.getDate()} ב${MONTH_NAMES[start.getMonth()]} – ${end.getDate()} ב${MONTH_NAMES[end.getMonth()]} ${end.getFullYear()}`;
}

function colorKey(m: Meeting, by: ColorBy) {
  return by === 'branch' ? m.cycle?.branch?.name || '' : m.instructor?.name || m.instructorId;
}

export default function MeetingsCalendar() {
  const [searchParams, setSearchParams] = useSearchParams();
  const view = (['day', 'week', 'month'].includes(searchParams.get('view') || '') ? searchParams.get('view') : 'week') as CalendarView;
  const anchor = searchParams.get('date') ? fromDateKey(searchParams.get('date')!) : new Date();
  const instructorId = searchParams.get('instructorId') || '';
  const branchId = searchParams.get('branchId') || '';
  const colorBy = (searchParams.get('colorBy') === 'branch' ? 'branch' : 'instructor') as ColorBy;
  const showCancelled = searchParams.get('cancelled') === '1';
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<Meeting | null>(null);

  const update = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(searchParams);
    for (const [k, v] of Object.entries(patch)) {
      if (v) next.set(k, v);
      else next.delete(k);
    }
    setSearchParams(next, { replace: true });
  };
  const goTo = (v: CalendarView, d: Date) => update({ view: v, date: toDateKey(d) });

  const { start, end } = getRange(view, anchor);
  const { data: meetings, isLoading } = useMeetings({
    from: toDateKey(start),
    to: toDateKey(end),
    instructorId: instructorId || undefined,
    branchId: branchId || undefined,
    limit: 3000,
  });
  const { data: branches } = useBranches();
  const { data: instructors } = useInstructors({ isActive: true, workingWithinDays: 45 });

  const items = useMemo<CalItem[]>(() => {
    const q = search.trim();
    return (meetings || [])
      .filter((m) => showCancelled || !INACTIVE.has(m.status))
      .filter((m) => {
        if (!q) return true;
        const hay = `${m.cycle?.name || ''} ${m.instructor?.name || ''} ${m.cycle?.branch?.name || ''} ${m.cycle?.course?.name || ''} ${m.topic || ''}`;
        return hay.includes(q);
      })
      .map((m) => ({
        id: m.id,
        start: timeToMinutes(m.startTime),
        end: timeToMinutes(m.endTime),
        dateKey: m.scheduledDate.slice(0, 10),
        meeting: m,
      }));
  }, [meetings, search, showCancelled]);

  const byDay = useMemo(() => {
    const map = new Map<string, CalItem[]>();
    for (const it of items) {
      const list = map.get(it.dateKey) || [];
      list.push(it);
      map.set(it.dateKey, list);
    }
    for (const list of map.values()) list.sort((a, b) => a.start - b.start);
    return map;
  }, [items]);

  const legend = useMemo(() => {
    const counts = new Map<string, number>();
    for (const it of items) {
      const k = colorKey(it.meeting, colorBy);
      if (k) counts.set(k, (counts.get(k) || 0) + 1);
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1]);
  }, [items, colorBy]);

  const stats = useMemo(() => {
    const total = items.length;
    const completed = items.filter((i) => i.meeting.status === 'completed').length;
    const instructorsCount = new Set(items.map((i) => i.meeting.instructorId)).size;
    return { total, completed, instructorsCount };
  }, [items]);

  return (
    <div className="flex flex-col h-full min-w-0">
      <PageHeader
        title="לוח שנה"
        subtitle="כל הפגישות בתצוגה חודשית, שבועית ויומית"
        actions={
          <div className="flex rounded-lg border bg-white overflow-hidden">
            {(['day', 'week', 'month'] as CalendarView[]).map((v) => (
              <button
                key={v}
                onClick={() => update({ view: v })}
                className={`px-4 py-2 text-sm font-medium ${view === v ? 'bg-blue-600 text-white' : 'text-gray-700 hover:bg-gray-50'}`}
              >
                {VIEW_LABELS[v]}
              </button>
            ))}
          </div>
        }
      />

      <div className="px-6 py-3 bg-white border-b flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-1">
          <button onClick={() => goTo(view, shiftAnchor(view, anchor, -1))} className="p-2 rounded-lg hover:bg-gray-100" title="הקודם">
            <ChevronRight size={20} />
          </button>
          <button onClick={() => goTo(view, new Date())} className="px-3 py-1.5 text-sm border rounded-lg hover:bg-gray-50">
            היום
          </button>
          <button onClick={() => goTo(view, shiftAnchor(view, anchor, 1))} className="p-2 rounded-lg hover:bg-gray-100" title="הבא">
            <ChevronLeft size={20} />
          </button>
        </div>
        <h2 className="text-lg font-semibold text-gray-900 min-w-[220px]">{rangeTitle(view, anchor)}</h2>

        <div className="flex flex-wrap items-center gap-2 mr-auto">
          <SearchableSelect
            className="w-48"
            placeholder="כל המדריכים"
            value={instructorId}
            onChange={(v) => update({ instructorId: v || null })}
            options={(instructors || []).map((i) => ({ value: i.id, label: i.name }))}
          />
          <SearchableSelect
            className="w-48"
            placeholder="כל הסניפים"
            value={branchId}
            onChange={(v) => update({ branchId: v || null })}
            options={(branches || []).map((b) => ({ value: b.id, label: b.name }))}
          />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="חיפוש מחזור / קורס..."
            className="border rounded-lg px-3 py-2 text-sm w-48"
          />
          <select
            value={colorBy}
            onChange={(e) => update({ colorBy: e.target.value === 'branch' ? 'branch' : null })}
            className="border rounded-lg px-3 py-2 text-sm"
          >
            <option value="instructor">צבע לפי מדריך</option>
            <option value="branch">צבע לפי סניף</option>
          </select>
          <label className="flex items-center gap-2 text-sm text-gray-700">
            <input type="checkbox" checked={showCancelled} onChange={(e) => update({ cancelled: e.target.checked ? '1' : null })} />
            הצג מבוטלות/נדחות
          </label>
        </div>
      </div>

      <div className="px-6 py-2 bg-gray-50 border-b flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-gray-600">
        <span className="font-medium text-gray-800">
          {stats.total} פגישות · {stats.instructorsCount} מדריכים · {stats.completed} התקיימו
        </span>
        {legend.slice(0, 14).map(([k, n]) => {
          const c = colorFor(k);
          return (
            <span key={k} className="flex items-center gap-1">
              <span className="inline-block w-3 h-3 rounded-sm" style={{ background: c.bg, border: `2px solid ${c.border}` }} />
              {k} ({n})
            </span>
          );
        })}
        {legend.length > 14 && <span>+{legend.length - 14} נוספים</span>}
      </div>

      <div className="flex-1 min-w-0 overflow-auto p-4" style={{ contain: 'inline-size' }}>
        {isLoading ? (
          <Loading />
        ) : view === 'month' ? (
          <MonthView anchor={anchor} start={start} end={end} byDay={byDay} colorBy={colorBy} onOpen={setSelected} onDay={(d) => goTo('day', d)} />
        ) : view === 'week' ? (
          <TimeGrid
            columns={weekColumns(start, byDay)}
            colorBy={colorBy}
            onOpen={setSelected}
            onHeader={(key) => goTo('day', fromDateKey(key))}
            showInstructor
            maxColumns={3}
          />
        ) : (
          <TimeGrid
            columns={instructorColumns(toDateKey(start), byDay)}
            colorBy={colorBy}
            onOpen={setSelected}
            emptyText="אין פגישות ביום הזה"
          />
        )}
      </div>

      <MeetingDetails meeting={selected} onClose={() => setSelected(null)} />
    </div>
  );
}

interface Column {
  key: string;
  title: string;
  subtitle?: string;
  isToday?: boolean;
  dateKey: string;
  items: CalItem[];
}

function weekColumns(start: Date, byDay: Map<string, CalItem[]>): Column[] {
  const todayKey = toDateKey(new Date());
  const cols: Column[] = [];
  for (let i = 0; i < 7; i++) {
    const d = addDays(start, i);
    const key = toDateKey(d);
    const items = byDay.get(key) || [];
    if (i === 6 && items.length === 0) continue; // hide an empty Saturday
    cols.push({ key, dateKey: key, title: DAY_NAMES[d.getDay()], subtitle: `${d.getDate()}/${d.getMonth() + 1} · ${items.length} פגישות`, isToday: key === todayKey, items });
  }
  return cols;
}

function instructorColumns(dateKey: string, byDay: Map<string, CalItem[]>): Column[] {
  const groups = new Map<string, CalItem[]>();
  for (const it of byDay.get(dateKey) || []) {
    const k = it.meeting.instructor?.name || 'ללא מדריך';
    groups.set(k, [...(groups.get(k) || []), it]);
  }
  return [...groups.entries()]
    .sort((a, b) => a[1][0].start - b[1][0].start)
    .map(([name, items]) => ({ key: name, dateKey, title: name, subtitle: `${items.length} פגישות`, items }));
}

type Placed = PlacedItem<CalItem>;
type MoreChip = { key: string; more: number; start: number; end: number };

/** In crowded overlap groups keep the first (max-1) columns and fold the rest into a "+N" chip. */
function capClusters(placed: Placed[], max: number): (Placed | MoreChip)[] {
  const out: (Placed | MoreChip)[] = [];
  const overflow = new Map<number, Placed[]>();
  for (const p of placed) {
    if (p.columns <= max) out.push(p);
    else if (p.column < max - 1) out.push({ ...p, columns: max });
    else overflow.set(p.cluster, [...(overflow.get(p.cluster) || []), p]);
  }
  for (const [cluster, list] of overflow) {
    out.push({
      key: `more-${cluster}`,
      more: list.length,
      start: Math.min(...list.map((p) => p.item.start)),
      end: Math.max(...list.map((p) => Math.max(p.item.end, p.item.start + 20))),
    });
  }
  return out;
}

function TimeGrid({
  columns,
  colorBy,
  onOpen,
  onHeader,
  showInstructor = false,
  emptyText,
  maxColumns = 99,
}: {
  columns: Column[];
  colorBy: ColorBy;
  onOpen: (m: Meeting) => void;
  onHeader?: (dateKey: string) => void;
  showInstructor?: boolean;
  emptyText?: string;
  maxColumns?: number;
}) {
  const [now, setNow] = useState(new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(t);
  }, []);

  if (columns.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-24 text-gray-500">
        <CalendarDays size={48} className="mb-3 text-gray-300" />
        {emptyText || 'אין פגישות בטווח הזה'}
      </div>
    );
  }

  const all = columns.flatMap((c) => c.items);
  const startHour = Math.min(8, ...all.map((i) => Math.floor(i.start / 60)));
  const endHour = Math.max(20, ...all.map((i) => Math.ceil(i.end / 60)));
  const hours = Array.from({ length: endHour - startHour }, (_, i) => startHour + i);
  const height = hours.length * HOUR_HEIGHT;
  const nowMinutes = now.getHours() * 60 + now.getMinutes();
  const todayKey = toDateKey(now);
  const minColWidth = showInstructor ? 150 : 150;

  return (
    <div className="bg-white rounded-xl border shadow-sm overflow-x-auto max-w-full">
      <div style={{ minWidth: 60 + columns.length * minColWidth }}>
        <div className="flex border-b sticky top-0 bg-white z-20">
          <div className="w-[60px] shrink-0" />
          {columns.map((c) => (
            <button
              key={c.key}
              disabled={!onHeader}
              onClick={() => onHeader?.(c.dateKey)}
              className={`flex-1 px-2 py-2 text-center border-r ${c.isToday ? 'bg-blue-50' : ''} ${onHeader ? 'hover:bg-gray-50' : 'cursor-default'}`}
            >
              <div className={`font-semibold text-sm ${c.isToday ? 'text-blue-700' : 'text-gray-900'}`}>{c.title}</div>
              {c.subtitle && <div className="text-xs text-gray-500">{c.subtitle}</div>}
            </button>
          ))}
        </div>

        <div className="flex relative" style={{ height }}>
          <div className="w-[60px] shrink-0 relative">
            {hours.map((h, i) => (
              <div key={h} className="absolute left-0 right-0 text-xs text-gray-400 text-center -translate-y-2" style={{ top: i * HOUR_HEIGHT }}>
                {i === 0 ? '' : `${h.toString().padStart(2, '0')}:00`}
              </div>
            ))}
          </div>
          {columns.map((c) => (
            <div key={c.key} className={`flex-1 relative border-r ${c.isToday ? 'bg-blue-50/40' : ''}`}>
              {hours.map((h, i) => (
                <div key={h} className="absolute left-0 right-0 border-t border-gray-100" style={{ top: i * HOUR_HEIGHT }} />
              ))}
              {c.dateKey === todayKey && nowMinutes >= startHour * 60 && nowMinutes <= endHour * 60 && (
                <div className="absolute left-0 right-0 z-10 border-t-2 border-red-500" style={{ top: ((nowMinutes - startHour * 60) / 60) * HOUR_HEIGHT }}>
                  <span className="absolute -top-1.5 -right-1 w-3 h-3 rounded-full bg-red-500" />
                </div>
              )}
              {capClusters(layoutOverlaps(c.items), maxColumns).map((p) => {
                if ('more' in p) {
                  const top = ((p.start - startHour * 60) / 60) * HOUR_HEIGHT;
                  const h = Math.max(((p.end - p.start) / 60) * HOUR_HEIGHT - 2, 22);
                  const w = 100 / maxColumns;
                  return (
                    <button
                      key={p.key}
                      onClick={() => onHeader?.(c.dateKey)}
                      title="פתח תצוגת יום"
                      className="absolute z-[5] rounded-md border border-dashed border-gray-400 bg-gray-50 text-gray-700 text-xs font-semibold hover:bg-gray-100"
                      style={{ top, height: h, left: 2, width: `calc(${w}% - 4px)` }}
                    >
                      +{p.more}
                    </button>
                  );
                }
                const { item, column, columns: n } = p;
                const top = ((item.start - startHour * 60) / 60) * HOUR_HEIGHT;
                const h = Math.max(((Math.max(item.end, item.start + 20) - item.start) / 60) * HOUR_HEIGHT - 2, 22);
                const widthPct = 100 / n;
                return (
                  <EventCard
                    key={item.id}
                    item={item}
                    colorBy={colorBy}
                    compact={n >= 3 || h < 40}
                    showInstructor={showInstructor}
                    style={{ top, height: h, right: `calc(${column * widthPct}% + 2px)`, width: `calc(${widthPct}% - 4px)` }}
                    onOpen={onOpen}
                  />
                );
              })}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function EventCard({
  item,
  colorBy,
  compact,
  showInstructor,
  style,
  onOpen,
}: {
  item: CalItem;
  colorBy: ColorBy;
  compact: boolean;
  showInstructor: boolean;
  style: React.CSSProperties;
  onOpen: (m: Meeting) => void;
}) {
  const m = item.meeting;
  const c = colorFor(colorKey(m, colorBy));
  const inactive = INACTIVE.has(m.status);
  const pending = PENDING.has(m.status);
  const time = `${formatMinutes(item.start)}–${formatMinutes(item.end)}`;
  const tooltip = [time, m.cycle?.name, m.instructor?.name, m.cycle?.branch?.name, meetingStatusHebrew[m.status]].filter(Boolean).join('\n');

  return (
    <button
      onClick={() => onOpen(m)}
      title={tooltip}
      className={`absolute z-[5] text-right rounded-md px-1.5 py-1 overflow-hidden shadow-sm hover:z-30 hover:shadow-md transition-shadow ${inactive ? 'opacity-50 line-through' : ''}`}
      style={{
        ...style,
        background: c.bg,
        color: c.text,
        borderRight: `4px ${pending ? 'dashed' : 'solid'} ${c.border}`,
      }}
    >
      <div className="flex items-center gap-1 text-[11px] font-semibold leading-tight">
        {m.status === 'completed' && <CheckCircle2 size={11} className="shrink-0" />}
        <span className="truncate" dir="ltr">{time}</span>
      </div>
      <div className={`text-xs font-medium leading-tight ${compact ? 'truncate' : 'line-clamp-2'}`}>{m.cycle?.name || 'פגישה'}</div>
      {!compact && showInstructor && m.instructor?.name && <div className="text-[11px] leading-tight truncate opacity-80">{m.instructor.name}</div>}
      {!compact && !showInstructor && m.cycle?.branch?.name && <div className="text-[11px] leading-tight truncate opacity-80">{m.cycle.branch.name}</div>}
    </button>
  );
}

function MonthView({
  anchor,
  start,
  end,
  byDay,
  colorBy,
  onOpen,
  onDay,
}: {
  anchor: Date;
  start: Date;
  end: Date;
  byDay: Map<string, CalItem[]>;
  colorBy: ColorBy;
  onOpen: (m: Meeting) => void;
  onDay: (d: Date) => void;
}) {
  const MAX = 4;
  const todayKey = toDateKey(new Date());
  const days: Date[] = [];
  for (let d = start; d <= end; d = addDays(d, 1)) days.push(d);

  return (
    <div className="bg-white rounded-xl border shadow-sm overflow-hidden">
      <div className="grid grid-cols-7 border-b bg-gray-50">
        {DAY_NAMES.map((n) => (
          <div key={n} className="px-2 py-2 text-center text-sm font-semibold text-gray-700">{n}</div>
        ))}
      </div>
      <div className="grid grid-cols-7">
        {days.map((d) => {
          const key = toDateKey(d);
          const list = byDay.get(key) || [];
          const other = d.getMonth() !== anchor.getMonth();
          return (
            <div key={key} className={`min-h-[130px] border-b border-l p-1.5 ${other ? 'bg-gray-50/70' : ''} ${key === todayKey ? 'bg-blue-50' : ''}`}>
              <button onClick={() => onDay(d)} className="flex w-full items-center justify-between mb-1 group">
                <span className={`text-sm font-semibold w-7 h-7 flex items-center justify-center rounded-full ${key === todayKey ? 'bg-blue-600 text-white' : other ? 'text-gray-400' : 'text-gray-800 group-hover:bg-gray-100'}`}>
                  {d.getDate()}
                </span>
                {list.length > 0 && <span className="text-[11px] text-gray-500">{list.length} פגישות</span>}
              </button>
              <div className="space-y-0.5">
                {list.slice(0, MAX).map((it) => {
                  const c = colorFor(colorKey(it.meeting, colorBy));
                  return (
                    <button
                      key={it.id}
                      onClick={() => onOpen(it.meeting)}
                      title={`${formatMinutes(it.start)} ${it.meeting.cycle?.name || ''} · ${it.meeting.instructor?.name || ''}`}
                      className={`w-full text-right truncate text-[11px] rounded px-1 py-0.5 ${INACTIVE.has(it.meeting.status) ? 'opacity-50 line-through' : ''}`}
                      style={{ background: c.bg, color: c.text, borderRight: `3px solid ${c.border}` }}
                    >
                      <span className="font-semibold" dir="ltr">{formatMinutes(it.start)}</span> {it.meeting.cycle?.name}
                    </button>
                  );
                })}
                {list.length > MAX && (
                  <button onClick={() => onDay(d)} className="w-full text-right text-[11px] text-blue-600 hover:underline px-1">
                    +{list.length - MAX} נוספות
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function MeetingDetails({ meeting, onClose }: { meeting: Meeting | null; onClose: () => void }) {
  if (!meeting) return null;
  const m = meeting;
  const date = fromDateKey(m.scheduledDate);
  const row = (icon: React.ReactNode, label: string, value: React.ReactNode) => (
    <div className="flex items-start gap-3 py-2 border-b last:border-0">
      <span className="text-gray-400 mt-0.5">{icon}</span>
      <span className="w-24 shrink-0 text-sm text-gray-500">{label}</span>
      <span className="text-sm text-gray-900 flex-1">{value}</span>
    </div>
  );

  return (
    <Modal isOpen onClose={onClose} title={m.cycle?.name || 'פגישה'} size="md">
      <div className="px-5 pb-5">
      <div className="space-y-1">
        {row(<CalendarDays size={16} />, 'תאריך', `יום ${DAY_NAMES[date.getDay()]}, ${date.getDate()}/${date.getMonth() + 1}/${date.getFullYear()}`)}
        {row(<Clock size={16} />, 'שעה', <span dir="ltr">{`${formatMinutes(timeToMinutes(m.startTime))}–${formatMinutes(timeToMinutes(m.endTime))}`}</span>)}
        {row(<User size={16} />, 'מדריך', m.instructor?.name || '—')}
        {row(<MapPin size={16} />, 'סניף', m.cycle?.branch?.name || '—')}
        {row(<CheckCircle2 size={16} />, 'סטטוס', meetingStatusHebrew[m.status])}
        {m.cycle?.course?.name && row(<CalendarDays size={16} />, 'קורס', m.cycle.course.name)}
        {m.topic && row(<CalendarDays size={16} />, 'נושא', m.topic)}
        {m.notes && row(<CalendarDays size={16} />, 'הערות', <span className="whitespace-pre-wrap">{m.notes}</span>)}
        {m.zoomJoinUrl &&
          row(<Video size={16} />, 'קישור', (
            <a href={m.zoomJoinUrl} target="_blank" rel="noreferrer" className="text-blue-600 hover:underline break-all">
              {m.zoomJoinUrl}
            </a>
          ))}
      </div>
      <div className="flex justify-end gap-2 mt-4">
        {m.cycleId && (
          <Link to={`/cycles/${m.cycleId}`} className="flex items-center gap-1 px-4 py-2 rounded-lg bg-blue-600 text-white text-sm hover:bg-blue-700">
            <ExternalLink size={14} /> פתח מחזור
          </Link>
        )}
        <button onClick={onClose} className="px-4 py-2 rounded-lg border text-sm hover:bg-gray-50">סגור</button>
      </div>
      </div>
    </Modal>
  );
}
