import { useMemo, useState } from 'react';
import { CalendarDays, CheckCircle2, XCircle } from 'lucide-react';
import { formatTime12h, getLocalDateString, getOffsetDateString, isDoseTakenLate } from '../lib/analytics';
import type { DoseLog } from '../types';

interface AdherenceCalendarProps {
  doseLogs: DoseLog[];
}

interface CalendarDayCell {
  dateStr: string;
  dayNumber: number;
  monthShort: string;
  isToday: boolean;
  isFirstOfMonth: boolean;
  logs: DoseLog[];
  takenCount: number;
  missedCount: number;
  skippedCount: number;
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;

export function AdherenceCalendar({ doseLogs }: AdherenceCalendarProps) {
  const todayStr = getLocalDateString();
  const [selectedDate, setSelectedDate] = useState<string>(todayStr);

  const { leadingEmptyCount, days, summary30d } = useMemo(() => {
    const logsByDate = new Map<string, DoseLog[]>();
    for (const log of doseLogs) {
      if (log.status === 'pending') continue;
      const list = logsByDate.get(log.scheduledDate) ?? [];
      list.push(log);
      logsByDate.set(log.scheduledDate, list);
    }

    const monthFmt = new Intl.DateTimeFormat('en-US', { month: 'short' });
    const builtDays: CalendarDayCell[] = [];

    let totalTaken = 0;
    let totalMissed = 0;

    for (let offset = 29; offset >= 0; offset--) {
      const dateStr = getOffsetDateString(offset);
      const [y, m, d] = dateStr.split('-').map(Number);
      const dateObj = new Date(y, m - 1, d);
      const dayLogs = (logsByDate.get(dateStr) ?? [])
        .slice()
        .sort((a, b) => a.scheduledTime.localeCompare(b.scheduledTime));

      const takenCount = dayLogs.filter((l) => l.status === 'taken').length;
      const missedCount = dayLogs.filter((l) => l.status === 'missed').length;
      const skippedCount = dayLogs.filter((l) => l.status === 'skipped').length;

      totalTaken += takenCount;
      totalMissed += missedCount;

      builtDays.push({
        dateStr,
        dayNumber: d,
        monthShort: monthFmt.format(dateObj),
        isToday: dateStr === todayStr,
        isFirstOfMonth: d === 1,
        logs: dayLogs,
        takenCount,
        missedCount,
        skippedCount,
      });
    }

    const firstDateStr = builtDays[0]?.dateStr ?? todayStr;
    const [fy, fm, fd] = firstDateStr.split('-').map(Number);
    const firstWeekday = new Date(fy, fm - 1, fd).getDay();

    return {
      leadingEmptyCount: firstWeekday,
      days: builtDays,
      summary30d: {
        taken: totalTaken,
        missed: totalMissed,
      },
    };
  }, [doseLogs, todayStr]);

  const selectedCell =
    days.find((d) => d.dateStr === selectedDate) ?? days[days.length - 1];

  const selectedHeading = useMemo(() => {
    if (!selectedCell) return '';
    const [y, m, d] = selectedCell.dateStr.split('-').map(Number);
    return new Intl.DateTimeFormat('en-US', {
      weekday: 'long',
      month: 'long',
      day: 'numeric',
      year: 'numeric',
    }).format(new Date(y, m - 1, d));
  }, [selectedCell]);

  return (
    <section className="bg-white rounded-3xl border border-slate-200 p-6 space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-start gap-2.5">
          <CalendarDays className="w-5 h-5 text-teal-700 shrink-0 mt-0.5" aria-hidden="true" />
          <div>
            <h2 className="text-lg font-bold text-slate-900">
              30-Day Medication Adherence Calendar
            </h2>
            <p className="text-sm text-slate-600 mt-0.5 tabular-nums">
              {summary30d.taken} taken · {summary30d.missed} missed across the past 30 days. Tap any
              day to inspect doses.
            </p>
          </div>
        </div>

        {/* Color Legend with explicit text labels */}
        <div className="flex flex-wrap items-center gap-4 text-xs font-semibold text-slate-700 shrink-0">
          <div className="flex items-center gap-1.5">
            <span className="w-3 h-3 rounded-full bg-emerald-600 inline-block" aria-hidden="true" />
            <span>Taken</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="w-3 h-3 rounded-full bg-rose-600 inline-block" aria-hidden="true" />
            <span>Missed</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="w-3 h-3 rounded-full bg-slate-400 inline-block" aria-hidden="true" />
            <span>Skipped</span>
          </div>
        </div>
      </div>

      {/* Weekday Column Headers */}
      <div className="grid grid-cols-7 gap-1.5 sm:gap-2 text-center">
        {WEEKDAYS.map((day) => (
          <div key={day} className="text-xs font-semibold text-slate-500 py-1">
            {day}
          </div>
        ))}
      </div>

      {/* 30-Day Calendar Grid */}
      <div className="grid grid-cols-7 gap-1.5 sm:gap-2">
        {Array.from({ length: leadingEmptyCount }).map((_, idx) => (
          <div key={`empty_${idx}`} className="min-h-[56px] sm:min-h-[64px] rounded-xl bg-slate-50/60" />
        ))}

        {days.map((cell) => {
          const isSelected = selectedCell?.dateStr === cell.dateStr;
          const hasMissed = cell.missedCount > 0;
          const visibleLogs = cell.logs.slice(0, 6);
          const overflowCount = cell.logs.length - visibleLogs.length;

          return (
            <button
              key={cell.dateStr}
              type="button"
              onClick={() => setSelectedDate(cell.dateStr)}
              aria-label={`${cell.dateStr}: ${cell.takenCount} taken, ${cell.missedCount} missed`}
              aria-pressed={isSelected}
              className={`min-h-[56px] sm:min-h-[64px] p-1.5 sm:p-2 rounded-xl border text-left flex flex-col justify-between transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-700 ${
                isSelected
                  ? 'border-slate-900 bg-slate-50 ring-1 ring-slate-900'
                  : hasMissed
                  ? 'border-rose-200 bg-rose-50/40 hover:bg-rose-50/70'
                  : 'border-slate-200 bg-white hover:bg-slate-50'
              }`}
            >
              <div className="flex items-center justify-between gap-1 w-full">
                <span
                  className={`text-xs font-bold tabular-nums leading-none ${
                    cell.isToday ? 'text-teal-800' : 'text-slate-800'
                  }`}
                >
                  {cell.isFirstOfMonth ? `${cell.monthShort} ${cell.dayNumber}` : cell.dayNumber}
                </span>
                {cell.isToday && (
                  <span className="text-[10px] font-bold text-teal-800 hidden sm:inline">
                    Today
                  </span>
                )}
              </div>

              <div className="flex flex-wrap items-center gap-1 pt-1">
                {cell.logs.length === 0 ? (
                  <span className="text-[10px] text-slate-400 leading-none">—</span>
                ) : (
                  <>
                    {visibleLogs.map((log) => {
                      const dotColor =
                        log.status === 'taken'
                          ? 'bg-emerald-600'
                          : log.status === 'missed'
                          ? 'bg-rose-600'
                          : 'bg-slate-400';

                      return (
                        <span
                          key={log.id}
                          title={`${log.medicationName} (${formatTime12h(log.scheduledTime)}): ${log.status}`}
                          className={`w-2 h-2 sm:w-2.5 sm:h-2.5 rounded-full inline-block shrink-0 ${dotColor}`}
                        />
                      );
                    })}
                    {overflowCount > 0 && (
                      <span className="text-[10px] font-semibold text-slate-600 tabular-nums">
                        +{overflowCount}
                      </span>
                    )}
                  </>
                )}
              </div>
            </button>
          );
        })}
      </div>

      {/* Selected Day Adherence Details */}
      {selectedCell && (
        <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 space-y-3">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <h3 className="text-sm font-bold text-slate-900">{selectedHeading}</h3>
            <p className="text-xs font-semibold text-slate-600 tabular-nums">
              {selectedCell.takenCount} Taken · {selectedCell.missedCount} Missed
              {selectedCell.skippedCount > 0 ? ` · ${selectedCell.skippedCount} Skipped` : ''}
            </p>
          </div>

          {selectedCell.logs.length === 0 ? (
            <p className="text-sm text-slate-600">
              No medication adherence logs recorded for this date.
            </p>
          ) : (
            <div className="divide-y divide-slate-200 bg-white rounded-xl border border-slate-200 px-4">
              {selectedCell.logs.map((log) => {
                const isTaken = log.status === 'taken';
                const isMissed = log.status === 'missed';
                const takenLate = isDoseTakenLate(log);

                return (
                  <div
                    key={log.id}
                    className="py-2.5 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-sm"
                  >
                    <div className="flex items-start gap-2.5">
                      {isTaken ? (
                        <CheckCircle2
                          className={`w-4 h-4 shrink-0 mt-0.5 ${
                            takenLate ? 'text-amber-700' : 'text-emerald-700'
                          }`}
                          aria-hidden="true"
                        />
                      ) : isMissed ? (
                        <XCircle className="w-4 h-4 text-rose-700 shrink-0 mt-0.5" aria-hidden="true" />
                      ) : (
                        <span
                          className="w-2.5 h-2.5 rounded-full bg-slate-400 mx-0.5 mt-1.5 shrink-0"
                          aria-hidden="true"
                        />
                      )}
                      <div>
                        <div>
                          <span className="font-semibold text-slate-900">{log.medicationName}</span>
                          <span className="text-slate-500 ml-2 text-xs">{log.dosage}</span>
                        </div>
                        {log.note && (
                          <p className="text-xs text-slate-500 mt-0.5">{log.note}</p>
                        )}
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center gap-3 text-xs tabular-nums pl-6 sm:pl-0">
                      <span className="text-slate-600">
                        Scheduled {formatTime12h(log.scheduledTime)}
                      </span>
                      {isTaken && log.takenAtIso && (
                        <span className="text-slate-500">
                          Logged {formatTime12h(log.takenAtIso.slice(11, 16))}
                        </span>
                      )}
                      <span
                        className={`font-bold capitalize ${
                          takenLate
                            ? 'text-amber-800'
                            : isTaken
                            ? 'text-emerald-800'
                            : isMissed
                            ? 'text-rose-700'
                            : 'text-slate-700'
                        }`}
                      >
                        {takenLate ? 'Taken Late' : log.status}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
