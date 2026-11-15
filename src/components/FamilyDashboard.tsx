import { useEffect, useState } from 'react';
import {
  BarChart3,
  BellRing,
  BookmarkCheck,
  Calendar,
  Check,
  CheckCircle2,
  Copy,
  FileDown,
  FileText,
  Info,
  KeyRound,
  Mail,
  PhoneCall,
  RefreshCw,
  Send,
  ShieldCheck,
  Sparkles,
  Trash2,
  UserPlus,
  Users,
  XCircle,
} from 'lucide-react';
import { AvatarImg } from './AvatarImg';
import { AdherenceCalendar } from './AdherenceCalendar';
import {
  computeAdherenceAnalytics,
  formatTime12h,
  getLocalDateString,
} from '../lib/analytics';
import { fetchAiStatus, fetchSmtpStatus } from '../lib/apiClient';
import { exportDoctorVisitPdf, type ReportRange } from '../lib/pdfExport';
import type {
  AiRoutine,
  AiRoutineResponse,
  AiStatusResponse,
  Appointment,
  CareCircle,
  CircleInvite,
  CircleMember,
  DashboardRole,
  DoseLog,
  Medication,
  NotificationLog,
  SmtpStatusResponse,
  SosEvent,
} from '../types';

interface FamilyDashboardProps {
  circle: CareCircle;
  isOwner: boolean;
  currentUserUid: string;
  members: CircleMember[];
  invites: CircleInvite[];
  syncingMembers: boolean;
  medications: Medication[];
  doseLogs: DoseLog[];
  appointments: Appointment[];
  sosEvents: SosEvent[];
  notificationLogs: NotificationLog[];
  aiRoutines: AiRoutine[];
  onSaveEmailSettings: (payload: {
    notificationEmail: string;
    emailAlertsEnabled: boolean;
    missedDoseThresholdMinutes: number;
  }) => Promise<void>;
  onSendTestNotification: (email: string) => Promise<void>;
  onGenerateAiRoutine: (focus: string, question: string) => Promise<AiRoutineResponse | null>;
  onSaveAiRoutine: (focus: string, plan: AiRoutineResponse) => Promise<void>;
  onDeleteAiRoutine: (routineId: string) => Promise<void>;
  onUpdateEmergencyContact: (name: string, phone: string, elderPhone: string) => Promise<void>;
  onCreateInvite: (invitedRole: DashboardRole, invitedEmail?: string) => Promise<CircleInvite | null>;
  onRevokeInvite: (inviteCode: string) => Promise<void>;
  onUpdateMemberRole: (memberUid: string, nextRole: DashboardRole) => Promise<void>;
  onRemoveMember: (memberUid: string) => Promise<void>;
  onSyncMembersNow: () => Promise<void>;
  onReportFeedback: (type: 'success' | 'error', title: string, detail?: string) => void;
}

const FOCUS_PRESETS = [
  'Balanced daily medication timing, hydration, and gentle mobility',
  'Heart-friendly morning routine & blood pressure stability',
  'Memory-friendly meal pairing & calm evening sleep hygiene',
];

export function FamilyDashboard({
  circle,
  isOwner,
  currentUserUid,
  members,
  invites,
  syncingMembers,
  medications,
  doseLogs,
  appointments,
  sosEvents,
  notificationLogs,
  aiRoutines,
  onSaveEmailSettings,
  onSendTestNotification,
  onGenerateAiRoutine,
  onSaveAiRoutine,
  onDeleteAiRoutine,
  onUpdateEmergencyContact,
  onCreateInvite,
  onRevokeInvite,
  onUpdateMemberRole,
  onRemoveMember,
  onSyncMembersNow,
  onReportFeedback,
}: FamilyDashboardProps) {
  const analytics = computeAdherenceAnalytics(medications, doseLogs);

  const [emailInput, setEmailInput] = useState(circle.notificationEmail || '');
  const [alertsEnabled, setAlertsEnabled] = useState(circle.emailAlertsEnabled);
  const [thresholdMins, setThresholdMins] = useState(circle.missedDoseThresholdMinutes);
  const [smtpStatus, setSmtpStatus] = useState<SmtpStatusResponse | null>(null);
  const [smtpLoading, setSmtpLoading] = useState(false);
  const [savingEmail, setSavingEmail] = useState(false);
  const [testingEmail, setTestingEmail] = useState(false);

  const [elderPhoneInput, setElderPhoneInput] = useState(circle.elderPhone || '');
  const [contactName, setContactName] = useState(circle.emergencyContactName);
  const [contactPhone, setContactPhone] = useState(circle.emergencyContactPhone);
  const [savingContact, setSavingContact] = useState(false);

  const [aiFocus, setAiFocus] = useState(FOCUS_PRESETS[0]);
  const [aiQuestion, setAiQuestion] = useState('');
  const [aiGenerating, setAiGenerating] = useState(false);
  const [aiResult, setAiResult] = useState<AiRoutineResponse | null>(null);
  const [savingRoutine, setSavingRoutine] = useState(false);
  const [aiStatus, setAiStatus] = useState<AiStatusResponse | null>(null);
  const [aiStatusLoading, setAiStatusLoading] = useState(false);

  const [reportRange, setReportRange] = useState<ReportRange>('7d');
  const [includeRegimen, setIncludeRegimen] = useState(true);
  const [includeLogs, setIncludeLogs] = useState(true);
  const [includeAppts, setIncludeAppts] = useState(true);
  const [exportingPdf, setExportingPdf] = useState(false);

  const [inviteRole, setInviteRole] = useState<DashboardRole>('family');
  const [inviteEmail, setInviteEmail] = useState('');
  const [creatingInvite, setCreatingInvite] = useState(false);
  const [copiedCode, setCopiedCode] = useState<string | null>(null);
  const [memberBusyUid, setMemberBusyUid] = useState<string | null>(null);

  useEffect(() => {
    setEmailInput(circle.notificationEmail || '');
    setAlertsEnabled(circle.emailAlertsEnabled);
    setThresholdMins(circle.missedDoseThresholdMinutes);
    setElderPhoneInput(circle.elderPhone || '');
    setContactName(circle.emergencyContactName);
    setContactPhone(circle.emergencyContactPhone);
  }, [circle]);

  useEffect(() => {
    let active = true;
    setSmtpLoading(true);
    fetchSmtpStatus(circle.id)
      .then((res) => {
        if (active) setSmtpStatus(res);
      })
      .catch(() => {
        if (active) setSmtpStatus(null);
      })
      .finally(() => {
        if (active) setSmtpLoading(false);
      });

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

  const todayStr = getLocalDateString();
  const upcomingAppointments = appointments.filter(
    (a) => a.status === 'upcoming' && a.appointmentDate >= todayStr
  );
  const pastAppointments = appointments
    .filter((a) => a.status !== 'upcoming' || a.appointmentDate < todayStr)
    .slice()
    .sort((a, b) =>
      `${b.appointmentDate}_${b.appointmentTime}`.localeCompare(
        `${a.appointmentDate}_${a.appointmentTime}`
      )
    );
  const activeSosCount = sosEvents.filter((s) => s.status !== 'resolved').length;

  const handleSaveSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingEmail(true);
    try {
      await onSaveEmailSettings({
        notificationEmail: emailInput.trim(),
        emailAlertsEnabled: alertsEnabled,
        missedDoseThresholdMinutes: thresholdMins,
      });
    } finally {
      setSavingEmail(false);
    }
  };

  const handleTestEmail = async () => {
    if (!emailInput.trim()) return;
    setTestingEmail(true);
    try {
      await onSendTestNotification(emailInput.trim());
    } finally {
      setTestingEmail(false);
    }
  };

  const handleSaveContact = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!contactName.trim() || !contactPhone.trim()) return;
    setSavingContact(true);
    try {
      await onUpdateEmergencyContact(
        contactName.trim(),
        contactPhone.trim(),
        elderPhoneInput.trim()
      );
    } finally {
      setSavingContact(false);
    }
  };

  const handleGenerateRoutine = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!aiFocus.trim() || aiGenerating) return;
    setAiGenerating(true);
    try {
      const res = await onGenerateAiRoutine(aiFocus.trim(), aiQuestion.trim());
      if (res) setAiResult(res);
    } finally {
      setAiGenerating(false);
    }
  };

  const handleSaveRoutine = async () => {
    if (!aiResult || savingRoutine) return;
    setSavingRoutine(true);
    try {
      await onSaveAiRoutine(aiFocus.trim(), aiResult);
    } finally {
      setSavingRoutine(false);
    }
  };

  const handleExportPdf = () => {
    if (!includeRegimen && !includeLogs && !includeAppts) {
      onReportFeedback(
        'error',
        'Select at least one report section',
        'Enable adherence logs, appointment history, or active regimen before exporting.'
      );
      return;
    }
    setExportingPdf(true);
    try {
      const result = exportDoctorVisitPdf({
        circle,
        medications,
        doseLogs,
        appointments,
        range: reportRange,
        includeActiveRegimen: includeRegimen,
        includeAdherenceLogs: includeLogs,
        includeAppointments: includeAppts,
      });
      onReportFeedback(
        'success',
        'Doctor Visit PDF Downloaded',
        `Saved ${result.fileName} (${result.logsExported} dose logs, ${result.appointmentsExported} appointments).`
      );
    } catch (err) {
      onReportFeedback(
        'error',
        'PDF export failed',
        err instanceof Error ? err.message : 'Unable to generate PDF document.'
      );
    } finally {
      setExportingPdf(false);
    }
  };

  const handleGenerateInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isOwner || creatingInvite) return;
    setCreatingInvite(true);
    try {
      const created = await onCreateInvite(inviteRole, inviteEmail.trim() || undefined);
      if (created) {
        setInviteEmail('');
      }
    } finally {
      setCreatingInvite(false);
    }
  };

  const handleCopyCode = async (code: string) => {
    try {
      await navigator.clipboard.writeText(code);
      setCopiedCode(code);
      setTimeout(() => setCopiedCode((prev) => (prev === code ? null : prev)), 2500);
      onReportFeedback('success', 'Invite code copied', `Share ${code} with your invited Care Circle member.`);
    } catch {
      onReportFeedback('error', 'Clipboard copy failed', `Please copy the code manually: ${code}`);
    }
  };

  const handleCopyInviteLink = async (code: string) => {
    const shareUrl = `${window.location.origin}/?invite=${encodeURIComponent(code)}`;
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopiedCode(`link_${code}`);
      setTimeout(() => setCopiedCode((prev) => (prev === `link_${code}` ? null : prev)), 2500);
      onReportFeedback(
        'success',
        'Invite link copied',
        'Send this link to the invited Care Circle member to open and join after Google sign-in.'
      );
    } catch {
      onReportFeedback('error', 'Clipboard copy failed', `Share link manually: ${shareUrl}`);
    }
  };

  const handleRoleUpdate = async (memberUid: string, nextRole: DashboardRole) => {
    setMemberBusyUid(memberUid);
    try {
      await onUpdateMemberRole(memberUid, nextRole);
    } finally {
      setMemberBusyUid(null);
    }
  };

  const handleRemoveMember = async (memberUid: string) => {
    setMemberBusyUid(memberUid);
    try {
      await onRemoveMember(memberUid);
    } finally {
      setMemberBusyUid(null);
    }
  };

  return (
    <div className="space-y-6">
      {/* Family Oversight Header */}
      <section className="bg-white rounded-3xl border border-slate-200 p-6 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <AvatarImg
            src="/src/assets/images/family_avatar_1794717421433.jpg"
            alt="Family member portrait"
            fallbackInitials="FM"
            className="w-16 h-16"
          />
          <div>
            <p className="text-sm font-medium text-slate-500">
              Family Oversight · Caring for {circle.elderName}
            </p>
            <h1 className="text-2xl font-bold text-slate-900 mt-0.5">
              Adherence Analytics, Alerts & AI Routine
            </h1>
            <p className="text-sm text-slate-600 mt-0.5">
              Real-time sync with {circle.elderName}’s schedule · {upcomingAppointments.length}{' '}
              upcoming visit{upcomingAppointments.length === 1 ? '' : 's'}
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-4">
          {circle.elderPhone && circle.elderPhone.replace(/[^+\d]/g, '').length >= 3 && (
            <a
              href={`tel:${circle.elderPhone.replace(/[^+\d]/g, '')}`}
              title={`Call ${circle.elderName} at ${circle.elderPhone}`}
              className="min-h-[48px] px-5 rounded-2xl bg-slate-900 text-white font-semibold text-sm flex items-center gap-2 hover:bg-slate-800 whitespace-nowrap shrink-0"
            >
              <PhoneCall className="w-4 h-4" aria-hidden="true" />
              <span>Quick Call</span>
            </a>
          )}
          <div className="text-left md:text-right">
            <p className="text-xs font-medium text-slate-500">Active SOS Demo Alerts</p>
            <p
              className={`text-lg font-bold tabular-nums ${
                activeSosCount > 0 ? 'text-rose-700' : 'text-emerald-800'
              }`}
            >
              {activeSosCount > 0 ? `${activeSosCount} Active Demo Alert` : 'All Clear'}
            </p>
          </div>
        </div>
      </section>

      {/* Doctor Visit PDF Report Export */}
      <section className="bg-white rounded-3xl border border-slate-200 p-6 space-y-4">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div className="flex items-start gap-3">
            <FileText className="w-6 h-6 text-teal-700 shrink-0 mt-0.5" aria-hidden="true" />
            <div>
              <h2 className="text-lg font-bold text-slate-900">
                Doctor Visit PDF Report Export
              </h2>
              <p className="text-sm text-slate-600 mt-0.5">
                Download a printable clinical summary of {circle.elderName}’s medication adherence
                logs and appointment history.
              </p>
            </div>
          </div>

          <button
            type="button"
            disabled={exportingPdf}
            onClick={handleExportPdf}
            className="min-h-[48px] px-5 rounded-2xl bg-teal-700 text-white font-semibold text-sm flex items-center justify-center gap-2 hover:bg-teal-800 disabled:opacity-50 whitespace-nowrap shrink-0"
          >
            <FileDown className="w-4 h-4" aria-hidden="true" />
            <span>{exportingPdf ? 'Generating PDF...' : 'Export Doctor Visit PDF'}</span>
          </button>
        </div>

        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pt-3 border-t border-slate-200">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-semibold text-slate-600 mr-1">Log Period:</span>
            <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-xl">
              {(
                [
                  { id: '7d', label: '7 Days' },
                  { id: '14d', label: '14 Days' },
                  { id: '30d', label: '30 Days' },
                  { id: 'all', label: 'All Logs' },
                ] as const
              ).map((opt) => (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => setReportRange(opt.id)}
                  className={`min-h-[36px] px-3 rounded-lg text-xs font-semibold whitespace-nowrap transition-colors ${
                    reportRange === opt.id
                      ? 'bg-white text-slate-900 shadow-sm'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-5 text-sm text-slate-800">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={includeLogs}
                onChange={(e) => setIncludeLogs(e.target.checked)}
                className="w-4 h-4 rounded border-slate-300 text-teal-700"
              />
              <span>Adherence Logs ({doseLogs.length})</span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={includeAppts}
                onChange={(e) => setIncludeAppts(e.target.checked)}
                className="w-4 h-4 rounded border-slate-300 text-teal-700"
              />
              <span>Appointment History ({appointments.length})</span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={includeRegimen}
                onChange={(e) => setIncludeRegimen(e.target.checked)}
                className="w-4 h-4 rounded border-slate-300 text-teal-700"
              />
              <span>Active Regimen ({medications.length})</span>
            </label>
          </div>
        </div>
      </section>

      {/* 4-Column KPI Strip */}
      <section className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white rounded-2xl border border-slate-200 p-5">
          <p className="text-xs font-medium text-slate-500">7-Day Adherence Rate</p>
          <p className="text-3xl font-bold text-slate-900 tabular-nums mt-1">
            {analytics.overallRate}%
          </p>
          <p className="text-xs text-slate-600 mt-1 tabular-nums">
            {analytics.takenCount} of {analytics.totalCompletedOrMissed} logged doses
          </p>
        </div>

        <div className="bg-white rounded-2xl border border-slate-200 p-5">
          <p className="text-xs font-medium text-slate-500">Doses Confirmed</p>
          <p className="text-3xl font-bold text-emerald-800 tabular-nums mt-1">
            {analytics.takenCount}
          </p>
          <p className="text-xs text-slate-600 mt-1">Past 7 days</p>
        </div>

        <div className="bg-white rounded-2xl border border-slate-200 p-5">
          <p className="text-xs font-medium text-slate-500">Missed Doses</p>
          <p
            className={`text-3xl font-bold tabular-nums mt-1 ${
              analytics.missedCount > 0 ? 'text-amber-800' : 'text-slate-900'
            }`}
          >
            {analytics.missedCount}
          </p>
          <p className="text-xs text-slate-600 mt-1">Past 7 days</p>
        </div>

        <div className="bg-white rounded-2xl border border-slate-200 p-5">
          <p className="text-xs font-medium text-slate-500">Low Refill Alerts</p>
          <p
            className={`text-3xl font-bold tabular-nums mt-1 ${
              analytics.lowStockMedications.length > 0 ? 'text-rose-700' : 'text-slate-900'
            }`}
          >
            {analytics.lowStockMedications.length}
          </p>
          <p className="text-xs text-slate-600 mt-1">
            {analytics.lowStockMedications.length > 0
              ? analytics.lowStockMedications.map((m) => m.name).join(', ')
              : 'All stocks sufficient'}
          </p>
        </div>
      </section>

      {/* Adherence Analytics Charts */}
      <section className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* 7-Day Daily Adherence Chart */}
        <div className="lg:col-span-2 bg-white rounded-3xl border border-slate-200 p-6 space-y-5">
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-2.5">
              <BarChart3 className="w-5 h-5 text-teal-700" aria-hidden="true" />
              <h2 className="text-lg font-bold text-slate-900">7-Day Adherence Trend</h2>
            </div>
            <span className="text-xs text-slate-500 tabular-nums">Daily % taken</span>
          </div>

          <div className="grid grid-cols-7 gap-2 sm:gap-4 items-end h-52 pt-6 pb-2 border-b border-slate-200">
            {analytics.dailySeries.map((day) => {
              const barHeight = Math.max(8, day.rate);
              const barColor =
                day.total === 0
                  ? 'bg-slate-200'
                  : day.rate >= 85
                  ? 'bg-teal-700'
                  : day.rate >= 60
                  ? 'bg-amber-600'
                  : 'bg-rose-600';

              return (
                <div key={day.date} className="flex flex-col items-center justify-end h-full gap-2">
                  <span className="text-xs font-semibold text-slate-700 tabular-nums">
                    {day.total > 0 ? `${day.rate}%` : '—'}
                  </span>
                  <div className="w-full max-w-[40px] h-32 bg-slate-100 rounded-xl flex items-end overflow-hidden">
                    <div
                      style={{ height: `${day.total > 0 ? barHeight : 8}%` }}
                      className={`w-full rounded-t-xl transition-all duration-300 ${barColor}`}
                      title={`${day.date}: ${day.taken}/${day.total} taken (${day.rate}%)`}
                    />
                  </div>
                  <span className="text-xs font-medium text-slate-600 whitespace-nowrap">
                    {day.shortLabel}
                  </span>
                </div>
              );
            })}
          </div>

          {/* Per-Medication Breakdown Table */}
          <div className="space-y-3">
            <h3 className="text-sm font-bold text-slate-800">Adherence by Medication (7 Days)</h3>
            <div className="divide-y divide-slate-200">
              {analytics.medicationBreakdown.map((item) => (
                <div
                  key={item.medicationId}
                  className="py-2.5 flex items-center justify-between gap-4 text-sm"
                >
                  <div className="min-w-0">
                    <span className="font-semibold text-slate-900">{item.medicationName}</span>
                    <span className="text-slate-500 ml-2">{item.dosage}</span>
                  </div>
                  <div className="flex items-center gap-4 shrink-0 tabular-nums">
                    <span className="text-slate-600">
                      {item.taken}/{item.total} taken
                    </span>
                    <span
                      className={`font-bold w-12 text-right ${
                        item.rate >= 85
                          ? 'text-emerald-800'
                          : item.rate >= 60
                          ? 'text-amber-800'
                          : 'text-rose-700'
                      }`}
                    >
                      {item.total > 0 ? `${item.rate}%` : '—'}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Time-of-Day Breakdown & Upcoming Appointments */}
        <div className="space-y-6">
          <div className="bg-white rounded-3xl border border-slate-200 p-6 space-y-4">
            <h2 className="text-lg font-bold text-slate-900">By Time of Day</h2>
            <div className="space-y-3">
              {analytics.slotBreakdown.map((slot) => (
                <div key={slot.slot} className="space-y-1.5">
                  <div className="flex items-center justify-between text-sm">
                    <span className="font-semibold text-slate-800">{slot.label}</span>
                    <span className="text-slate-600 tabular-nums">
                      {slot.taken}/{slot.total} · {slot.total > 0 ? `${slot.rate}%` : '—'}
                    </span>
                  </div>
                  <div className="w-full h-2.5 bg-slate-100 rounded-full overflow-hidden">
                    <div
                      style={{ width: `${slot.total > 0 ? slot.rate : 0}%` }}
                      className="h-full bg-teal-700 rounded-full"
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="bg-white rounded-3xl border border-slate-200 p-6 space-y-4">
            <div className="flex items-center gap-2">
              <Calendar className="w-5 h-5 text-teal-700" aria-hidden="true" />
              <h2 className="text-lg font-bold text-slate-900">Doctor Visits & History</h2>
            </div>
            {upcomingAppointments.length === 0 ? (
              <p className="text-sm text-slate-600">No upcoming visits scheduled.</p>
            ) : (
              <div className="divide-y divide-slate-200">
                {upcomingAppointments.map((appt) => (
                  <div key={appt.id} className="py-3 first:pt-0 last:pb-0 space-y-0.5">
                    <p className="text-sm font-bold text-slate-900">{appt.doctorName}</p>
                    <p className="text-xs text-teal-800 font-medium">
                      {appt.specialty} · {appt.clinicName}
                    </p>
                    <p className="text-xs text-slate-600 tabular-nums">
                      {appt.appointmentDate} at {formatTime12h(appt.appointmentTime)}
                    </p>
                  </div>
                ))}
              </div>
            )}

            {pastAppointments.length > 0 && (
              <div className="pt-3 border-t border-slate-200 space-y-2.5">
                <h3 className="text-xs font-bold uppercase tracking-wide text-slate-500">
                  Recent Visit History ({pastAppointments.length})
                </h3>
                <div className="divide-y divide-slate-100 max-h-44 overflow-y-auto">
                  {pastAppointments.slice(0, 5).map((appt) => (
                    <div key={appt.id} className="py-2 first:pt-0 last:pb-0 space-y-0.5">
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-xs font-bold text-slate-800 truncate">
                          {appt.doctorName}
                        </p>
                        <span className="text-[11px] font-semibold capitalize text-slate-600 shrink-0">
                          {appt.status}
                        </span>
                      </div>
                      <p className="text-[11px] text-slate-600 tabular-nums">
                        {appt.appointmentDate} · {appt.specialty}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </section>

      {/* 30-Day Adherence Calendar */}
      <AdherenceCalendar doseLogs={doseLogs} />

      {/* Gemini AI Health Routine Assistant */}
      <section className="bg-white rounded-3xl border border-slate-200 p-6 space-y-5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <Sparkles className="w-5 h-5 text-teal-700" aria-hidden="true" />
            <div>
              <h2 className="text-lg font-bold text-slate-900">
                AI Health Routine Assistant (Gemini)
              </h2>
              <p className="text-sm text-slate-600">
                Builds a personalized daily routine around {circle.elderName}’s active medications
                and appointments.
              </p>
            </div>
          </div>
        </div>

        {!aiStatusLoading && aiStatus && !aiStatus.geminiConfigured && (
          <div className="p-4 rounded-2xl border border-amber-200 bg-amber-50 text-amber-950 text-sm space-y-1.5">
            <div className="flex items-center gap-2 font-bold">
              <Info className="w-4 h-4 shrink-0 text-amber-800" aria-hidden="true" />
              <span>AI Assistant — Configuration Pending</span>
            </div>
            <p className="text-xs leading-relaxed text-amber-900">
              {aiStatus.instructions}
            </p>
          </div>
        )}

        <form onSubmit={handleGenerateRoutine} className="space-y-4">
          <div className="flex flex-wrap gap-2">
            {FOCUS_PRESETS.map((preset) => (
              <button
                key={preset}
                type="button"
                onClick={() => setAiFocus(preset)}
                className={`min-h-[40px] px-3.5 py-1.5 rounded-xl text-xs font-semibold border transition-colors ${
                  aiFocus === preset
                    ? 'bg-slate-900 text-white border-slate-900'
                    : 'bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100'
                }`}
              >
                {preset}
              </button>
            ))}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-semibold text-slate-800 mb-1">
                Routine Focus
              </label>
              <input
                type="text"
                required
                maxLength={200}
                value={aiFocus}
                onChange={(e) => setAiFocus(e.target.value)}
                className="w-full min-h-[46px] px-3.5 rounded-xl border border-slate-300 text-sm"
              />
            </div>
            <div>
              <label className="block text-sm font-semibold text-slate-800 mb-1">
                Specific Care Question (Optional)
              </label>
              <input
                type="text"
                maxLength={200}
                value={aiQuestion}
                onChange={(e) => setAiQuestion(e.target.value)}
                placeholder="e.g., Best hydration reminders around morning doses?"
                className="w-full min-h-[46px] px-3.5 rounded-xl border border-slate-300 text-sm"
              />
            </div>
          </div>

          <button
            type="submit"
            disabled={
              aiGenerating || (!aiStatusLoading && aiStatus !== null && !aiStatus.geminiConfigured)
            }
            className="min-h-[48px] px-6 rounded-2xl bg-teal-700 text-white font-semibold text-sm flex items-center gap-2 hover:bg-teal-800 disabled:opacity-50"
          >
            <Sparkles className="w-4 h-4" aria-hidden="true" />
            <span>
              {aiGenerating
                ? 'Generating Routine with Gemini...'
                : !aiStatusLoading && aiStatus && !aiStatus.geminiConfigured
                ? 'AI Generation Pending Configuration'
                : 'Generate Daily Routine'}
            </span>
          </button>
        </form>

        {aiResult && (
          <div className="rounded-2xl border border-teal-200 bg-teal-50/50 p-5 space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <p className="text-base font-bold text-slate-900">{aiResult.summary}</p>
              <button
                type="button"
                disabled={savingRoutine}
                onClick={handleSaveRoutine}
                className="min-h-[44px] px-4 rounded-xl bg-slate-900 text-white text-sm font-semibold flex items-center gap-2 hover:bg-slate-800 whitespace-nowrap shrink-0"
              >
                <BookmarkCheck className="w-4 h-4" aria-hidden="true" />
                <span>{savingRoutine ? 'Saving...' : 'Save to Care Circle'}</span>
              </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm">
              <div className="bg-white rounded-2xl border border-slate-200 p-4 space-y-1">
                <p className="font-bold text-slate-900">Morning Routine</p>
                <p className="text-slate-700 leading-relaxed">{aiResult.morningPlan}</p>
              </div>
              <div className="bg-white rounded-2xl border border-slate-200 p-4 space-y-1">
                <p className="font-bold text-slate-900">Afternoon Routine</p>
                <p className="text-slate-700 leading-relaxed">{aiResult.afternoonPlan}</p>
              </div>
              <div className="bg-white rounded-2xl border border-slate-200 p-4 space-y-1">
                <p className="font-bold text-slate-900">Evening Routine</p>
                <p className="text-slate-700 leading-relaxed">{aiResult.eveningPlan}</p>
              </div>
            </div>

            <div className="bg-white rounded-2xl border border-slate-200 p-4 text-sm space-y-2">
              <p className="text-slate-900">
                <strong>Guidance:</strong> {aiResult.answerToQuestion}
              </p>
              <p className="text-teal-900">
                <strong>Safety Tip:</strong> {aiResult.safetyTip}
              </p>
              <p className="text-xs text-slate-500">{aiResult.disclaimer}</p>
            </div>
          </div>
        )}

        {aiRoutines.length > 0 && (
          <div className="space-y-3 pt-2 border-t border-slate-200">
            <h3 className="text-sm font-bold text-slate-800">Saved Care Routines</h3>
            <div className="divide-y divide-slate-200">
              {aiRoutines.map((routine) => (
                <div
                  key={routine.id}
                  className="py-3 flex flex-col sm:flex-row sm:items-start justify-between gap-3"
                >
                  <div className="space-y-1 text-sm">
                    <p className="font-bold text-slate-900">{routine.promptFocus}</p>
                    <p className="text-slate-700">{routine.summary}</p>
                    <p className="text-xs text-teal-800 font-medium">
                      Safety Tip: {routine.safetyTip}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => onDeleteAiRoutine(routine.id)}
                    aria-label="Delete saved routine"
                    className="min-h-[44px] min-w-[44px] rounded-xl border border-slate-300 text-rose-700 hover:bg-rose-50 flex items-center justify-center shrink-0"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}
      </section>

      {/* Multi-Member Care Circle Team & Access Invites */}
      <section className="bg-white rounded-3xl border border-slate-200 p-6 space-y-5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-start gap-3">
            <Users className="w-6 h-6 text-teal-700 shrink-0 mt-0.5" aria-hidden="true" />
            <div>
              <h2 className="text-lg font-bold text-slate-900">
                Care Circle Team &amp; Role-Based Access
              </h2>
              <p className="text-sm text-slate-600 mt-0.5">
                {isOwner
                  ? `Share ${circle.elderName}’s Care Circle with separate Google accounts (max 10 members). Invited accounts are locked to their assigned role in Firestore rules.`
                  : `You have joined ${circle.elderName}’s shared Care Circle. Only the Care Circle owner can invite or modify member roles.`}
              </p>
            </div>
          </div>

          {isOwner && (
            <button
              type="button"
              disabled={syncingMembers}
              onClick={onSyncMembersNow}
              className="min-h-[44px] px-4 rounded-xl border border-slate-300 bg-white text-slate-800 text-xs sm:text-sm font-semibold flex items-center gap-2 hover:bg-slate-50 disabled:opacity-50 whitespace-nowrap shrink-0"
            >
              <RefreshCw
                className={`w-4 h-4 text-teal-700 ${syncingMembers ? 'animate-spin' : ''}`}
                aria-hidden="true"
              />
              <span>{syncingMembers ? 'Syncing Records...' : 'Sync Shared Records'}</span>
            </button>
          )}
        </div>

        {isOwner ? (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 pt-2">
            {/* Invite Generator */}
            <div className="space-y-4">
              <form
                onSubmit={handleGenerateInvite}
                className="p-4 rounded-2xl bg-slate-50 border border-slate-200 space-y-4"
              >
                <div className="flex items-center gap-2">
                  <UserPlus className="w-4 h-4 text-teal-700" aria-hidden="true" />
                  <h3 className="text-sm font-bold text-slate-900">
                    Create Single-Use Invite Code
                  </h3>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">
                      Assigned Role
                    </label>
                    <select
                      value={inviteRole}
                      onChange={(e) => setInviteRole(e.target.value as DashboardRole)}
                      className="w-full min-h-[44px] px-3 rounded-xl border border-slate-300 bg-white text-sm font-medium text-slate-900"
                    >
                      <option value="caretaker">Caretaker (Full Schedule &amp; Alerts)</option>
                      <option value="family">Family (Analytics, AI &amp; Alerts)</option>
                      <option value="elderly">Elderly Resident (Dose Check-off &amp; SOS)</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">
                      Lock to Google Email (Optional)
                    </label>
                    <input
                      type="email"
                      maxLength={160}
                      value={inviteEmail}
                      onChange={(e) => setInviteEmail(e.target.value)}
                      placeholder="anyone with code if blank"
                      className="w-full min-h-[44px] px-3 rounded-xl border border-slate-300 bg-white text-sm"
                    />
                  </div>
                </div>

                <button
                  type="submit"
                  disabled={creatingInvite || members.length >= 10}
                  className="min-h-[44px] px-5 rounded-xl bg-teal-700 text-white text-sm font-semibold hover:bg-teal-800 disabled:opacity-50 flex items-center gap-2"
                >
                  <KeyRound className="w-4 h-4" aria-hidden="true" />
                  <span>
                    {members.length >= 10
                      ? 'Member Limit Reached (10 Max)'
                      : creatingInvite
                      ? 'Generating Code...'
                      : 'Generate Invite Code'}
                  </span>
                </button>
              </form>

              {/* Invite Codes List */}
              <div className="space-y-2">
                <h3 className="text-xs font-bold uppercase tracking-wide text-slate-500">
                  Generated Invites ({invites.length})
                </h3>
                {invites.length === 0 ? (
                  <p className="text-sm text-slate-600">
                    No invite codes generated yet. Create one above to invite another Google account.
                  </p>
                ) : (
                  <div className="divide-y divide-slate-200 max-h-60 overflow-y-auto border border-slate-200 rounded-2xl px-4">
                    {invites.map((inv) => (
                      <div
                        key={inv.inviteCode}
                        className="py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2"
                      >
                        <div className="min-w-0 space-y-0.5">
                          <div className="flex items-center gap-2 flex-wrap">
                            <code className="text-xs font-mono font-bold text-slate-900 bg-slate-100 px-2 py-0.5 rounded">
                              {inv.inviteCode}
                            </code>
                            <span className="text-xs font-semibold capitalize text-teal-800">
                              {inv.invitedRole}
                            </span>
                            <span
                              className={`text-xs font-semibold capitalize ${
                                inv.status === 'pending'
                                  ? 'text-amber-800'
                                  : inv.status === 'accepted'
                                  ? 'text-emerald-800'
                                  : 'text-slate-500'
                              }`}
                            >
                              · {inv.status}
                            </span>
                          </div>
                          <p className="text-xs text-slate-600 truncate">
                            {inv.status === 'accepted' && inv.acceptedByEmail
                              ? `Accepted by ${inv.acceptedByEmail}`
                              : inv.invitedEmail
                              ? `Restricted to ${inv.invitedEmail}`
                              : 'Usable once by any verified Google account'}
                          </p>
                        </div>

                        {inv.status === 'pending' && (
                          <div className="flex flex-wrap items-center gap-2 shrink-0">
                            <button
                              type="button"
                              onClick={() => handleCopyCode(inv.inviteCode)}
                              className="min-h-[38px] px-3 rounded-lg border border-slate-300 bg-white text-slate-800 text-xs font-semibold flex items-center gap-1.5 hover:bg-slate-50"
                            >
                              {copiedCode === inv.inviteCode ? (
                                <Check className="w-3.5 h-3.5 text-emerald-700" />
                              ) : (
                                <Copy className="w-3.5 h-3.5" />
                              )}
                              <span>{copiedCode === inv.inviteCode ? 'Copied' : 'Copy Code'}</span>
                            </button>
                            <button
                              type="button"
                              onClick={() => handleCopyInviteLink(inv.inviteCode)}
                              className="min-h-[38px] px-3 rounded-lg border border-teal-200 bg-teal-50 text-teal-900 text-xs font-semibold flex items-center gap-1.5 hover:bg-teal-100"
                            >
                              {copiedCode === `link_${inv.inviteCode}` ? (
                                <Check className="w-3.5 h-3.5 text-emerald-700" />
                              ) : (
                                <Copy className="w-3.5 h-3.5" />
                              )}
                              <span>
                                {copiedCode === `link_${inv.inviteCode}` ? 'Link Copied' : 'Copy Link'}
                              </span>
                            </button>
                            <button
                              type="button"
                              onClick={() => onRevokeInvite(inv.inviteCode)}
                              aria-label={`Revoke invite ${inv.inviteCode}`}
                              className="min-h-[38px] px-3 rounded-lg border border-rose-200 text-rose-700 text-xs font-semibold flex items-center gap-1 hover:bg-rose-50"
                            >
                              <XCircle className="w-3.5 h-3.5" />
                              <span>Revoke</span>
                            </button>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* Active Members Roster */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-bold uppercase tracking-wide text-slate-500">
                  Active Care Circle Members ({members.length}/10)
                </h3>
              </div>

              {members.length === 0 ? (
                <p className="text-sm text-slate-600">Loading member roster...</p>
              ) : (
                <div className="divide-y divide-slate-200 border border-slate-200 rounded-2xl px-4">
                  {members.map((member) => {
                    const isSelfOwner = member.uid === circle.ownerId || member.uid === currentUserUid;
                    return (
                      <div
                        key={member.uid}
                        className="py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                      >
                        <div className="min-w-0">
                          <p className="text-sm font-bold text-slate-900 truncate">
                            {member.displayName}
                            {isSelfOwner ? ' (Owner · All Views)' : ''}
                          </p>
                          <p className="text-xs text-slate-500 font-mono truncate">
                            UID: {member.uid.slice(0, 12)}…
                          </p>
                        </div>

                        {isSelfOwner ? (
                          <span className="text-xs font-semibold text-teal-800 shrink-0">
                            Circle Admin
                          </span>
                        ) : (
                          <div className="flex items-center gap-2 shrink-0">
                            <select
                              aria-label={`Role for ${member.displayName}`}
                              disabled={memberBusyUid === member.uid}
                              value={member.role}
                              onChange={(e) =>
                                handleRoleUpdate(member.uid, e.target.value as DashboardRole)
                              }
                              className="min-h-[38px] px-2.5 rounded-lg border border-slate-300 bg-white text-xs font-semibold text-slate-800"
                            >
                              <option value="caretaker">Caretaker</option>
                              <option value="family">Family</option>
                              <option value="elderly">Elderly</option>
                            </select>
                            <button
                              type="button"
                              disabled={memberBusyUid === member.uid}
                              onClick={() => handleRemoveMember(member.uid)}
                              aria-label={`Remove ${member.displayName}`}
                              className="min-h-[38px] min-w-[38px] rounded-lg border border-slate-300 text-rose-700 hover:bg-rose-50 flex items-center justify-center"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}

              <div className="p-3.5 rounded-2xl bg-slate-50 border border-slate-200 text-xs text-slate-600 space-y-1">
                <p className="font-semibold text-slate-800">Role Permissions Enforced in Firestore</p>
                <p>• Caretaker: Add/edit medications, appointments, log doses, acknowledge alerts.</p>
                <p>• Family: View adherence analytics, export PDFs, AI routines, SOS triage &amp; alerts.</p>
                <p>• Elderly: Simple Today view, tap “I Took This Medicine”, and trigger Demo SOS.</p>
              </div>
            </div>
          </div>
        ) : (
          <div className="p-4 rounded-2xl bg-slate-50 border border-slate-200 text-sm text-slate-700">
            You are viewing {circle.elderName}’s Care Circle with the <strong>Family</strong> role.
            Medication definitions and appointment schedules are read-only in this role; Caretaker or
            Owner accounts manage schedule changes.
          </div>
        )}
      </section>

      {/* Email Notification Setup & Emergency Contact Settings */}
      <section className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Email Notification Setup */}
        <div className="bg-white rounded-3xl border border-slate-200 p-6 space-y-5">
          <div className="flex items-center gap-2.5">
            <Mail className="w-5 h-5 text-teal-700" aria-hidden="true" />
            <div>
              <h2 className="text-lg font-bold text-slate-900">Email Notification Setup</h2>
              <p className="text-sm text-slate-600">
                Automated alerts trigger once per event for Demo SOS, overdue/missed doses, and
                24-hour appointment reminders.
              </p>
            </div>
          </div>

          <div
            className={`p-4 rounded-2xl border text-sm space-y-1 ${
              smtpStatus?.smtpConfigured
                ? 'bg-emerald-50 border-emerald-200 text-emerald-950'
                : 'bg-amber-50 border-amber-200 text-amber-950'
            }`}
          >
            <div className="flex items-center gap-2 font-bold">
              <ShieldCheck className="w-4 h-4 shrink-0" aria-hidden="true" />
              <span>
                {smtpLoading
                  ? 'Checking server SMTP configuration...'
                  : smtpStatus?.smtpConfigured
                  ? 'Live SMTP Transport Active'
                  : 'SMTP Configuration Required for Live Email Delivery'}
              </span>
            </div>
            <p className="text-xs leading-relaxed">
              {smtpStatus?.instructions ||
                'Checking server environment variables for SMTP_HOST, SMTP_USER, and SMTP_PASS.'}
            </p>
          </div>

          <form onSubmit={handleSaveSettings} className="space-y-4">
            <div>
              <label className="block text-sm font-semibold text-slate-800 mb-1">
                Alert Recipient Email
              </label>
              <input
                type="email"
                required
                maxLength={160}
                value={emailInput}
                onChange={(e) => setEmailInput(e.target.value)}
                placeholder="family@example.com"
                className="w-full min-h-[46px] px-3.5 rounded-xl border border-slate-300 text-sm"
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 items-center">
              <div>
                <label className="block text-sm font-semibold text-slate-800 mb-1">
                  Missed-Dose Alert Delay (Minutes)
                </label>
                <input
                  type="number"
                  min={5}
                  max={240}
                  value={thresholdMins}
                  onChange={(e) => setThresholdMins(Number(e.target.value) || 30)}
                  className="w-full min-h-[46px] px-3.5 rounded-xl border border-slate-300 text-sm"
                />
              </div>

              <label className="flex items-center gap-2.5 pt-5 text-sm font-medium text-slate-800 cursor-pointer">
                <input
                  type="checkbox"
                  checked={alertsEnabled}
                  onChange={(e) => setAlertsEnabled(e.target.checked)}
                  className="w-5 h-5 rounded border-slate-300 text-teal-700"
                />
                <span>Enable email alerts</span>
              </label>
            </div>

            <div className="flex flex-wrap gap-3">
              <button
                type="submit"
                disabled={savingEmail}
                className="min-h-[46px] px-5 rounded-xl bg-slate-900 text-white text-sm font-semibold hover:bg-slate-800 disabled:opacity-50"
              >
                {savingEmail ? 'Saving...' : 'Save Alert Preferences'}
              </button>
              <button
                type="button"
                disabled={testingEmail || !emailInput.trim()}
                onClick={handleTestEmail}
                className="min-h-[46px] px-5 rounded-xl border border-slate-300 bg-white text-slate-900 text-sm font-semibold flex items-center gap-2 hover:bg-slate-50 disabled:opacity-50"
              >
                <Send className="w-4 h-4 text-teal-700" aria-hidden="true" />
                <span>{testingEmail ? 'Testing...' : 'Test Email Delivery'}</span>
              </button>
            </div>
          </form>

          {notificationLogs.length > 0 && (
            <div className="space-y-2 pt-3 border-t border-slate-200">
              <div className="flex items-center justify-between gap-2">
                <h3 className="text-sm font-bold text-slate-800 flex items-center gap-2">
                  <BellRing className="w-4 h-4 text-slate-600" aria-hidden="true" />
                  <span>Notification Audit Log</span>
                </h3>
                <span className="text-xs text-slate-500 tabular-nums">
                  {notificationLogs.length} recorded
                </span>
              </div>
              <div className="divide-y divide-slate-200 max-h-60 overflow-y-auto">
                {notificationLogs.slice(0, 15).map((log) => {
                  const eventLabel =
                    log.eventType === 'sos_demo'
                      ? 'SOS Demo'
                      : log.eventType === 'missed_dose'
                      ? 'Missed Dose'
                      : log.eventType === 'appointment_reminder'
                      ? 'Appointment'
                      : 'Setup Test';
                  return (
                    <div key={log.id} className="py-2.5 text-xs space-y-0.5">
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2 min-w-0">
                          <span className="font-bold text-teal-900 bg-teal-50 border border-teal-200 px-1.5 py-0.5 rounded shrink-0">
                            {eventLabel}
                          </span>
                          <span className="font-semibold text-slate-900 truncate">
                            {log.subject}
                          </span>
                        </div>
                        <span
                          className={`font-semibold shrink-0 ${
                            log.deliveryStatus === 'smtp_sent'
                              ? 'text-emerald-800'
                              : log.deliveryStatus === 'failed'
                              ? 'text-rose-700'
                              : 'text-amber-800'
                          }`}
                        >
                          {log.deliveryStatus === 'smtp_sent'
                            ? 'SMTP Sent'
                            : log.deliveryStatus === 'failed'
                            ? 'Failed'
                            : 'Logged (SMTP not configured)'}
                        </span>
                      </div>
                      <p className="text-slate-600">
                        To: {log.recipientEmail} · {log.detail}
                      </p>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        {/* Care Circle Emergency Contact Settings */}
        <div className="bg-white rounded-3xl border border-slate-200 p-6 space-y-5">
          <div className="flex items-center gap-2.5">
            <CheckCircle2 className="w-5 h-5 text-teal-700" aria-hidden="true" />
            <div>
              <h2 className="text-lg font-bold text-slate-900">
                Primary Emergency Contact & Circle Profile
              </h2>
              <p className="text-sm text-slate-600">
                Shown on {circle.elderName}’s SOS confirmation screen and Elderly dashboard.
              </p>
            </div>
          </div>

          <form onSubmit={handleSaveContact} className="space-y-4">
            <div>
              <label className="block text-sm font-semibold text-slate-800 mb-1">
                {circle.elderName}’s Phone Number (for Quick Call)
              </label>
              <input
                type="tel"
                maxLength={32}
                value={elderPhoneInput}
                onChange={(e) => setElderPhoneInput(e.target.value)}
                placeholder="+1 (555) 890-4123"
                className="w-full min-h-[46px] px-3.5 rounded-xl border border-slate-300 text-sm font-mono"
              />
            </div>

            <div>
              <label className="block text-sm font-semibold text-slate-800 mb-1">
                Emergency Contact Name
              </label>
              <input
                type="text"
                required
                maxLength={100}
                value={contactName}
                onChange={(e) => setContactName(e.target.value)}
                className="w-full min-h-[46px] px-3.5 rounded-xl border border-slate-300 text-sm"
              />
            </div>

            <div>
              <label className="block text-sm font-semibold text-slate-800 mb-1">
                Emergency Contact Phone
              </label>
              <input
                type="text"
                required
                maxLength={32}
                value={contactPhone}
                onChange={(e) => setContactPhone(e.target.value)}
                className="w-full min-h-[46px] px-3.5 rounded-xl border border-slate-300 text-sm font-mono"
              />
            </div>

            <button
              type="submit"
              disabled={savingContact}
              className="min-h-[46px] px-5 rounded-xl bg-teal-700 text-white text-sm font-semibold hover:bg-teal-800 disabled:opacity-50"
            >
              {savingContact ? 'Updating...' : 'Update CareCircle Contacts'}
            </button>
          </form>

          <div className="p-4 rounded-2xl bg-slate-50 border border-slate-200 text-xs text-slate-600 space-y-1.5 leading-relaxed">
            <p className="font-bold text-slate-800">Honesty & Safety Guarantees</p>
            <p>
              • Emergency SOS triggers require two-step demo confirmation and log alerts in real
              time to Caretaker and Family dashboards without claiming real 911 dispatch.
            </p>
            <p>
              • Email notifications use real Nodemailer SMTP when configured in server Secrets, and
              explicitly report unconfigured status when credentials are absent.
            </p>
          </div>
        </div>
      </section>
    </div>
  );
}
