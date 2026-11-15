import type { DoseLog, Medication, TimeSlot } from '../types';

export function getLocalDateString(date = new Date()): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function getOffsetDateString(daysAgo: number): string {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  return getLocalDateString(d);
}

export function getLocalDateTimeIso(date = new Date()): string {
  const datePart = getLocalDateString(date);
  const hh = String(date.getHours()).padStart(2, '0');
  const mm = String(date.getMinutes()).padStart(2, '0');
  const ss = String(date.getSeconds()).padStart(2, '0');
  return `${datePart}T${hh}:${mm}:${ss}`;
}

export function isDoseTakenLate(
  log: Pick<DoseLog, 'status' | 'scheduledTime' | 'takenAtIso' | 'note'> | null | undefined,
  thresholdMinutes = 30
): boolean {
  if (!log || log.status !== 'taken') return false;
  if (log.note && /\blate\b/i.test(log.note)) return true;
  if (!log.takenAtIso || log.takenAtIso.length < 16) return false;
  const takenHHMM = log.takenAtIso.slice(11, 16);
  const [sh, sm] = log.scheduledTime.split(':').map(Number);
  const [th, tm] = takenHHMM.split(':').map(Number);
  if ([sh, sm, th, tm].some((n) => Number.isNaN(n))) return false;
  return th * 60 + tm - (sh * 60 + sm) >= thresholdMinutes;
}

export function formatTime12h(hhmm: string): string {
  const [hStr, mStr] = hhmm.split(':');
  const h = Number(hStr);
  const m = Number(mStr);
  if (Number.isNaN(h) || Number.isNaN(m)) return hhmm;
  const period = h >= 12 ? 'PM' : 'AM';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m).padStart(2, '0')} ${period}`;
}

export function formatSlotLabel(slot: TimeSlot): string {
  switch (slot) {
    case 'morning':
      return 'Morning';
    case 'afternoon':
      return 'Afternoon';
    case 'evening':
      return 'Evening';
    case 'night':
      return 'Night';
  }
}

export function isScheduledTimeOverdue(
  scheduledTime: string,
  thresholdMinutes: number,
  now = new Date()
): boolean {
  const [hStr, mStr] = scheduledTime.split(':');
  const h = Number(hStr);
  const m = Number(mStr);
  if (Number.isNaN(h) || Number.isNaN(m)) return false;

  const scheduledMins = h * 60 + m;
  const currentMins = now.getHours() * 60 + now.getMinutes();
  return currentMins - scheduledMins >= thresholdMinutes;
}

export interface TodayMedicationItem {
  medication: Medication;
  todayLog: DoseLog | null;
  effectiveStatus: 'taken' | 'missed' | 'skipped' | 'overdue' | 'due_soon' | 'upcoming';
  minutesDelta: number;
}

export function buildTodaySchedule(
  medications: Medication[],
  doseLogs: DoseLog[],
  thresholdMinutes: number,
  now = new Date()
): TodayMedicationItem[] {
  const todayStr = getLocalDateString(now);
  const currentMins = now.getHours() * 60 + now.getMinutes();

  const todayLogsByMed = new Map<string, DoseLog>();
  for (const log of doseLogs) {
    if (log.scheduledDate === todayStr) {
      todayLogsByMed.set(log.medicationId, log);
    }
  }

  return medications
    .filter((m) => m.active)
    .slice()
    .sort((a, b) => a.scheduleTime.localeCompare(b.scheduleTime))
    .map((medication) => {
      const todayLog = todayLogsByMed.get(medication.id) ?? null;
      const [hStr, mStr] = medication.scheduleTime.split(':');
      const schedMins = Number(hStr) * 60 + Number(mStr);
      const minutesDelta = currentMins - schedMins;

      let effectiveStatus: TodayMedicationItem['effectiveStatus'] = 'upcoming';

      if (todayLog) {
        if (todayLog.status === 'taken') effectiveStatus = 'taken';
        else if (todayLog.status === 'missed') effectiveStatus = 'missed';
        else if (todayLog.status === 'skipped') effectiveStatus = 'skipped';
        else if (minutesDelta >= thresholdMinutes) effectiveStatus = 'overdue';
        else if (minutesDelta >= -45) effectiveStatus = 'due_soon';
        else effectiveStatus = 'upcoming';
      } else {
        if (minutesDelta >= thresholdMinutes) effectiveStatus = 'overdue';
        else if (minutesDelta >= -45) effectiveStatus = 'due_soon';
        else effectiveStatus = 'upcoming';
      }

      return {
        medication,
        todayLog,
        effectiveStatus,
        minutesDelta,
      };
    });
}

export interface DailyAdherencePoint {
  date: string;
  shortLabel: string;
  taken: number;
  missed: number;
  skipped: number;
  total: number;
  rate: number;
}

export interface SlotBreakdown {
  slot: TimeSlot;
  label: string;
  taken: number;
  total: number;
  rate: number;
}

export interface MedicationAdherenceSummary {
  medicationId: string;
  medicationName: string;
  dosage: string;
  taken: number;
  missed: number;
  total: number;
  rate: number;
}

export interface AdherenceAnalytics {
  overallRate: number;
  takenCount: number;
  missedCount: number;
  skippedCount: number;
  totalCompletedOrMissed: number;
  dailySeries: DailyAdherencePoint[];
  slotBreakdown: SlotBreakdown[];
  medicationBreakdown: MedicationAdherenceSummary[];
  lowStockMedications: Medication[];
}

export function computeAdherenceAnalytics(
  medications: Medication[],
  doseLogs: DoseLog[]
): AdherenceAnalytics {
  const days: DailyAdherencePoint[] = [];
  const weekdayFormatter = new Intl.DateTimeFormat('en-US', { weekday: 'short' });

  for (let i = 6; i >= 0; i--) {
    const dateStr = getOffsetDateString(i);
    const [y, m, d] = dateStr.split('-').map(Number);
    const dateObj = new Date(y, m - 1, d);
    const dayLogs = doseLogs.filter((l) => l.scheduledDate === dateStr && l.status !== 'pending');
    const taken = dayLogs.filter((l) => l.status === 'taken').length;
    const missed = dayLogs.filter((l) => l.status === 'missed').length;
    const skipped = dayLogs.filter((l) => l.status === 'skipped').length;
    const total = taken + missed + skipped;
    const rate = total > 0 ? Math.round((taken / total) * 100) : 0;

    days.push({
      date: dateStr,
      shortLabel: i === 0 ? 'Today' : weekdayFormatter.format(dateObj),
      taken,
      missed,
      skipped,
      total,
      rate,
    });
  }

  const last7Dates = new Set(days.map((d) => d.date));
  const recentLogs = doseLogs.filter((l) => last7Dates.has(l.scheduledDate) && l.status !== 'pending');
  const takenCount = recentLogs.filter((l) => l.status === 'taken').length;
  const missedCount = recentLogs.filter((l) => l.status === 'missed').length;
  const skippedCount = recentLogs.filter((l) => l.status === 'skipped').length;
  const totalCompletedOrMissed = takenCount + missedCount + skippedCount;
  const overallRate =
    totalCompletedOrMissed > 0 ? Math.round((takenCount / totalCompletedOrMissed) * 100) : 0;

  const slots: TimeSlot[] = ['morning', 'afternoon', 'evening', 'night'];
  const slotBreakdown: SlotBreakdown[] = slots.map((slot) => {
    const slotLogs = recentLogs.filter((l) => l.timeSlot === slot);
    const t = slotLogs.filter((l) => l.status === 'taken').length;
    const tot = slotLogs.length;
    return {
      slot,
      label: formatSlotLabel(slot),
      taken: t,
      total: tot,
      rate: tot > 0 ? Math.round((t / tot) * 100) : 0,
    };
  });

  const medMap = new Map<string, { name: string; dosage: string; taken: number; missed: number; total: number }>();
  for (const med of medications) {
    medMap.set(med.id, {
      name: med.name,
      dosage: med.dosage,
      taken: 0,
      missed: 0,
      total: 0,
    });
  }
  for (const log of recentLogs) {
    const entry = medMap.get(log.medicationId) ?? {
      name: log.medicationName,
      dosage: log.dosage,
      taken: 0,
      missed: 0,
      total: 0,
    };
    entry.total += 1;
    if (log.status === 'taken') entry.taken += 1;
    if (log.status === 'missed') entry.missed += 1;
    medMap.set(log.medicationId, entry);
  }

  const medicationBreakdown: MedicationAdherenceSummary[] = Array.from(medMap.entries()).map(
    ([medicationId, info]) => ({
      medicationId,
      medicationName: info.name,
      dosage: info.dosage,
      taken: info.taken,
      missed: info.missed,
      total: info.total,
      rate: info.total > 0 ? Math.round((info.taken / info.total) * 100) : 0,
    })
  );

  const lowStockMedications = medications.filter((m) => m.active && m.stockCount <= 7);

  return {
    overallRate,
    takenCount,
    missedCount,
    skippedCount,
    totalCompletedOrMissed,
    dailySeries: days,
    slotBreakdown,
    medicationBreakdown,
    lowStockMedications,
  };
}
