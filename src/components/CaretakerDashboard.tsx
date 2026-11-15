import { useState } from 'react';
import {
  BellRing,
  AlertOctagon,
  AlertTriangle,
  CalendarPlus,
  Check,
  Edit3,
  Package,
  PhoneCall,
  Pill,
  Plus,
  Trash2,
  X,
} from 'lucide-react';
import { AvatarImg } from './AvatarImg';
import {
  buildTodaySchedule,
  formatSlotLabel,
  formatTime12h,
  getLocalDateString,
  isDoseTakenLate,
} from '../lib/analytics';
import { buildAlertDedupId, type AppointmentInput, type MedicationInput } from '../lib/careService';
import type {
  Appointment,
  CareCircle,
  DoseLog,
  DoseStatus,
  Medication,
  NotificationLog,
  SosEvent,
  TimeSlot,
} from '../types';

interface CaretakerDashboardProps {
  circle: CareCircle;
  medications: Medication[];
  doseLogs: DoseLog[];
  appointments: Appointment[];
  sosEvents: SosEvent[];
  notificationLogs: NotificationLog[];
  busyId: string | null;
  onCreateMedication: (input: MedicationInput) => Promise<boolean>;
  onUpdateMedication: (medId: string, input: Partial<MedicationInput>) => Promise<boolean>;
  onDeleteMedication: (medId: string) => Promise<void>;
  onRecordDose: (
    med: Medication,
    status: DoseStatus,
    existingLog: DoseLog | null,
    note?: string
  ) => Promise<void>;
  onAcknowledgeDoseAlert: (logId: string) => Promise<void>;
  onCreateAppointment: (input: AppointmentInput) => Promise<boolean>;
  onUpdateAppointmentDetails: (apptId: string, input: AppointmentInput) => Promise<boolean>;
  onUpdateAppointmentStatus: (
    apptId: string,
    status: 'completed' | 'cancelled'
  ) => Promise<void>;
  onDeleteAppointment: (apptId: string) => Promise<void>;
  onSendAppointmentReminder: (appt: Appointment) => Promise<void>;
  onUpdateSosStatus: (sosId: string, status: 'acknowledged' | 'resolved') => Promise<void>;
}

const DEFAULT_MED_FORM: MedicationInput = {
  name: '',
  dosage: '',
  scheduleTime: '09:00',
  timeSlot: 'morning',
  withFood: true,
  instructions: '',
  stockCount: 30,
  active: true,
};

const DEFAULT_APPT_FORM: AppointmentInput = {
  doctorName: '',
  specialty: '',
  clinicName: '',
  appointmentDate: getLocalDateString(),
  appointmentTime: '10:00',
  purpose: '',
  notes: '',
};

export function CaretakerDashboard({
  circle,
  medications,
  doseLogs,
  appointments,
  sosEvents,
  notificationLogs,
  busyId,
  onCreateMedication,
  onUpdateMedication,
  onDeleteMedication,
  onRecordDose,
  onAcknowledgeDoseAlert,
  onCreateAppointment,
  onUpdateAppointmentDetails,
  onUpdateAppointmentStatus,
  onDeleteAppointment,
  onSendAppointmentReminder,
  onUpdateSosStatus,
}: CaretakerDashboardProps) {
  const [medModalOpen, setMedModalOpen] = useState(false);
  const [editingMed, setEditingMed] = useState<Medication | null>(null);
  const [medForm, setMedForm] = useState<MedicationInput>(DEFAULT_MED_FORM);
  const [medError, setMedError] = useState<string | null>(null);

  const [apptModalOpen, setApptModalOpen] = useState(false);
  const [editingAppt, setEditingAppt] = useState<Appointment | null>(null);
  const [apptForm, setApptForm] = useState<AppointmentInput>(DEFAULT_APPT_FORM);
  const [apptError, setApptError] = useState<string | null>(null);

  const [apptFilter, setApptFilter] = useState<'all' | 'upcoming' | 'completed' | 'cancelled'>('all');

  const todaySchedule = buildTodaySchedule(
    medications,
    doseLogs,
    circle.missedDoseThresholdMinutes
  );

  const todayOverdue = todaySchedule.filter((item) => item.effectiveStatus === 'overdue');
  const unackMissedLogs = doseLogs.filter(
    (l) => l.status === 'missed' && !l.alertAcknowledged
  );
  const activeSosList = sosEvents.filter((s) => s.status !== 'resolved');

  const filteredAppointments = appointments.filter((a) =>
    apptFilter === 'all' ? true : a.status === apptFilter
  );

  const openNewMed = () => {
    setEditingMed(null);
    setMedForm(DEFAULT_MED_FORM);
    setMedError(null);
    setMedModalOpen(true);
  };

  const openEditMed = (med: Medication) => {
    setEditingMed(med);
    setMedForm({
      name: med.name,
      dosage: med.dosage,
      scheduleTime: med.scheduleTime,
      timeSlot: med.timeSlot,
      withFood: med.withFood,
      instructions: med.instructions || '',
      stockCount: med.stockCount,
      active: med.active,
    });
    setMedError(null);
    setMedModalOpen(true);
  };

  const handleSaveMed = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!medForm.name.trim() || !medForm.dosage.trim()) {
      setMedError('Medication name and dosage are required.');
      return;
    }
    if (!/^([01][0-9]|2[0-3]):[0-5][0-9]$/.test(medForm.scheduleTime)) {
      setMedError('Schedule time must be in HH:MM format.');
      return;
    }
    setMedError(null);
    const saved = editingMed
      ? await onUpdateMedication(editingMed.id, medForm)
      : await onCreateMedication(medForm);
    if (saved) {
      setMedModalOpen(false);
    }
  };

  const openNewAppt = () => {
    setEditingAppt(null);
    setApptForm(DEFAULT_APPT_FORM);
    setApptError(null);
    setApptModalOpen(true);
  };

  const openEditAppt = (appt: Appointment) => {
    setEditingAppt(appt);
    setApptForm({
      doctorName: appt.doctorName,
      specialty: appt.specialty,
      clinicName: appt.clinicName,
      appointmentDate: appt.appointmentDate,
      appointmentTime: appt.appointmentTime,
      purpose: appt.purpose,
      notes: appt.notes || '',
    });
    setApptError(null);
    setApptModalOpen(true);
  };

  const handleSaveAppt = async (e: React.FormEvent) => {
    e.preventDefault();
    if (
      !apptForm.doctorName.trim() ||
      !apptForm.specialty.trim() ||
      !apptForm.clinicName.trim() ||
      !apptForm.purpose.trim()
    ) {
      setApptError('Doctor name, specialty, clinic, and purpose are required.');
      return;
    }
    if (!/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(apptForm.appointmentDate)) {
      setApptError('Appointment date must be in YYYY-MM-DD format.');
      return;
    }
    if (!/^([01][0-9]|2[0-3]):[0-5][0-9]$/.test(apptForm.appointmentTime)) {
      setApptError('Appointment time must be in 24-hour HH:MM format.');
      return;
    }
    setApptError(null);
    const saved = editingAppt
      ? await onUpdateAppointmentDetails(editingAppt.id, apptForm)
      : await onCreateAppointment(apptForm);
    if (saved) {
      setApptModalOpen(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Caretaker Context Header */}
      <section className="bg-white rounded-3xl border border-slate-200 p-6 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <AvatarImg
            src="/src/assets/images/caretaker_avatar_1794717419943.jpg"
            alt="Caretaker portrait"
            fallbackInitials="CT"
            className="w-16 h-16"
          />
          <div>
            <p className="text-sm font-medium text-slate-500">
              Caretaker Operations · Resident: {circle.elderName} (Age {circle.elderAge})
            </p>
            <h1 className="text-2xl font-bold text-slate-900 mt-0.5">
              Medication Schedule & Care Triage
            </h1>
            <p className="text-sm text-slate-600 mt-0.5">
              Blood Type {circle.bloodType || 'N/A'} · Allergies:{' '}
              {circle.allergies || 'None recorded'}
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3">
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
          <button
            type="button"
            onClick={openNewMed}
            className="min-h-[48px] px-5 rounded-2xl bg-teal-700 text-white font-semibold text-sm flex items-center gap-2 hover:bg-teal-800 whitespace-nowrap shrink-0"
          >
            <Plus className="w-4 h-4" aria-hidden="true" />
            <span>Add Medication</span>
          </button>
          <button
            type="button"
            onClick={openNewAppt}
            className="min-h-[48px] px-5 rounded-2xl border border-slate-300 bg-white text-slate-900 font-semibold text-sm flex items-center gap-2 hover:bg-slate-50 whitespace-nowrap shrink-0"
          >
            <CalendarPlus className="w-4 h-4 text-teal-700" aria-hidden="true" />
            <span>Add Appointment</span>
          </button>
        </div>
      </section>

      {/* Active Demo SOS Events */}
      {activeSosList.length > 0 && (
        <section className="space-y-3" aria-label="Active demo SOS alerts">
          {activeSosList.map((sos) => (
            <div
              key={sos.id}
              role="alert"
              className="bg-rose-50 border border-rose-300 rounded-3xl p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4"
            >
              <div className="flex items-start gap-3">
                <AlertOctagon className="w-7 h-7 text-rose-700 shrink-0 mt-0.5" aria-hidden="true" />
                <div>
                  <p className="text-base font-bold text-rose-950">
                    Demo SOS Alert ({sos.status === 'acknowledged' ? 'Acknowledged' : 'Active'}) ·{' '}
                    Triggered by {sos.triggeredByName}
                  </p>
                  <p className="text-sm text-rose-900 mt-1">
                    {sos.note || 'Assistance requested in demo mode.'}
                  </p>
                  <p className="text-xs text-rose-800 mt-1">
                    Demo only — no real emergency dispatch was triggered.
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2 shrink-0">
                {sos.status === 'active_demo' && (
                  <button
                    type="button"
                    disabled={busyId === sos.id}
                    onClick={() => onUpdateSosStatus(sos.id, 'acknowledged')}
                    className="min-h-[44px] px-4 rounded-xl bg-white border border-rose-300 text-rose-900 font-semibold text-sm hover:bg-rose-100 whitespace-nowrap"
                  >
                    Acknowledge
                  </button>
                )}
                <button
                  type="button"
                  disabled={busyId === sos.id}
                  onClick={() => onUpdateSosStatus(sos.id, 'resolved')}
                  className="min-h-[44px] px-4 rounded-xl bg-rose-700 text-white font-semibold text-sm hover:bg-rose-800 whitespace-nowrap"
                >
                  Resolve Alert
                </button>
              </div>
            </div>
          ))}
        </section>
      )}

      {/* Missed Medication Alerts */}
      <section className="bg-white rounded-3xl border border-slate-200 p-6 space-y-4">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-2.5">
            <AlertTriangle className="w-5 h-5 text-amber-700 shrink-0" aria-hidden="true" />
            <h2 className="text-lg font-bold text-slate-900">Missed Medication Alerts</h2>
          </div>
          <span className="text-sm font-medium text-slate-600 tabular-nums">
            {todayOverdue.length + unackMissedLogs.length} active
          </span>
        </div>

        {todayOverdue.length === 0 && unackMissedLogs.length === 0 ? (
          <p className="text-sm text-slate-600 py-2">
            All scheduled doses are on track with no unacknowledged missed alerts.
          </p>
        ) : (
          <div className="divide-y divide-slate-200">
            {todayOverdue.map(({ medication, todayLog, minutesDelta }) => {
              const alertLogId = buildAlertDedupId('missed_dose', medication.id, getLocalDateString());
              const alertLog = notificationLogs.find((l) => l.id === alertLogId);
              return (
                <div
                  key={`overdue_${medication.id}`}
                  className="py-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4"
                >
                  <div>
                    <p className="text-base font-bold text-slate-900">
                      {medication.name} · {medication.dosage}
                    </p>
                    <p className="text-sm text-amber-800 font-medium tabular-nums mt-0.5">
                      Overdue today · Scheduled {formatTime12h(medication.scheduleTime)} ({minutesDelta}m
                      past threshold)
                    </p>
                    {alertLog && (
                      <p className="text-xs text-slate-600 mt-1 flex items-center gap-1.5">
                        <BellRing className="w-3.5 h-3.5 text-teal-700 shrink-0" aria-hidden="true" />
                        <span>
                          {alertLog.deliveryStatus === 'smtp_sent'
                            ? `Alert email sent to ${alertLog.recipientEmail}`
                            : alertLog.deliveryStatus === 'failed'
                            ? `Alert dispatch failed (${alertLog.recipientEmail})`
                            : `Alert logged for ${alertLog.recipientEmail} (SMTP unconfigured)`}
                        </span>
                      </p>
                    )}
                  </div>
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    disabled={busyId === medication.id}
                    onClick={() => onRecordDose(medication, 'taken', todayLog, 'Marked taken late by caretaker')}
                    className="min-h-[44px] px-4 rounded-xl bg-teal-700 text-white font-semibold text-sm hover:bg-teal-800 whitespace-nowrap"
                  >
                    Mark Taken Late
                  </button>
                  <button
                    type="button"
                    disabled={busyId === medication.id}
                    onClick={() => onRecordDose(medication, 'missed', todayLog, 'Confirmed missed by caretaker')}
                    className="min-h-[44px] px-4 rounded-xl border border-amber-300 bg-amber-50 text-amber-950 font-semibold text-sm hover:bg-amber-100 whitespace-nowrap"
                  >
                    Log as Missed
                  </button>
                </div>
                </div>
              );
            })}

            {unackMissedLogs.map((log) => (
              <div
                key={log.id}
                className="py-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4"
              >
                <div>
                  <p className="text-base font-bold text-slate-900">
                    {log.medicationName} · {log.dosage}
                  </p>
                  <p className="text-sm text-rose-800 font-medium tabular-nums mt-0.5">
                    Missed on {log.scheduledDate} at {formatTime12h(log.scheduledTime)}
                  </p>
                </div>
                <button
                  type="button"
                  disabled={busyId === log.id}
                  onClick={() => onAcknowledgeDoseAlert(log.id)}
                  className="min-h-[44px] px-4 rounded-xl border border-slate-300 bg-white text-slate-800 font-semibold text-sm hover:bg-slate-50 whitespace-nowrap"
                >
                  Acknowledge Alert
                </button>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Today's Dose Tracking & Medication Inventory */}
      <section className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        {/* Today's Dose Check-off */}
        <div className="bg-white rounded-3xl border border-slate-200 p-6 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-bold text-slate-900">Today’s Dose Tracking</h2>
            <span className="text-xs font-mono tabular-nums text-slate-500">
              {getLocalDateString()}
            </span>
          </div>

          {todaySchedule.length === 0 ? (
            <p className="text-sm text-slate-600">No active medications scheduled for today.</p>
          ) : (
            <div className="divide-y divide-slate-200">
              {todaySchedule.map(({ medication, todayLog, effectiveStatus, minutesDelta }) => {
                const isTakenLate = isDoseTakenLate(todayLog, circle.missedDoseThresholdMinutes);
                const statusLabel =
                  effectiveStatus === 'taken'
                    ? isTakenLate
                      ? 'Taken Late'
                      : 'Taken'
                    : effectiveStatus.replace('_', ' ');
                const showTakenLateBtn =
                  effectiveStatus === 'overdue' ||
                  effectiveStatus === 'missed' ||
                  minutesDelta > 0 ||
                  isTakenLate;

                return (
                  <div
                    key={medication.id}
                    className="py-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                  >
                    <div>
                      <p className="text-base font-bold text-slate-900">{medication.name}</p>
                      <p className="text-sm text-slate-600 tabular-nums">
                        {formatTime12h(medication.scheduleTime)} · {medication.dosage} · Status:{' '}
                        <span
                          className={`font-semibold capitalize ${
                            isTakenLate
                              ? 'text-amber-800'
                              : effectiveStatus === 'taken'
                              ? 'text-emerald-800'
                              : effectiveStatus === 'missed' || effectiveStatus === 'overdue'
                              ? 'text-rose-700'
                              : 'text-slate-900'
                          }`}
                        >
                          {statusLabel}
                        </span>
                      </p>
                      {todayLog?.takenAtIso && (
                        <p className="text-xs text-slate-500 tabular-nums mt-0.5">
                          Logged at {formatTime12h(todayLog.takenAtIso.slice(11, 16))}
                          {todayLog.note ? ` · ${todayLog.note}` : ''}
                        </p>
                      )}
                    </div>

                    <div className="flex flex-wrap items-center gap-2 shrink-0">
                      <button
                        type="button"
                        disabled={busyId === medication.id}
                        onClick={() => onRecordDose(medication, 'taken', todayLog)}
                        className={`min-h-[44px] px-3.5 rounded-xl text-sm font-semibold flex items-center gap-1.5 whitespace-nowrap ${
                          effectiveStatus === 'taken' && !isTakenLate
                            ? 'bg-emerald-700 text-white'
                            : 'border border-slate-300 bg-white text-slate-800 hover:bg-slate-50'
                        }`}
                      >
                        <Check className="w-4 h-4" aria-hidden="true" />
                        <span>Taken</span>
                      </button>
                      {showTakenLateBtn && (
                        <button
                          type="button"
                          disabled={busyId === medication.id}
                          onClick={() =>
                            onRecordDose(
                              medication,
                              'taken',
                              todayLog,
                              'Marked taken late by caretaker'
                            )
                          }
                          className={`min-h-[44px] px-3.5 rounded-xl text-sm font-semibold whitespace-nowrap ${
                            isTakenLate
                              ? 'bg-amber-700 text-white'
                              : 'border border-amber-300 bg-amber-50 text-amber-950 hover:bg-amber-100'
                          }`}
                        >
                          Taken Late
                        </button>
                      )}
                      <button
                        type="button"
                        disabled={busyId === medication.id}
                        onClick={() =>
                          onRecordDose(medication, 'skipped', todayLog, 'Skipped by caretaker')
                        }
                        className={`min-h-[44px] px-3.5 rounded-xl text-sm font-semibold whitespace-nowrap ${
                          effectiveStatus === 'skipped'
                            ? 'bg-slate-800 text-white'
                            : 'border border-slate-300 bg-white text-slate-700 hover:bg-slate-50'
                        }`}
                      >
                        Skip
                      </button>
                      <button
                        type="button"
                        disabled={busyId === medication.id}
                        onClick={() =>
                          onRecordDose(medication, 'missed', todayLog, 'Marked missed')
                        }
                        className={`min-h-[44px] px-3.5 rounded-xl text-sm font-semibold whitespace-nowrap ${
                          effectiveStatus === 'missed'
                            ? 'bg-rose-700 text-white'
                            : 'border border-slate-300 bg-white text-rose-800 hover:bg-rose-50'
                        }`}
                      >
                        Missed
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Full Medication Schedule CRUD */}
        <div className="bg-white rounded-3xl border border-slate-200 p-6 space-y-4">
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-2">
              <Pill className="w-5 h-5 text-teal-700" aria-hidden="true" />
              <h2 className="text-lg font-bold text-slate-900">Medication Regimen</h2>
            </div>
            <button
              type="button"
              onClick={openNewMed}
              className="min-h-[44px] px-3.5 rounded-xl border border-slate-300 text-sm font-semibold text-slate-800 hover:bg-slate-50 whitespace-nowrap"
            >
              + New Medicine
            </button>
          </div>

          {medications.length === 0 ? (
            <p className="text-sm text-slate-600">No medications configured yet.</p>
          ) : (
            <div className="divide-y divide-slate-200">
              {medications.map((med) => (
                <div
                  key={med.id}
                  className="py-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="text-base font-bold text-slate-900 truncate">{med.name}</p>
                      {!med.active && (
                        <span className="text-xs font-semibold text-slate-500">(Paused)</span>
                      )}
                    </div>
                    <p className="text-sm text-slate-600 tabular-nums mt-0.5">
                      {med.dosage} · {formatTime12h(med.scheduleTime)} ({formatSlotLabel(med.timeSlot)})
                    </p>
                    <p className="text-xs text-slate-600 mt-1 flex items-center gap-1.5 tabular-nums">
                      <Package className="w-3.5 h-3.5 text-slate-500" aria-hidden="true" />
                      <span className={med.stockCount <= 7 ? 'text-amber-800 font-semibold' : ''}>
                        {med.stockCount} doses in stock{med.stockCount <= 7 ? ' (Low refill)' : ''}
                      </span>
                    </p>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      type="button"
                      onClick={() => openEditMed(med)}
                      aria-label={`Edit ${med.name}`}
                      className="min-h-[44px] min-w-[44px] px-3 rounded-xl border border-slate-300 bg-white text-slate-700 hover:bg-slate-50 flex items-center justify-center gap-1.5 text-sm font-medium"
                    >
                      <Edit3 className="w-4 h-4" />
                      <span>Edit</span>
                    </button>
                    <button
                      type="button"
                      disabled={busyId === med.id}
                      onClick={() => onDeleteMedication(med.id)}
                      aria-label={`Delete ${med.name}`}
                      className="min-h-[44px] min-w-[44px] rounded-xl border border-slate-300 bg-white text-rose-700 hover:bg-rose-50 flex items-center justify-center"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </section>

      {/* Doctor Appointments Management */}
      <section className="bg-white rounded-3xl border border-slate-200 p-6 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <h2 className="text-lg font-bold text-slate-900">Doctor Appointment Management</h2>
          <div className="flex items-center gap-2 flex-wrap">
            <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-xl">
              {(['all', 'upcoming', 'completed', 'cancelled'] as const).map((tab) => (
                <button
                  key={tab}
                  type="button"
                  onClick={() => setApptFilter(tab)}
                  className={`min-h-[38px] px-3 rounded-lg text-xs font-semibold capitalize whitespace-nowrap transition-colors ${
                    apptFilter === tab
                      ? 'bg-white text-slate-900 shadow-sm'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  {tab}
                </button>
              ))}
            </div>
            <button
              type="button"
              onClick={openNewAppt}
              className="min-h-[44px] px-4 rounded-xl bg-slate-900 text-white text-sm font-semibold hover:bg-slate-800 whitespace-nowrap"
            >
              + Schedule Visit
            </button>
          </div>
        </div>

        {filteredAppointments.length === 0 ? (
          <p className="text-sm text-slate-600 py-4">No appointments match this filter.</p>
        ) : (
          <div className="divide-y divide-slate-200">
            {filteredAppointments.map((appt) => (
              <div
                key={appt.id}
                className="py-4 flex flex-col lg:flex-row lg:items-center justify-between gap-4"
              >
                <div className="space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-base font-bold text-slate-900">{appt.doctorName}</p>
                    <span className="text-sm text-slate-500">·</span>
                    <span className="text-sm font-medium text-teal-800">{appt.specialty}</span>
                    <span className="text-sm text-slate-500">·</span>
                    <span
                      className={`text-xs font-bold capitalize ${
                        appt.status === 'upcoming'
                          ? 'text-teal-800'
                          : appt.status === 'completed'
                          ? 'text-emerald-800'
                          : 'text-slate-500'
                      }`}
                    >
                      {appt.status}
                    </span>
                  </div>
                  <p className="text-sm text-slate-700 tabular-nums">
                    {appt.appointmentDate} at {formatTime12h(appt.appointmentTime)} ·{' '}
                    {appt.clinicName}
                  </p>
                  <p className="text-sm text-slate-600">{appt.purpose}</p>
                  {appt.notes && (
                    <p className="text-xs text-slate-500">Notes: {appt.notes}</p>
                  )}
                </div>

                <div className="flex flex-wrap items-center gap-2 shrink-0">
                  {appt.status === 'upcoming' && (() => {
                    const reminderLogId = buildAlertDedupId(
                      'appointment_reminder',
                      appt.id,
                      appt.appointmentDate
                    );
                    const reminderSent = notificationLogs.some((l) => l.id === reminderLogId);
                    return (
                      <>
                        <button
                          type="button"
                          disabled={busyId === appt.id || reminderSent}
                          onClick={() => onSendAppointmentReminder(appt)}
                          className={`min-h-[44px] px-3.5 rounded-xl text-sm font-medium flex items-center gap-1.5 whitespace-nowrap ${
                            reminderSent
                              ? 'border border-teal-200 bg-teal-50 text-teal-900'
                              : 'border border-slate-300 bg-white text-slate-800 hover:bg-slate-50'
                          }`}
                        >
                          <BellRing className="w-3.5 h-3.5 text-teal-700" aria-hidden="true" />
                          <span>{reminderSent ? 'Reminder Logged' : 'Send Reminder'}</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => openEditAppt(appt)}
                          className="min-h-[44px] px-3.5 rounded-xl border border-slate-300 bg-white text-slate-800 text-sm font-medium hover:bg-slate-50 whitespace-nowrap"
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          disabled={busyId === appt.id}
                          onClick={() => onUpdateAppointmentStatus(appt.id, 'completed')}
                          className="min-h-[44px] px-3.5 rounded-xl bg-emerald-700 text-white text-sm font-semibold hover:bg-emerald-800 whitespace-nowrap"
                        >
                          Mark Completed
                        </button>
                        <button
                          type="button"
                          disabled={busyId === appt.id}
                          onClick={() => onUpdateAppointmentStatus(appt.id, 'cancelled')}
                          className="min-h-[44px] px-3.5 rounded-xl border border-slate-300 bg-white text-slate-700 text-sm font-medium hover:bg-slate-50 whitespace-nowrap"
                        >
                          Cancel
                        </button>
                      </>
                    );
                  })()}
                  <button
                    type="button"
                    disabled={busyId === appt.id}
                    onClick={() => onDeleteAppointment(appt.id)}
                    aria-label={`Delete appointment with ${appt.doctorName}`}
                    className="min-h-[44px] min-w-[44px] rounded-xl border border-slate-300 bg-white text-rose-700 hover:bg-rose-50 flex items-center justify-center"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Medication Add/Edit Modal */}
      {medModalOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="med-modal-title"
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-slate-950/60 backdrop-blur-sm p-0 sm:p-4"
        >
          <div className="w-full sm:max-w-lg bg-white rounded-t-3xl sm:rounded-3xl border border-slate-200 shadow-2xl p-6 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between pb-4 border-b border-slate-200">
              <h3 id="med-modal-title" className="text-xl font-bold text-slate-900">
                {editingMed ? 'Edit Medication' : 'Add Scheduled Medication'}
              </h3>
              <button
                type="button"
                onClick={() => setMedModalOpen(false)}
                aria-label="Close modal"
                className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-xl hover:bg-slate-100"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSaveMed} className="space-y-4 mt-4">
              {medError && (
                <p className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-sm text-rose-800">
                  {medError}
                </p>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-semibold text-slate-800 mb-1">
                    Medicine Name
                  </label>
                  <input
                    type="text"
                    required
                    maxLength={100}
                    value={medForm.name}
                    onChange={(e) => setMedForm({ ...medForm, name: e.target.value })}
                    placeholder="e.g., Lisinopril"
                    className="w-full min-h-[44px] px-3.5 rounded-xl border border-slate-300 text-sm"
                  />
                </div>
                <div>
                  <label className="block text-sm font-semibold text-slate-800 mb-1">
                    Dosage
                  </label>
                  <input
                    type="text"
                    required
                    maxLength={60}
                    value={medForm.dosage}
                    onChange={(e) => setMedForm({ ...medForm, dosage: e.target.value })}
                    placeholder="e.g., 10 mg tablet"
                    className="w-full min-h-[44px] px-3.5 rounded-xl border border-slate-300 text-sm"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div>
                  <label className="block text-sm font-semibold text-slate-800 mb-1">
                    Time (24h)
                  </label>
                  <input
                    type="time"
                    required
                    value={medForm.scheduleTime}
                    onChange={(e) => setMedForm({ ...medForm, scheduleTime: e.target.value })}
                    className="w-full min-h-[44px] px-3.5 rounded-xl border border-slate-300 text-sm"
                  />
                </div>
                <div>
                  <label className="block text-sm font-semibold text-slate-800 mb-1">
                    Time Slot
                  </label>
                  <select
                    value={medForm.timeSlot}
                    onChange={(e) =>
                      setMedForm({ ...medForm, timeSlot: e.target.value as TimeSlot })
                    }
                    className="w-full min-h-[44px] px-3.5 rounded-xl border border-slate-300 text-sm bg-white"
                  >
                    <option value="morning">Morning</option>
                    <option value="afternoon">Afternoon</option>
                    <option value="evening">Evening</option>
                    <option value="night">Night</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-semibold text-slate-800 mb-1">
                    Stock Count
                  </label>
                  <input
                    type="number"
                    min={0}
                    max={5000}
                    required
                    value={medForm.stockCount}
                    onChange={(e) =>
                      setMedForm({ ...medForm, stockCount: Number(e.target.value) || 0 })
                    }
                    className="w-full min-h-[44px] px-3.5 rounded-xl border border-slate-300 text-sm"
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-semibold text-slate-800 mb-1">
                  Instructions
                </label>
                <input
                  type="text"
                  maxLength={250}
                  value={medForm.instructions}
                  onChange={(e) => setMedForm({ ...medForm, instructions: e.target.value })}
                  placeholder="e.g., Take with full glass of water"
                  className="w-full min-h-[44px] px-3.5 rounded-xl border border-slate-300 text-sm"
                />
              </div>

              <div className="flex flex-wrap gap-6 pt-1">
                <label className="flex items-center gap-2.5 text-sm font-medium text-slate-800 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={medForm.withFood}
                    onChange={(e) => setMedForm({ ...medForm, withFood: e.target.checked })}
                    className="w-5 h-5 rounded border-slate-300 text-teal-700"
                  />
                  <span>Take with food</span>
                </label>
                <label className="flex items-center gap-2.5 text-sm font-medium text-slate-800 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={medForm.active}
                    onChange={(e) => setMedForm({ ...medForm, active: e.target.checked })}
                    className="w-5 h-5 rounded border-slate-300 text-teal-700"
                  />
                  <span>Active schedule</span>
                </label>
              </div>

              <div className="flex gap-3 pt-3">
                <button
                  type="button"
                  onClick={() => setMedModalOpen(false)}
                  className="w-1/2 min-h-[48px] rounded-xl border border-slate-300 text-slate-800 font-semibold text-sm"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="w-1/2 min-h-[48px] rounded-xl bg-teal-700 text-white font-semibold text-sm hover:bg-teal-800"
                >
                  {editingMed ? 'Save Changes' : 'Add Medicine'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Appointment Add/Edit Modal */}
      {apptModalOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="appt-modal-title"
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-slate-950/60 backdrop-blur-sm p-0 sm:p-4"
        >
          <div className="w-full sm:max-w-lg bg-white rounded-t-3xl sm:rounded-3xl border border-slate-200 shadow-2xl p-6 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between pb-4 border-b border-slate-200">
              <h3 id="appt-modal-title" className="text-xl font-bold text-slate-900">
                {editingAppt ? 'Edit Doctor Appointment' : 'Schedule Doctor Appointment'}
              </h3>
              <button
                type="button"
                onClick={() => setApptModalOpen(false)}
                aria-label="Close modal"
                className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-xl hover:bg-slate-100"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSaveAppt} className="space-y-4 mt-4">
              {apptError && (
                <p className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-sm text-rose-800">
                  {apptError}
                </p>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-semibold text-slate-800 mb-1">
                    Doctor Name
                  </label>
                  <input
                    type="text"
                    required
                    maxLength={100}
                    value={apptForm.doctorName}
                    onChange={(e) => setApptForm({ ...apptForm, doctorName: e.target.value })}
                    placeholder="e.g., Dr. Elena Rostova"
                    className="w-full min-h-[44px] px-3.5 rounded-xl border border-slate-300 text-sm"
                  />
                </div>
                <div>
                  <label className="block text-sm font-semibold text-slate-800 mb-1">
                    Specialty
                  </label>
                  <input
                    type="text"
                    required
                    maxLength={80}
                    value={apptForm.specialty}
                    onChange={(e) => setApptForm({ ...apptForm, specialty: e.target.value })}
                    placeholder="e.g., Cardiology"
                    className="w-full min-h-[44px] px-3.5 rounded-xl border border-slate-300 text-sm"
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-semibold text-slate-800 mb-1">
                  Clinic / Hospital Name
                </label>
                <input
                  type="text"
                  required
                  maxLength={120}
                  value={apptForm.clinicName}
                  onChange={(e) => setApptForm({ ...apptForm, clinicName: e.target.value })}
                  placeholder="e.g., Oakridge Senior Heart Clinic"
                  className="w-full min-h-[44px] px-3.5 rounded-xl border border-slate-300 text-sm"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-semibold text-slate-800 mb-1">Date</label>
                  <input
                    type="date"
                    required
                    value={apptForm.appointmentDate}
                    onChange={(e) => setApptForm({ ...apptForm, appointmentDate: e.target.value })}
                    className="w-full min-h-[44px] px-3.5 rounded-xl border border-slate-300 text-sm"
                  />
                </div>
                <div>
                  <label className="block text-sm font-semibold text-slate-800 mb-1">Time</label>
                  <input
                    type="time"
                    required
                    value={apptForm.appointmentTime}
                    onChange={(e) => setApptForm({ ...apptForm, appointmentTime: e.target.value })}
                    className="w-full min-h-[44px] px-3.5 rounded-xl border border-slate-300 text-sm"
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-semibold text-slate-800 mb-1">
                  Visit Purpose
                </label>
                <input
                  type="text"
                  required
                  maxLength={200}
                  value={apptForm.purpose}
                  onChange={(e) => setApptForm({ ...apptForm, purpose: e.target.value })}
                  placeholder="e.g., Blood pressure review & prescription renewal"
                  className="w-full min-h-[44px] px-3.5 rounded-xl border border-slate-300 text-sm"
                />
              </div>

              <div>
                <label className="block text-sm font-semibold text-slate-800 mb-1">
                  Preparation Notes
                </label>
                <input
                  type="text"
                  maxLength={400}
                  value={apptForm.notes}
                  onChange={(e) => setApptForm({ ...apptForm, notes: e.target.value })}
                  placeholder="e.g., Bring recent blood pressure log"
                  className="w-full min-h-[44px] px-3.5 rounded-xl border border-slate-300 text-sm"
                />
              </div>

              <div className="flex gap-3 pt-3">
                <button
                  type="button"
                  onClick={() => setApptModalOpen(false)}
                  className="w-1/2 min-h-[48px] rounded-xl border border-slate-300 text-slate-800 font-semibold text-sm"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="w-1/2 min-h-[48px] rounded-xl bg-teal-700 text-white font-semibold text-sm hover:bg-teal-800"
                >
                  {editingAppt ? 'Save Visit' : 'Schedule Visit'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
