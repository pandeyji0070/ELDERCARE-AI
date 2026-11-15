import { useEffect, useState } from 'react';
import {
  AlertOctagon,
  AlertTriangle,
  Calendar,
  Check,
  Clock,
  HeartHandshake,
  Info,
  RotateCcw,
  Sparkles,
  Utensils,
} from 'lucide-react';
import { AvatarImg } from './AvatarImg';
import {
  buildTodaySchedule,
  formatSlotLabel,
  formatTime12h,
  getLocalDateString,
  isDoseTakenLate,
} from '../lib/analytics';
import { fetchAiStatus } from '../lib/apiClient';
import type {
  AiRoutine,
  AiRoutineResponse,
  AiStatusResponse,
  Appointment,
  CareCircle,
  DoseLog,
  Medication,
  SosEvent,
} from '../types';

interface ElderlyDashboardProps {
  circle: CareCircle;
  medications: Medication[];
  doseLogs: DoseLog[];
  appointments: Appointment[];
  sosEvents: SosEvent[];
  latestRoutine: AiRoutine | null;
  busyMedId: string | null;
  onLogDose: (med: Medication, status: 'taken' | 'pending', existingLog: DoseLog | null) => Promise<void>;
  onOpenSos: () => void;
  onQuickAiQuestion: (question: string) => Promise<AiRoutineResponse | null>;
}

export function ElderlyDashboard({
  circle,
  medications,
  doseLogs,
  appointments,
  sosEvents,
  latestRoutine,
  busyMedId,
  onLogDose,
  onOpenSos,
  onQuickAiQuestion,
}: ElderlyDashboardProps) {
  const [quickQuestion, setQuickQuestion] = useState('');
  const [aiLoading, setAiLoading] = useState(false);
  const [aiAnswer, setAiAnswer] = useState<AiRoutineResponse | null>(null);
  const [aiStatus, setAiStatus] = useState<AiStatusResponse | null>(null);
  const [aiStatusLoading, setAiStatusLoading] = useState(false);

  useEffect(() => {
    let active = true;
    setAiStatusLoading(true);
    fetchAiStatus(circle.id)
      .then((res) => {
        if (active) setAiStatus(res);
      })
      .catch(() => {
        if (active) setAiStatus(null);
      })
      .finally(() => {
        if (active) setAiStatusLoading(false);
      });
    return () => {
      active = false;
    };
  }, [circle.id]);

  const todaySchedule = buildTodaySchedule(
    medications,
    doseLogs,
    circle.missedDoseThresholdMinutes
  );

  const takenCount = todaySchedule.filter((i) => i.effectiveStatus === 'taken').length;
  const overdueItems = todaySchedule.filter(
    (i) => i.effectiveStatus === 'overdue' || i.effectiveStatus === 'missed'
  );
  const activeSos = sosEvents.find((s) => s.status !== 'resolved');

  const todayStr = getLocalDateString();
  const nextAppointment = appointments
    .filter((a) => a.status === 'upcoming' && a.appointmentDate >= todayStr)
    .sort((a, b) =>
      `${a.appointmentDate}_${a.appointmentTime}`.localeCompare(
        `${b.appointmentDate}_${b.appointmentTime}`
      )
    )[0];

  const todayFormatted = new Intl.DateTimeFormat('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  }).format(new Date());

  const handleAskAi = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!quickQuestion.trim() || aiLoading) return;
    setAiLoading(true);
    try {
      const res = await onQuickAiQuestion(quickQuestion.trim());
      if (res) {
        setAiAnswer(res);
        setQuickQuestion('');
      }
    } finally {
      setAiLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Resident Greeting & Emergency SOS Anchor */}
      <section className="grid grid-cols-1 lg:grid-cols-3 gap-5 items-stretch">
        <div className="lg:col-span-2 bg-white rounded-3xl border border-slate-200 p-6 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-5">
          <div className="flex items-center gap-4">
            <AvatarImg
              src="/src/assets/images/elderly_avatar_1794717420507.jpg"
              alt={`${circle.elderName} portrait`}
              fallbackInitials={circle.elderName.slice(0, 2).toUpperCase()}
              className="w-20 h-20"
            />
            <div>
              <p className="text-base font-medium text-slate-600">{todayFormatted}</p>
              <h1 className="text-2xl sm:text-3xl font-bold text-slate-900 tracking-tight mt-0.5">
                Hello, {circle.elderName}
              </h1>
              <p className="text-lg text-slate-700 mt-1 tabular-nums">
                {takenCount} of {todaySchedule.length} medicines taken today
              </p>
            </div>
          </div>

          <div className="w-full sm:w-auto flex flex-col items-start sm:items-end gap-1 pt-3 sm:pt-0 border-t sm:border-t-0 border-slate-200">
            <span className="text-sm font-medium text-slate-500">Emergency Contact</span>
            <span className="text-lg font-bold text-slate-900">{circle.emergencyContactName}</span>
            <span className="text-base font-mono tabular-nums text-teal-800">
              {circle.emergencyContactPhone}
            </span>
          </div>
        </div>

        <div className="bg-rose-50 rounded-3xl border border-rose-200 p-6 flex flex-col justify-between gap-4">
          <div>
            <p className="text-lg font-bold text-rose-950">Need Help Right Now?</p>
            <p className="text-sm text-rose-900 mt-1 leading-relaxed">
              Alerts your caretaker and family inside this app. Demo mode only — does not call 911.
            </p>
          </div>
          <button
            type="button"
            onClick={onOpenSos}
            className="w-full min-h-[60px] px-6 py-3 rounded-2xl bg-rose-700 text-white font-bold text-xl flex items-center justify-center gap-3 hover:bg-rose-800 active:scale-[0.99] transition-all focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-rose-900"
          >
            <AlertOctagon className="w-7 h-7 shrink-0" aria-hidden="true" />
            <span>EMERGENCY SOS (DEMO)</span>
          </button>
        </div>
      </section>

      {/* Active Demo SOS Banner */}
      {activeSos && (
        <section
          role="alert"
          className="bg-rose-900 text-white rounded-3xl p-6 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4"
        >
          <div className="flex items-start gap-4">
            <AlertOctagon className="w-8 h-8 text-rose-200 shrink-0 mt-0.5" aria-hidden="true" />
            <div>
              <h2 className="text-xl font-bold">
                Demo SOS Alert {activeSos.status === 'acknowledged' ? 'Acknowledged' : 'Active'}
              </h2>
              <p className="text-base text-rose-100 mt-1">
                {activeSos.note || 'Your Care Circle has been notified inside ELDERCARE AI.'}
              </p>
              <p className="text-sm text-rose-200 mt-1">
                Demo notice: No real emergency services were dispatched.
              </p>
            </div>
          </div>
        </section>
      )}

      {/* Overdue / Missed Dose Alert Banner */}
      {overdueItems.length > 0 && (
        <section
          role="alert"
          className="bg-amber-50 border border-amber-300 rounded-3xl p-6 space-y-4"
        >
          <div className="flex items-start gap-3">
            <AlertTriangle className="w-7 h-7 text-amber-800 shrink-0 mt-0.5" aria-hidden="true" />
            <div>
              <h2 className="text-xl font-bold text-amber-950">
                {overdueItems.length} Medicine{overdueItems.length > 1 ? 's' : ''} Past Scheduled
                Time
              </h2>
              <p className="text-base text-amber-900 mt-1">
                Please check the medicine{overdueItems.length > 1 ? 's' : ''} below and tap when
                taken, or notify your caretaker.
              </p>
            </div>
          </div>
        </section>
      )}

      {/* Today's Large-Button Medication List */}
      <section className="space-y-4">
        <div className="flex items-center justify-between gap-4">
          <h2 className="text-2xl font-bold text-slate-900">Today’s Medicines</h2>
          <span className="text-base font-medium text-slate-600 tabular-nums">
            {todaySchedule.length} scheduled
          </span>
        </div>

        {todaySchedule.length === 0 ? (
          <div className="bg-white rounded-3xl border border-slate-200 p-8 text-center">
            <p className="text-xl font-semibold text-slate-800">No active medicines scheduled</p>
            <p className="text-base text-slate-600 mt-2">
              Switch to the Caretaker view to add daily medicines.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {todaySchedule.map(({ medication, todayLog, effectiveStatus }) => {
              const isTaken = effectiveStatus === 'taken';
              const takenLate = isDoseTakenLate(todayLog, circle.missedDoseThresholdMinutes);
              const isOverdue = effectiveStatus === 'overdue' || effectiveStatus === 'missed';
              const isBusy = busyMedId === medication.id;

              const cardStyle = isTaken
                ? 'bg-emerald-50/70 border-emerald-300'
                : isOverdue
                ? 'bg-amber-50/80 border-amber-300'
                : 'bg-white border-slate-200';

              return (
                <article
                  key={medication.id}
                  className={`rounded-3xl border p-6 flex flex-col justify-between gap-5 ${cardStyle}`}
                >
                  <div className="space-y-3">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-sm font-semibold text-slate-600 flex items-center gap-2">
                          <Clock className="w-4 h-4 text-teal-700" aria-hidden="true" />
                          <span className="tabular-nums">
                            {formatTime12h(medication.scheduleTime)}
                          </span>
                          <span aria-hidden="true">·</span>
                          <span>{formatSlotLabel(medication.timeSlot)}</span>
                        </p>
                        <h3 className="text-2xl font-bold text-slate-900 mt-1">
                          {medication.name}
                        </h3>
                        <p className="text-lg font-semibold text-teal-900 mt-0.5">
                          {medication.dosage}
                        </p>
                      </div>

                      <div className="text-right shrink-0">
                        <span
                          className={`text-sm font-bold ${
                            takenLate
                              ? 'text-amber-800'
                              : isTaken
                              ? 'text-emerald-800'
                              : isOverdue
                              ? 'text-amber-900'
                              : 'text-slate-700'
                          }`}
                        >
                          {takenLate
                            ? 'Taken Late'
                            : isTaken
                            ? 'Taken'
                            : isOverdue
                            ? 'Overdue'
                            : effectiveStatus === 'due_soon'
                            ? 'Due Soon'
                            : 'Later Today'}
                        </span>
                      </div>
                    </div>

                    <div className="space-y-1.5 text-base text-slate-700">
                      {medication.withFood && (
                        <p className="flex items-center gap-2 font-medium text-slate-800">
                          <Utensils className="w-5 h-5 text-teal-700 shrink-0" aria-hidden="true" />
                          <span>Take with food</span>
                        </p>
                      )}
                      {medication.instructions && (
                        <p className="leading-relaxed text-slate-700">{medication.instructions}</p>
                      )}
                    </div>
                  </div>

                  <div>
                    {isTaken ? (
                      <div className="flex items-center gap-3">
                        <div className="flex-1 min-h-[56px] px-5 rounded-2xl bg-emerald-700 text-white font-bold text-lg flex items-center justify-center gap-2">
                          <Check className="w-6 h-6 shrink-0" aria-hidden="true" />
                          <span>
                            {takenLate ? 'Taken Late ' : 'Taken '}
                            {todayLog?.takenAtIso
                              ? `at ${formatTime12h(todayLog.takenAtIso.slice(11, 16))}`
                              : 'Today'}
                          </span>
                        </div>
                        <button
                          type="button"
                          disabled={isBusy}
                          onClick={() => onLogDose(medication, 'pending', todayLog)}
                          className="min-h-[56px] px-4 rounded-2xl border border-slate-300 bg-white text-slate-800 font-semibold text-base flex items-center justify-center gap-2 hover:bg-slate-100 disabled:opacity-50"
                        >
                          <RotateCcw className="w-5 h-5" aria-hidden="true" />
                          <span>Undo</span>
                        </button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        disabled={isBusy}
                        onClick={() => onLogDose(medication, 'taken', todayLog)}
                        className={`w-full min-h-[60px] px-6 rounded-2xl font-bold text-xl flex items-center justify-center gap-3 transition-colors disabled:opacity-50 ${
                          isOverdue
                            ? 'bg-amber-700 text-white hover:bg-amber-800'
                            : 'bg-teal-700 text-white hover:bg-teal-800'
                        }`}
                      >
                        <Check className="w-7 h-7 shrink-0" aria-hidden="true" />
                        <span>{isBusy ? 'Saving...' : 'I TOOK THIS MEDICINE'}</span>
                      </button>
                    )}
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </section>

      {/* Next Doctor Appointment & Daily Routine Guidance */}
      <section className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <div className="bg-white rounded-3xl border border-slate-200 p-6 space-y-4">
          <div className="flex items-center gap-3">
            <Calendar className="w-6 h-6 text-teal-700 shrink-0" aria-hidden="true" />
            <h2 className="text-xl font-bold text-slate-900">Next Doctor Visit</h2>
          </div>

          {nextAppointment ? (
            <div className="space-y-2">
              <p className="text-2xl font-bold text-slate-900">{nextAppointment.doctorName}</p>
              <p className="text-base font-medium text-teal-800">
                {nextAppointment.specialty} · {nextAppointment.clinicName}
              </p>
              <p className="text-lg font-semibold text-slate-800 tabular-nums pt-1">
                {nextAppointment.appointmentDate} at{' '}
                {formatTime12h(nextAppointment.appointmentTime)}
              </p>
              <p className="text-base text-slate-700 leading-relaxed">{nextAppointment.purpose}</p>
              {nextAppointment.notes && (
                <p className="text-base text-slate-600 bg-slate-50 p-4 rounded-2xl border border-slate-200 mt-2">
                  Note: {nextAppointment.notes}
                </p>
              )}
            </div>
          ) : (
            <p className="text-lg text-slate-600">No upcoming doctor appointments scheduled.</p>
          )}
        </div>

        <div className="bg-white rounded-3xl border border-slate-200 p-6 space-y-4">
          <div className="flex items-center gap-3">
            <HeartHandshake className="w-6 h-6 text-teal-700 shrink-0" aria-hidden="true" />
            <h2 className="text-xl font-bold text-slate-900">Today’s Care Routine</h2>
          </div>

          {aiAnswer ? (
            <div className="space-y-3 bg-teal-50/70 border border-teal-200 rounded-2xl p-4">
              <p className="text-base font-semibold text-teal-950">{aiAnswer.answerToQuestion}</p>
              <p className="text-base text-slate-800 leading-relaxed">{aiAnswer.safetyTip}</p>
              <p className="text-xs text-slate-600">{aiAnswer.disclaimer}</p>
            </div>
          ) : latestRoutine ? (
            <div className="space-y-3 text-base text-slate-700 leading-relaxed">
              <p className="font-medium text-slate-900">{latestRoutine.summary}</p>
              <p className="bg-slate-50 p-4 rounded-2xl border border-slate-200">
                <strong className="text-slate-900">Safety Reminder:</strong>{' '}
                {latestRoutine.safetyTip}
              </p>
            </div>
          ) : (
            <p className="text-lg text-slate-600">
              Ask our AI routine helper below for simple daily wellness guidance.
            </p>
          )}

          {!aiStatusLoading && aiStatus && !aiStatus.geminiConfigured && (
            <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950 flex items-start gap-3">
              <Info className="w-5 h-5 text-amber-800 shrink-0 mt-0.5" aria-hidden="true" />
              <div>
                <p className="font-bold">AI Routine Helper — Configuration Pending</p>
                <p className="text-amber-900 mt-0.5 leading-relaxed">
                  Live AI Q&amp;A is waiting for server setup. Your daily medicine reminders,
                  saved care routine above, and Demo SOS button are all active.
                </p>
              </div>
            </div>
          )}

          <form onSubmit={handleAskAi} className="flex flex-col sm:flex-row gap-3 pt-1">
            <input
              type="text"
              value={quickQuestion}
              onChange={(e) => setQuickQuestion(e.target.value)}
              disabled={!aiStatusLoading && aiStatus !== null && !aiStatus.geminiConfigured}
              placeholder={
                !aiStatusLoading && aiStatus && !aiStatus.geminiConfigured
                  ? 'AI Helper pending configuration...'
                  : 'Ask a daily routine question...'
              }
              maxLength={180}
              className="flex-1 min-h-[52px] px-4 rounded-2xl border border-slate-300 text-base text-slate-900 placeholder:text-slate-400 focus:border-teal-700 focus:outline-none disabled:bg-slate-50 disabled:text-slate-500"
            />
            <button
              type="submit"
              disabled={
                aiLoading ||
                !quickQuestion.trim() ||
                (!aiStatusLoading && aiStatus !== null && !aiStatus.geminiConfigured)
              }
              className="min-h-[52px] px-5 rounded-2xl bg-slate-900 text-white font-semibold text-base flex items-center justify-center gap-2 hover:bg-slate-800 disabled:opacity-45 whitespace-nowrap shrink-0"
            >
              <Sparkles className="w-5 h-5" aria-hidden="true" />
              <span>
                {aiLoading
                  ? 'Thinking...'
                  : !aiStatusLoading && aiStatus && !aiStatus.geminiConfigured
                  ? 'Pending Setup'
                  : 'Ask Helper'}
              </span>
            </button>
          </form>
        </div>
      </section>
    </div>
  );
}
