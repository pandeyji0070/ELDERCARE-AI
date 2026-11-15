import { useCallback, useEffect, useRef, useState } from 'react';
import {
  onAuthStateChanged,
  signInWithPopup,
  signOut,
  type User,
} from 'firebase/auth';
import {
  AlertOctagon,
  BarChart3,
  HeartHandshake,
  KeyRound,
  Lock,
  LogOut,
  RefreshCw,
  Shield,
  Stethoscope,
  Users,
  X,
} from 'lucide-react';
import { auth, formatFirestoreErrorMessage, googleProvider } from './lib/firebase';
import {
  acknowledgeDoseAlert,
  buildAlertDedupId,
  createAppointment,
  createCircleInvite,
  createMedication,
  createNotificationLog,
  deleteAiRoutine,
  deleteAppointment,
  deleteMedication,
  ensureOrCreateCareCircle,
  ensureUserProfile,
  hasNotificationLog,
  joinCareCircleByInvite,
  leaveCareCircle,
  recordDoseStatus,
  removeCircleMember,
  revokeCircleInvite,
  sanitizeMemberUids,
  saveAiRoutine,
  seedDemoData,
  subscribeAiRoutines,
  subscribeAppointments,
  subscribeCareCircle,
  subscribeCircleInvites,
  subscribeCircleMembers,
  subscribeDoseLogs,
  subscribeMedications,
  subscribeNotificationLogs,
  subscribeOwnMembership,
  subscribeSosEvents,
  syncCircleMemberUids,
  triggerDemoSosEvent,
  updateAppointmentDetails,
  updateAppointmentStatus,
  updateCareCircleSettings,
  updateCircleMemberRole,
  updateMedication,
  updateSosEventStatus,
  updateUserActiveRole,
  type AppointmentInput,
  type MedicationInput,
} from './lib/careService';
import {
  AiConfigurationPendingError,
  dispatchCareAlert,
  generateAiHealthRoutine,
  sendEmailNotification,
} from './lib/apiClient';
import {
  buildTodaySchedule,
  formatTime12h,
  getLocalDateString,
  getOffsetDateString,
} from './lib/analytics';
import { AvatarImg } from './components/AvatarImg';
import { CaretakerDashboard } from './components/CaretakerDashboard';
import { ElderlyDashboard } from './components/ElderlyDashboard';
import { FamilyDashboard } from './components/FamilyDashboard';
import { SosModal } from './components/SosModal';
import { ToastBanner } from './components/ToastBanner';
import type {
  AiRoutine,
  AiRoutineResponse,
  Appointment,
  CareCircle,
  CircleInvite,
  CircleMember,
  DashboardRole,
  DoseLog,
  DoseStatus,
  Medication,
  NotificationEventType,
  NotificationLog,
  SosEvent,
  ToastMessage,
} from './types';

export default function App() {
  const [authReady, setAuthReady] = useState(false);
  const [user, setUser] = useState<User | null>(null);
  const [signingIn, setSigningIn] = useState(false);

  const [role, setRole] = useState<DashboardRole>('elderly');
  const [circle, setCircle] = useState<CareCircle | null>(null);
  const [loadingWorkspace, setLoadingWorkspace] = useState(false);
  const [workspaceError, setWorkspaceError] = useState<string | null>(null);

  const [medications, setMedications] = useState<Medication[]>([]);
  const [doseLogs, setDoseLogs] = useState<DoseLog[]>([]);
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [sosEvents, setSosEvents] = useState<SosEvent[]>([]);
  const [notificationLogs, setNotificationLogs] = useState<NotificationLog[]>([]);
  const [aiRoutines, setAiRoutines] = useState<AiRoutine[]>([]);

  const [members, setMembers] = useState<CircleMember[]>([]);
  const [ownMembership, setOwnMembership] = useState<CircleMember | null>(null);
  const [ownMembershipResolved, setOwnMembershipResolved] = useState(false);
  const [invites, setInvites] = useState<CircleInvite[]>([]);
  const [syncingMembers, setSyncingMembers] = useState(false);

  const [joinModalOpen, setJoinModalOpen] = useState(false);
  const [inviteCodeInput, setInviteCodeInput] = useState('');
  const [pendingInviteFromUrl, setPendingInviteFromUrl] = useState<string | null>(() => {
    if (typeof window === 'undefined') return null;
    const raw = new URLSearchParams(window.location.search).get('invite')?.trim().toUpperCase() || '';
    return /^[A-Z0-9_\-]{8,64}$/.test(raw) ? raw : null;
  });
  const [joiningCircle, setJoiningCircle] = useState(false);
  const [joinError, setJoinError] = useState<string | null>(null);

  const [busyId, setBusyId] = useState<string | null>(null);
  const [sosModalOpen, setSosModalOpen] = useState(false);
  const [sosSubmitting, setSosSubmitting] = useState(false);
  const [seedingDemo, setSeedingDemo] = useState(false);
  const [toasts, setToasts] = useState<ToastMessage[]>([]);
  const lastSyncedKeyRef = useRef<string>('');
  const dispatchedAlertIdsRef = useRef<Set<string>>(new Set());
  const [alertTick, setAlertTick] = useState(0);

  const pushToast = useCallback(
    (type: ToastMessage['type'], title: string, detail?: string) => {
      const id = `${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
      setToasts((prev) => [...prev.slice(-3), { id, type, title, detail }]);
      setTimeout(() => {
        setToasts((prev) => prev.filter((t) => t.id !== id));
      }, 5500);
    },
    []
  );

  const dismissToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const initializeWorkspace = useCallback(
    async (targetUser: User) => {
      setLoadingWorkspace(true);
      setWorkspaceError(null);
      try {
        if (!targetUser.emailVerified) {
          throw new Error(
            'Your Google account email is not verified. Please sign in with a verified Google account to initialize your Care Circle.'
          );
        }
        const profile = await ensureUserProfile(targetUser);
        setRole(profile.activeRole || 'elderly');
        const userCircle = await ensureOrCreateCareCircle(targetUser);
        setCircle(userCircle);
      } catch (err) {
        const msg = formatFirestoreErrorMessage(err, 'Unable to load Care Circle.');
        setWorkspaceError(msg);
        pushToast('error', 'Workspace initialization failed', msg);
      } finally {
        setLoadingWorkspace(false);
      }
    },
    [pushToast]
  );

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (nextUser) => {
      setUser(nextUser);
      setAuthReady(true);

      if (!nextUser) {
        setRole('elderly');
        setLoadingWorkspace(false);
        setCircle(null);
        setWorkspaceError(null);
        setMedications([]);
        setDoseLogs([]);
        setAppointments([]);
        setSosEvents([]);
        setNotificationLogs([]);
        setAiRoutines([]);
        setMembers([]);
        setOwnMembership(null);
        setInvites([]);
        lastSyncedKeyRef.current = '';
        dispatchedAlertIdsRef.current.clear();
        return;
      }

      await initializeWorkspace(nextUser);
    });

    return () => unsub();
  }, [initializeWorkspace]);

  useEffect(() => {
    if (!user || !circle) return;

    setOwnMembershipResolved(false);
    const viewerIsOwner = circle.ownerId === user.uid;
    const unsubs = [
      subscribeCareCircle(circle.id, (updated) => {
        if (updated) setCircle(updated);
      }),
      subscribeOwnMembership(circle.id, user.uid, (member) => {
        setOwnMembership(member);
        setOwnMembershipResolved(true);
      }),
      subscribeMedications(circle.id, circle.ownerId, user.uid, setMedications),
      subscribeDoseLogs(circle.id, circle.ownerId, user.uid, setDoseLogs),
      subscribeAppointments(circle.id, circle.ownerId, user.uid, setAppointments),
      subscribeSosEvents(circle.id, circle.ownerId, user.uid, setSosEvents),
      subscribeNotificationLogs(circle.id, circle.ownerId, user.uid, setNotificationLogs),
      subscribeAiRoutines(circle.id, circle.ownerId, user.uid, setAiRoutines),
    ];

    if (viewerIsOwner) {
      unsubs.push(
        subscribeCircleMembers(circle.id, circle.ownerId, setMembers),
        subscribeCircleInvites(circle.ownerId, circle.id, setInvites)
      );
    } else {
      setMembers([]);
      setInvites([]);
    }

    return () => {
      for (const u of unsubs) u();
    };
  }, [user, circle?.id, circle?.ownerId]);

  const isOwner = Boolean(user && circle && circle.ownerId === user.uid);
  const effectiveRole: DashboardRole = isOwner ? role : ownMembership?.role || role;
  const activeMemberUids =
    circle?.memberUids && circle.memberUids.length > 0
      ? sanitizeMemberUids(circle.memberUids, circle.ownerId)
      : sanitizeMemberUids(
          members.map((m) => m.uid),
          circle?.ownerId || user?.uid || '',
          user?.uid
        );

  // Open Join modal automatically when arriving from a ?invite= share link
  useEffect(() => {
    if (!user || !circle || loadingWorkspace || !pendingInviteFromUrl) return;
    setInviteCodeInput(pendingInviteFromUrl);
    setJoinError(null);
    setJoinModalOpen(true);
    setPendingInviteFromUrl(null);
    if (typeof window !== 'undefined') {
      const url = new URL(window.location.href);
      url.searchParams.delete('invite');
      window.history.replaceState({}, '', `${url.pathname}${url.search}${url.hash}`);
    }
  }, [user, circle, loadingWorkspace, pendingInviteFromUrl]);

  // Recover gracefully if an invited member is removed while signed in
  useEffect(() => {
    if (!user || !circle || circle.ownerId === user.uid || loadingWorkspace) return;
    if (ownMembershipResolved && ownMembership === null) {
      pushToast(
        'info',
        'Care Circle access ended',
        'Returning to your personal Care Circle workspace.'
      );
      void initializeWorkspace(user);
    }
  }, [user, circle, ownMembershipResolved, ownMembership, loadingWorkspace, pushToast, initializeWorkspace]);

  // Reset in-memory alert deduplication lock when switching circles
  useEffect(() => {
    dispatchedAlertIdsRef.current.clear();
  }, [circle?.id]);

  // Automatic background sync for Care Circle owner whenever member roster changes
  useEffect(() => {
    if (!user || !circle || circle.ownerId !== user.uid || members.length === 0) return;
    const targetUids = sanitizeMemberUids(
      members.map((m) => m.uid),
      circle.ownerId
    );
    const syncKey = `${circle.id}:${targetUids.join(',')}`;
    if (lastSyncedKeyRef.current === syncKey) return;
    lastSyncedKeyRef.current = syncKey;

    syncCircleMemberUids(circle.id, circle.ownerId, targetUids).catch(() => {
      lastSyncedKeyRef.current = '';
    });
  }, [user, circle?.id, circle?.ownerId, members]);

  const dispatchDedupedCareAlert = useCallback(
    async (params: {
      dedupId: string;
      eventType: NotificationEventType;
      sosId?: string;
      subject: string;
      summary: string;
      details?: Record<string, string | number | boolean | undefined>;
      showFeedbackToast?: boolean;
    }): Promise<boolean> => {
      if (!circle || !user) return false;
      const recipient = (circle.notificationEmail || '').trim();
      if (!circle.emailAlertsEnabled || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipient)) {
        return false;
      }
      if (
        dispatchedAlertIdsRef.current.has(params.dedupId) ||
        notificationLogs.some((l) => l.id === params.dedupId)
      ) {
        return false;
      }

      dispatchedAlertIdsRef.current.add(params.dedupId);

      try {
        const alreadyInFirestore = await hasNotificationLog(circle.id, params.dedupId);
        if (alreadyInFirestore) {
          return false;
        }

        const result = await dispatchCareAlert({
          circleId: circle.id,
          ...(params.sosId ? { sosId: params.sosId } : {}),
          eventType: params.eventType,
          recipientEmail: recipient,
          elderName: circle.elderName,
          subject: params.subject,
          summary: params.summary,
          details: params.details,
        });

        await createNotificationLog(
          circle.id,
          circle.ownerId,
          recipient,
          result.subject || params.subject,
          params.eventType,
          result.deliveryStatus,
          result.detail,
          activeMemberUids,
          params.dedupId
        );

        if (params.showFeedbackToast) {
          if (result.delivered) {
            pushToast('success', 'Alert email sent via SMTP', result.detail);
          } else {
            pushToast('info', 'Alert logged (SMTP not configured)', result.detail);
          }
        }
        return true;
      } catch (err) {
        const detail = err instanceof Error ? err.message : 'Automated alert dispatch failed';
        await createNotificationLog(
          circle.id,
          circle.ownerId,
          recipient,
          params.subject,
          params.eventType,
          'failed',
          detail,
          activeMemberUids,
          params.dedupId
        ).catch(() => {});

        if (params.showFeedbackToast) {
          pushToast('error', 'Alert notification dispatch failed', detail);
        }
        return false;
      }
    },
    [circle, user, notificationLogs, activeMemberUids, pushToast]
  );

  // Periodic tick (60s) so overdue medication & 24h appointment monitors trigger automatically
  useEffect(() => {
    if (!user || !circle) return;
    const interval = setInterval(() => {
      setAlertTick((prev) => prev + 1);
    }, 60_000);
    return () => clearInterval(interval);
  }, [user, circle?.id]);

  // Automated Caretaker/Family monitor: deduplicated overdue medication & 24h appointment reminders
  useEffect(() => {
    if (!user || !circle) return;
    const canManageAlerts =
      circle.ownerId === user.uid ||
      ownMembership?.role === 'caretaker' ||
      ownMembership?.role === 'family';
    if (!canManageAlerts) return;

    const recipient = (circle.notificationEmail || '').trim();
    if (!circle.emailAlertsEnabled || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipient)) {
      return;
    }

    const todayStr = getLocalDateString();
    const tomorrowStr = getOffsetDateString(-1);

    const schedule = buildTodaySchedule(
      medications,
      doseLogs,
      circle.missedDoseThresholdMinutes
    );

    const overdueOrMissedToday = schedule.filter(
      (item) => item.effectiveStatus === 'overdue' || item.effectiveStatus === 'missed'
    );

    const upcomingSoonAppts = appointments.filter(
      (appt) =>
        appt.status === 'upcoming' &&
        (appt.appointmentDate === todayStr || appt.appointmentDate === tomorrowStr)
    );

    let cancelled = false;
    (async () => {
      for (const item of overdueOrMissedToday) {
        if (cancelled) return;
        const dedupId = buildAlertDedupId('missed_dose', item.medication.id, todayStr);
        await dispatchDedupedCareAlert({
          dedupId,
          eventType: 'missed_dose',
          subject: `[Missed Dose Alert] ${circle.elderName}: ${item.medication.name}`,
          summary: `${item.medication.name} (${item.medication.dosage}) scheduled for ${formatTime12h(
            item.medication.scheduleTime
          )} on ${todayStr} is ${
            item.effectiveStatus === 'missed'
              ? 'marked missed'
              : `${item.minutesDelta} minutes past schedule`
          }.`,
          details: {
            Resident: circle.elderName,
            Medication: `${item.medication.name} (${item.medication.dosage})`,
            Scheduled: `${todayStr} at ${formatTime12h(item.medication.scheduleTime)}`,
            Status: item.effectiveStatus === 'missed' ? 'Missed' : `Overdue (${item.minutesDelta}m)`,
            StockRemaining: `${item.medication.stockCount} doses`,
          },
          showFeedbackToast: false,
        });
      }

      for (const appt of upcomingSoonAppts) {
        if (cancelled) return;
        const dedupId = buildAlertDedupId('appointment_reminder', appt.id, appt.appointmentDate);
        const dayLabel = appt.appointmentDate === todayStr ? 'Today' : 'Tomorrow';
        await dispatchDedupedCareAlert({
          dedupId,
          eventType: 'appointment_reminder',
          subject: `[Appointment Reminder] ${circle.elderName}: ${appt.doctorName} (${dayLabel})`,
          summary: `Upcoming ${appt.specialty} visit with ${appt.doctorName} at ${appt.clinicName} on ${appt.appointmentDate} (${dayLabel}) at ${formatTime12h(
            appt.appointmentTime
          )}.`,
          details: {
            Resident: circle.elderName,
            Doctor: `${appt.doctorName} (${appt.specialty})`,
            Clinic: appt.clinicName,
            DateTime: `${appt.appointmentDate} at ${formatTime12h(appt.appointmentTime)}`,
            Purpose: appt.purpose,
            Notes: appt.notes || 'None',
          },
          showFeedbackToast: false,
        });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [
    user,
    circle,
    ownMembership?.role,
    medications,
    doseLogs,
    appointments,
    alertTick,
    dispatchDedupedCareAlert,
  ]);

  const handleGoogleSignIn = async () => {
    setSigningIn(true);
    try {
      await signInWithPopup(auth, googleProvider);
      pushToast('success', 'Signed in to ELDERCARE AI');
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Sign-in cancelled or blocked';
      pushToast('error', 'Google Sign-In failed', msg);
    } finally {
      setSigningIn(false);
    }
  };

  const handleSignOut = async () => {
    try {
      await signOut(auth);
      pushToast('info', 'Signed out cleanly');
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to sign out';
      pushToast('error', 'Sign-out error', msg);
    }
  };

  const handleRoleChange = async (nextRole: DashboardRole) => {
    if (!isOwner) return;
    setRole(nextRole);
    if (user) {
      try {
        await updateUserActiveRole(user.uid, nextRole);
      } catch {
        // Non-blocking UI preference update
      }
    }
  };

  const handleSeedDemo = async () => {
    if (!circle || !user || !isOwner || seedingDemo) return;
    setSeedingDemo(true);
    try {
      await seedDemoData(circle.id, circle.ownerId, user.uid, {
        resetExisting: true,
        memberUids: activeMemberUids,
      });
      pushToast(
        'success',
        'Sample care data refreshed',
        'Loaded 4 medications, 30-day adherence logs, 3 doctor appointments, and an AI routine.'
      );
    } catch (err) {
      pushToast(
        'error',
        'Could not refresh sample data',
        formatFirestoreErrorMessage(err, 'Firestore error')
      );
    } finally {
      setSeedingDemo(false);
    }
  };

  const handleRecordDose = async (
    med: Medication,
    status: DoseStatus,
    existingLog: DoseLog | null,
    note = ''
  ) => {
    if (!circle || !user) return;
    setBusyId(med.id);
    try {
      const todayStr = getLocalDateString();
      await recordDoseStatus(
        circle.id,
        circle.ownerId,
        user.uid,
        med,
        todayStr,
        status,
        existingLog,
        note,
        activeMemberUids
      );
      const isLateNote = status === 'taken' && /\blate\b/i.test(note);
      const label = isLateNote
        ? `${med.name} marked as taken late`
        : status === 'taken'
        ? `${med.name} marked as taken`
        : status === 'missed'
        ? `${med.name} logged as missed`
        : status === 'skipped'
        ? `${med.name} marked as skipped`
        : `${med.name} reset to pending`;
      pushToast('success', label);

      if (status === 'missed' && effectiveRole !== 'elderly') {
        const dedupId = buildAlertDedupId('missed_dose', med.id, todayStr);
        void dispatchDedupedCareAlert({
          dedupId,
          eventType: 'missed_dose',
          subject: `[Missed Dose Alert] ${circle.elderName}: ${med.name}`,
          summary: `${med.name} (${med.dosage}) scheduled for ${formatTime12h(
            med.scheduleTime
          )} on ${todayStr} was confirmed missed.`,
          details: {
            Resident: circle.elderName,
            Medication: `${med.name} (${med.dosage})`,
            Scheduled: `${todayStr} at ${formatTime12h(med.scheduleTime)}`,
            Note: note || 'Marked missed in Caretaker Console',
          },
          showFeedbackToast: true,
        });
      }
    } catch (err) {
      pushToast(
        'error',
        'Could not update dose log',
        formatFirestoreErrorMessage(err, 'Permission or network error')
      );
    } finally {
      setBusyId(null);
    }
  };

  const handleCreateMedication = async (input: MedicationInput): Promise<boolean> => {
    if (!circle || !user) return false;
    try {
      await createMedication(circle.id, circle.ownerId, user.uid, input, activeMemberUids);
      pushToast('success', `${input.name} added to medication schedule`);
      return true;
    } catch (err) {
      pushToast(
        'error',
        'Failed to add medication',
        formatFirestoreErrorMessage(err, 'Validation or permission error')
      );
      return false;
    }
  };

  const handleUpdateMedication = async (
    medId: string,
    input: Partial<MedicationInput>
  ): Promise<boolean> => {
    if (!circle) return false;
    setBusyId(medId);
    try {
      await updateMedication(circle.id, medId, input);
      pushToast('success', 'Medication schedule updated');
      return true;
    } catch (err) {
      pushToast(
        'error',
        'Failed to update medication',
        formatFirestoreErrorMessage(err, 'Firestore error')
      );
      return false;
    } finally {
      setBusyId(null);
    }
  };

  const handleDeleteMedication = async (medId: string) => {
    if (!circle) return;
    setBusyId(medId);
    try {
      await deleteMedication(circle.id, medId);
      pushToast('info', 'Medication removed from schedule');
    } catch (err) {
      pushToast(
        'error',
        'Failed to remove medication',
        formatFirestoreErrorMessage(err, 'Firestore error')
      );
    } finally {
      setBusyId(null);
    }
  };

  const handleAcknowledgeDoseAlert = async (logId: string) => {
    if (!circle) return;
    setBusyId(logId);
    try {
      await acknowledgeDoseAlert(circle.id, logId);
      pushToast('success', 'Missed dose alert acknowledged');
    } catch (err) {
      pushToast(
        'error',
        'Could not acknowledge alert',
        formatFirestoreErrorMessage(err, 'Firestore error')
      );
    } finally {
      setBusyId(null);
    }
  };

  const handleCreateAppointment = async (input: AppointmentInput): Promise<boolean> => {
    if (!circle) return false;
    try {
      await createAppointment(circle.id, circle.ownerId, input, activeMemberUids);
      pushToast('success', `Appointment with ${input.doctorName} scheduled`);
      return true;
    } catch (err) {
      pushToast(
        'error',
        'Failed to schedule appointment',
        formatFirestoreErrorMessage(err, 'Firestore error')
      );
      return false;
    }
  };

  const handleUpdateAppointmentDetails = async (
    apptId: string,
    input: AppointmentInput
  ): Promise<boolean> => {
    if (!circle) return false;
    setBusyId(apptId);
    try {
      await updateAppointmentDetails(circle.id, apptId, input);
      pushToast('success', 'Appointment details updated');
      return true;
    } catch (err) {
      pushToast(
        'error',
        'Failed to update appointment',
        formatFirestoreErrorMessage(err, 'Firestore error')
      );
      return false;
    } finally {
      setBusyId(null);
    }
  };

  const handleUpdateAppointmentStatus = async (
    apptId: string,
    status: 'completed' | 'cancelled'
  ) => {
    if (!circle) return;
    setBusyId(apptId);
    try {
      await updateAppointmentStatus(circle.id, apptId, status);
      pushToast('success', `Appointment marked as ${status}`);
    } catch (err) {
      pushToast(
        'error',
        'Failed to update appointment status',
        formatFirestoreErrorMessage(err, 'Firestore error')
      );
    } finally {
      setBusyId(null);
    }
  };

  const handleDeleteAppointment = async (apptId: string) => {
    if (!circle) return;
    setBusyId(apptId);
    try {
      await deleteAppointment(circle.id, apptId);
      pushToast('info', 'Appointment deleted');
    } catch (err) {
      pushToast(
        'error',
        'Failed to delete appointment',
        formatFirestoreErrorMessage(err, 'Firestore error')
      );
    } finally {
      setBusyId(null);
    }
  };

  const handleSendAppointmentReminder = async (appt: Appointment) => {
    if (!circle || !user) return;
    const recipient = (circle.notificationEmail || '').trim();
    if (!circle.emailAlertsEnabled || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipient)) {
      pushToast(
        'info',
        'Enable Email Alerts First',
        'Set a valid recipient email and enable alerts under Family & AI > Email Notification Setup.'
      );
      return;
    }

    const dedupId = buildAlertDedupId('appointment_reminder', appt.id, appt.appointmentDate);
    if (notificationLogs.some((l) => l.id === dedupId) || dispatchedAlertIdsRef.current.has(dedupId)) {
      pushToast(
        'info',
        'Reminder already logged',
        `An alert for ${appt.doctorName} (${appt.appointmentDate}) is already in the audit log.`
      );
      return;
    }

    setBusyId(appt.id);
    try {
      await dispatchDedupedCareAlert({
        dedupId,
        eventType: 'appointment_reminder',
        subject: `[Appointment Reminder] ${circle.elderName}: ${appt.doctorName}`,
        summary: `Upcoming ${appt.specialty} visit with ${appt.doctorName} at ${appt.clinicName} on ${appt.appointmentDate} at ${formatTime12h(
          appt.appointmentTime
        )}.`,
        details: {
          Resident: circle.elderName,
          Doctor: `${appt.doctorName} (${appt.specialty})`,
          Clinic: appt.clinicName,
          DateTime: `${appt.appointmentDate} at ${formatTime12h(appt.appointmentTime)}`,
          Purpose: appt.purpose,
          Notes: appt.notes || 'None',
        },
        showFeedbackToast: true,
      });
    } finally {
      setBusyId(null);
    }
  };

  const handleConfirmSos = async (note: string) => {
    if (!circle || !user) return;
    setSosSubmitting(true);
    try {
      const senderName = user.displayName || circle.elderName;
      const sosId = await triggerDemoSosEvent(
        circle.id,
        circle.ownerId,
        user.uid,
        senderName,
        note,
        activeMemberUids
      );
      setSosModalOpen(false);
      pushToast(
        'info',
        'Demo SOS Alert Logged',
        'Visible immediately in Caretaker & Family dashboards. Remember: demo only, no 911 dispatch.'
      );

      if (circle.emailAlertsEnabled && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test((circle.notificationEmail || '').trim())) {
        const dedupId = buildAlertDedupId('sos_demo', sosId);
        void dispatchDedupedCareAlert({
          dedupId,
          eventType: 'sos_demo',
          sosId,
          subject: `[DEMO SOS] ${circle.elderName} — Assistance Requested`,
          summary: `${senderName} confirmed a Demo SOS assistance alert for ${circle.elderName} in ELDERCARE AI.`,
          details: {
            Resident: circle.elderName,
            TriggeredBy: senderName,
            Note: note || 'Emergency assistance requested via ELDERCARE AI demo SOS button.',
            EmergencyContact: `${circle.emergencyContactName} (${circle.emergencyContactPhone})`,
          },
          showFeedbackToast: true,
        });
      }
    } catch (err) {
      pushToast(
        'error',
        'Could not record demo SOS alert',
        formatFirestoreErrorMessage(err, 'Firestore error')
      );
    } finally {
      setSosSubmitting(false);
    }
  };

  const handleUpdateSosStatus = async (
    sosId: string,
    status: 'acknowledged' | 'resolved'
  ) => {
    if (!circle || !user) return;
    setBusyId(sosId);
    try {
      await updateSosEventStatus(
        circle.id,
        sosId,
        status,
        user.displayName || user.email || 'Caregiver'
      );
      pushToast('success', `Demo SOS alert ${status}`);
    } catch (err) {
      pushToast(
        'error',
        'Failed to update SOS status',
        formatFirestoreErrorMessage(err, 'Firestore error')
      );
    } finally {
      setBusyId(null);
    }
  };

  const handleSaveEmailSettings = async (payload: {
    notificationEmail: string;
    emailAlertsEnabled: boolean;
    missedDoseThresholdMinutes: number;
  }) => {
    if (!circle) return;
    try {
      await updateCareCircleSettings(circle.id, payload);
      pushToast('success', 'Email notification preferences saved');
    } catch (err) {
      pushToast(
        'error',
        'Failed to save email preferences',
        formatFirestoreErrorMessage(err, 'Firestore error')
      );
    }
  };

  const handleSendTestNotification = async (email: string) => {
    if (!circle) return;
    const subject = `ELDERCARE AI Alert Check for ${circle.elderName}`;
    const bodyText = `This is a notification setup verification for ${circle.elderName}'s Care Circle in ELDERCARE AI.`;
    try {
      const result = await sendEmailNotification({
        circleId: circle.id,
        recipientEmail: email,
        subject,
        bodyText,
      });

      await createNotificationLog(
        circle.id,
        circle.ownerId,
        email,
        subject,
        'test_setup',
        result.deliveryStatus,
        result.detail,
        activeMemberUids
      );

      if (result.delivered) {
        pushToast('success', 'Test email dispatched via SMTP', result.detail);
      } else {
        pushToast('info', 'Email check logged (SMTP not configured)', result.detail);
      }
    } catch (err) {
      const detail = err instanceof Error ? err.message : 'Email request failed';
      await createNotificationLog(
        circle.id,
        circle.ownerId,
        email,
        subject,
        'test_setup',
        'failed',
        detail,
        activeMemberUids
      ).catch(() => {});
      pushToast('error', 'Email test failed', detail);
    }
  };

  const handleUpdateEmergencyContact = async (
    name: string,
    phone: string,
    elderPhone: string
  ) => {
    if (!circle) return;
    try {
      await updateCareCircleSettings(circle.id, {
        emergencyContactName: name,
        emergencyContactPhone: phone,
        elderPhone,
      });
      pushToast('success', 'CareCircle contact settings updated');
    } catch (err) {
      pushToast(
        'error',
        'Could not update contact settings',
        formatFirestoreErrorMessage(err, 'Firestore error')
      );
    }
  };

  const handleGenerateAiRoutine = async (
    focus: string,
    question: string
  ): Promise<AiRoutineResponse | null> => {
    if (!circle) return null;
    try {
      const plan = await generateAiHealthRoutine({
        circleId: circle.id,
        elderName: circle.elderName,
        elderAge: circle.elderAge,
        focus,
        question,
        medications,
        upcomingAppointments: appointments,
      });
      pushToast('success', 'AI health routine ready');
      return plan;
    } catch (err) {
      if (err instanceof AiConfigurationPendingError) {
        pushToast('info', 'AI Assistant — Configuration Pending', err.message);
        return null;
      }
      pushToast(
        'error',
        'AI Routine Assistant unavailable',
        err instanceof Error ? err.message : 'Could not reach Gemini API'
      );
      return null;
    }
  };

  const handleSaveAiRoutine = async (focus: string, plan: AiRoutineResponse) => {
    if (!circle || !user) return;
    try {
      await saveAiRoutine(
        circle.id,
        circle.ownerId,
        user.uid,
        {
          promptFocus: focus,
          summary: plan.summary,
          morningPlan: plan.morningPlan,
          afternoonPlan: plan.afternoonPlan,
          eveningPlan: plan.eveningPlan,
          safetyTip: plan.safetyTip,
        },
        activeMemberUids
      );
      pushToast('success', 'AI routine saved to Care Circle');
    } catch (err) {
      pushToast(
        'error',
        'Could not save AI routine',
        formatFirestoreErrorMessage(err, 'Firestore error')
      );
    }
  };

  const handleDeleteAiRoutine = async (routineId: string) => {
    if (!circle) return;
    try {
      await deleteAiRoutine(circle.id, routineId);
      pushToast('info', 'Saved routine deleted');
    } catch (err) {
      pushToast(
        'error',
        'Failed to delete routine',
        formatFirestoreErrorMessage(err, 'Firestore error')
      );
    }
  };

  const handleCreateInvite = async (
    invitedRole: DashboardRole,
    invitedEmail?: string
  ): Promise<CircleInvite | null> => {
    if (!circle || !user || !isOwner) return null;
    try {
      const inv = await createCircleInvite(circle, user.uid, invitedRole, invitedEmail);
      pushToast(
        'success',
        'Care Circle invite created',
        `Share code ${inv.inviteCode} (${invitedRole} role).`
      );
      return inv;
    } catch (err) {
      pushToast(
        'error',
        'Could not create invite',
        formatFirestoreErrorMessage(err, 'Firestore error')
      );
      return null;
    }
  };

  const handleRevokeInvite = async (inviteCode: string) => {
    if (!isOwner) return;
    try {
      await revokeCircleInvite(inviteCode);
      pushToast('info', `Invite ${inviteCode} revoked`);
    } catch (err) {
      pushToast(
        'error',
        'Failed to revoke invite',
        formatFirestoreErrorMessage(err, 'Firestore error')
      );
    }
  };

  const handleUpdateMemberRole = async (memberUid: string, nextRole: DashboardRole) => {
    if (!circle || !isOwner) return;
    try {
      await updateCircleMemberRole(circle.id, memberUid, nextRole);
      pushToast('success', `Member role updated to ${nextRole}`);
    } catch (err) {
      pushToast(
        'error',
        'Failed to update member role',
        formatFirestoreErrorMessage(err, 'Firestore error')
      );
    }
  };

  const handleRemoveMember = async (memberUid: string) => {
    if (!circle || !isOwner) return;
    try {
      const nextUids = sanitizeMemberUids(
        members.filter((m) => m.uid !== memberUid).map((m) => m.uid),
        circle.ownerId
      );
      await syncCircleMemberUids(circle.id, circle.ownerId, nextUids);
      await removeCircleMember(circle.id, memberUid);
      pushToast('info', 'Member removed from Care Circle');
    } catch (err) {
      pushToast(
        'error',
        'Failed to remove member',
        formatFirestoreErrorMessage(err, 'Firestore error')
      );
    }
  };

  const handleSyncMembersNow = async () => {
    if (!circle || !isOwner || syncingMembers) return;
    setSyncingMembers(true);
    try {
      const targetUids = sanitizeMemberUids(
        members.map((m) => m.uid),
        circle.ownerId
      );
      await syncCircleMemberUids(circle.id, circle.ownerId, targetUids);
      lastSyncedKeyRef.current = `${circle.id}:${targetUids.join(',')}`;
      pushToast(
        'success',
        'Care Circle records synchronized',
        `Shared access updated for ${targetUids.length} active member${targetUids.length === 1 ? '' : 's'}.`
      );
    } catch (err) {
      pushToast(
        'error',
        'Could not sync shared records',
        formatFirestoreErrorMessage(err, 'Firestore error')
      );
    } finally {
      setSyncingMembers(false);
    }
  };

  const handleJoinCircleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || joiningCircle) return;
    setJoiningCircle(true);
    setJoinError(null);
    try {
      const joined = await joinCareCircleByInvite(user, inviteCodeInput);
      setJoinModalOpen(false);
      setInviteCodeInput('');
      setRole(joined.role);
      await initializeWorkspace(user);
      pushToast(
        'success',
        `Joined ${joined.elderName}’s Care Circle`,
        `Your account is assigned to the ${joined.role} view.`
      );
    } catch (err) {
      const msg = formatFirestoreErrorMessage(err, 'Unable to redeem invite code.');
      setJoinError(msg);
    } finally {
      setJoiningCircle(false);
    }
  };

  const handleLeaveCircle = async () => {
    if (!user || !circle || isOwner) return;
    try {
      await leaveCareCircle(user, circle.id);
      pushToast('info', `Left ${circle.elderName}’s Care Circle`);
      await initializeWorkspace(user);
    } catch (err) {
      pushToast(
        'error',
        'Could not leave Care Circle',
        formatFirestoreErrorMessage(err, 'Firestore error')
      );
    }
  };

  // Loading auth state
  if (!authReady) {
    return (
      <div className="min-h-screen bg-[#F8FAFC] flex items-center justify-center p-6">
        <div className="text-center space-y-3">
          <div className="w-10 h-10 border-4 border-teal-700 border-t-transparent rounded-full animate-spin mx-auto" />
          <p className="text-base font-semibold text-slate-700">Connecting to ELDERCARE AI...</p>
        </div>
      </div>
    );
  }

  // Unauthenticated Sign-In Screen
  if (!user) {
    return (
      <div className="min-h-screen bg-[#F8FAFC] text-slate-900 flex flex-col">
        <ToastBanner toasts={toasts} onDismiss={dismissToast} />
        <header className="h-16 px-6 border-b border-slate-200 bg-white flex items-center justify-between gap-8">
          <span className="text-xl font-extrabold tracking-tight text-slate-900 whitespace-nowrap shrink-0">
            ELDERCARE AI
          </span>
          <button
            type="button"
            disabled={signingIn}
            onClick={handleGoogleSignIn}
            className="min-h-[44px] px-5 rounded-xl bg-teal-700 text-white text-sm font-semibold hover:bg-teal-800 disabled:opacity-50 whitespace-nowrap shrink-0"
          >
            {signingIn ? 'Signing in...' : 'Sign In with Google'}
          </button>
        </header>

        <main className="flex-1 max-w-6xl w-full mx-auto px-6 py-12 flex flex-col justify-center gap-12">
          <section className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-center">
            <div className="lg:col-span-7 space-y-6">
              <p className="text-sm font-semibold text-teal-800">
                Elderly Care · Medication Adherence · Family Coordination
              </p>
              <h1 className="text-4xl sm:text-5xl font-extrabold text-slate-900 tracking-tight leading-[1.12]">
                Calm, reliable daily medication care for seniors and their families.
              </h1>
              <p className="text-lg text-slate-600 leading-relaxed max-w-2xl">
                ELDERCARE AI unites an extra-clear Elderly Dashboard, a Caretaker Scheduling &
                Triage Console, and a Family Adherence Analytics & AI Routine Assistant in one
                mobile-first platform.
              </p>
              <div className="flex flex-wrap items-center gap-4 pt-2">
                <button
                  type="button"
                  disabled={signingIn}
                  onClick={handleGoogleSignIn}
                  className="min-h-[56px] px-7 rounded-2xl bg-teal-700 text-white font-bold text-base hover:bg-teal-800 disabled:opacity-50 flex items-center gap-3 shadow-sm"
                >
                  <Shield className="w-5 h-5" aria-hidden="true" />
                  <span>{signingIn ? 'Opening Google Sign-In...' : 'Sign In with Google to Start'}</span>
                </button>
              </div>
              {pendingInviteFromUrl && (
                <div className="p-3.5 rounded-2xl bg-teal-50 border border-teal-200 text-sm text-teal-950">
                  <strong>Care Circle Invite Detected ({pendingInviteFromUrl}):</strong> Sign in
                  with Google above to accept and join this shared Care Circle.
                </div>
              )}
              <p className="text-xs text-slate-500">
                Includes instant sample Care Circle data on first sign-in for live demonstration.
              </p>
            </div>

            <div className="lg:col-span-5 grid grid-cols-1 gap-4">
              <div className="bg-white rounded-3xl border border-slate-200 p-5 flex items-center gap-4">
                <AvatarImg
                  src="/src/assets/images/elderly_avatar_1794717420507.jpg"
                  alt="Elderly resident"
                  fallbackInitials="EL"
                  className="w-16 h-16"
                />
                <div>
                  <h2 className="text-base font-bold text-slate-900">Elderly User Dashboard</h2>
                  <p className="text-sm text-slate-600 mt-0.5">
                    Extra-large buttons, clear times, one-tap dose confirmation, and Demo SOS.
                  </p>
                </div>
              </div>

              <div className="bg-white rounded-3xl border border-slate-200 p-5 flex items-center gap-4">
                <AvatarImg
                  src="/src/assets/images/caretaker_avatar_1794717419943.jpg"
                  alt="Caretaker nurse"
                  fallbackInitials="CT"
                  className="w-16 h-16"
                />
                <div>
                  <h2 className="text-base font-bold text-slate-900">Caretaker Console</h2>
                  <p className="text-sm text-slate-600 mt-0.5">
                    Medication & appointment CRUD, missed-dose alerts, and refill tracking.
                  </p>
                </div>
              </div>

              <div className="bg-white rounded-3xl border border-slate-200 p-5 flex items-center gap-4">
                <AvatarImg
                  src="/src/assets/images/family_avatar_1794717421433.jpg"
                  alt="Family member"
                  fallbackInitials="FM"
                  className="w-16 h-16"
                />
                <div>
                  <h2 className="text-base font-bold text-slate-900">Family & Gemini AI</h2>
                  <p className="text-sm text-slate-600 mt-0.5">
                    7-day adherence analytics, honest SMTP alert setup, and AI daily routines.
                  </p>
                </div>
              </div>
            </div>
          </section>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#F8FAFC] text-slate-900 pb-20 md:pb-10">
      <ToastBanner toasts={toasts} onDismiss={dismissToast} />

      {/* 3-Zone Top Bar (Height 52px on mobile to honor <=15% sticky cap) */}
      <header className="sticky top-0 z-30 h-[52px] md:h-16 bg-white/95 backdrop-blur-md border-b border-slate-200 px-4 sm:px-6 flex items-center justify-between gap-8">
        <span className="text-lg font-extrabold tracking-tight text-slate-900 whitespace-nowrap shrink-0">
          ELDERCARE AI
        </span>

        {/* Desktop Role Switcher (Owner) or Assigned Role Badge (Invited Member) */}
        {isOwner || !circle ? (
          <nav
            aria-label="Dashboard role selector"
            className="hidden md:flex items-center gap-1 p-1 bg-slate-100 rounded-xl"
          >
            <button
              type="button"
              onClick={() => handleRoleChange('elderly')}
              className={`min-h-[38px] px-4 rounded-lg text-sm font-semibold whitespace-nowrap shrink-0 transition-colors ${
                effectiveRole === 'elderly'
                  ? 'bg-white text-slate-900 shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Elderly View
            </button>
            <button
              type="button"
              onClick={() => handleRoleChange('caretaker')}
              className={`min-h-[38px] px-4 rounded-lg text-sm font-semibold whitespace-nowrap shrink-0 transition-colors ${
                effectiveRole === 'caretaker'
                  ? 'bg-white text-slate-900 shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Caretaker
            </button>
            <button
              type="button"
              onClick={() => handleRoleChange('family')}
              className={`min-h-[38px] px-4 rounded-lg text-sm font-semibold whitespace-nowrap shrink-0 transition-colors ${
                effectiveRole === 'family'
                  ? 'bg-white text-slate-900 shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Family &amp; AI
            </button>
          </nav>
        ) : (
          <div className="hidden md:flex items-center gap-2 px-3.5 py-1.5 rounded-xl bg-teal-50 border border-teal-200 text-xs font-bold text-teal-900">
            <Lock className="w-3.5 h-3.5" aria-hidden="true" />
            <span className="capitalize">
              Assigned Role: {effectiveRole === 'family' ? 'Family & AI' : effectiveRole}
            </span>
          </div>
        )}

        <div className="flex items-center gap-3 shrink-0">
          <button
            type="button"
            onClick={handleSignOut}
            className="min-h-[40px] px-3.5 rounded-xl border border-slate-300 bg-white text-slate-800 text-xs sm:text-sm font-semibold flex items-center gap-1.5 hover:bg-slate-50 whitespace-nowrap shrink-0"
          >
            <LogOut className="w-4 h-4" aria-hidden="true" />
            <span>Sign Out</span>
          </button>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 py-5 sm:py-7 space-y-5">
        {loadingWorkspace ? (
          <div className="bg-white rounded-3xl border border-slate-200 p-10 text-center space-y-3">
            <div className="w-8 h-8 border-4 border-teal-700 border-t-transparent rounded-full animate-spin mx-auto" />
            <p className="text-base font-semibold text-slate-700">
              Loading Care Circle and syncing Firestore data...
            </p>
          </div>
        ) : workspaceError || !circle ? (
          <div className="bg-white rounded-3xl border border-rose-200 p-8 max-w-xl mx-auto text-center space-y-4">
            <div className="w-12 h-12 rounded-2xl bg-rose-50 text-rose-700 flex items-center justify-center mx-auto">
              <AlertOctagon className="w-6 h-6" aria-hidden="true" />
            </div>
            <div className="space-y-1.5">
              <h2 className="text-xl font-bold text-slate-900">
                Care Circle Initialization Interrupted
              </h2>
              <p className="text-sm text-slate-600 leading-relaxed">
                {workspaceError ||
                  'Your Care Circle workspace could not be initialized. Please retry or sign in again.'}
              </p>
            </div>
            <div className="flex flex-wrap items-center justify-center gap-3 pt-2">
              <button
                type="button"
                onClick={() => user && initializeWorkspace(user)}
                className="min-h-[44px] px-5 rounded-xl bg-teal-700 text-white text-sm font-semibold hover:bg-teal-800 flex items-center gap-2"
              >
                <RefreshCw className="w-4 h-4" aria-hidden="true" />
                <span>Retry Workspace Setup</span>
              </button>
              <button
                type="button"
                onClick={handleSignOut}
                className="min-h-[44px] px-5 rounded-xl border border-slate-300 bg-white text-slate-700 text-sm font-semibold hover:bg-slate-50"
              >
                Sign Out
              </button>
            </div>
          </div>
        ) : (
          <>
            {/* Workspace Utility Strip below Top Bar */}
            <div className="flex flex-wrap items-center justify-between gap-3 text-sm text-slate-600">
              <div className="flex flex-wrap items-center gap-2">
                <Users className="w-4 h-4 text-teal-700 shrink-0" aria-hidden="true" />
                <span>
                  Care Circle for <strong className="text-slate-900">{circle.elderName}</strong>
                </span>
                <span aria-hidden="true">·</span>
                <span className="truncate max-w-[220px]">{user.email}</span>
                {!isOwner && (
                  <>
                    <span aria-hidden="true">·</span>
                    <span className="font-semibold text-teal-800 capitalize">
                      Invited ({effectiveRole})
                    </span>
                  </>
                )}
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setJoinError(null);
                    setJoinModalOpen(true);
                  }}
                  className="min-h-[40px] px-3.5 rounded-xl border border-slate-200 bg-white text-slate-700 text-xs font-semibold flex items-center gap-1.5 hover:bg-slate-50 whitespace-nowrap"
                >
                  <KeyRound className="w-3.5 h-3.5 text-teal-700" aria-hidden="true" />
                  <span>Join via Invite</span>
                </button>

                {!isOwner ? (
                  <button
                    type="button"
                    onClick={handleLeaveCircle}
                    className="min-h-[40px] px-3.5 rounded-xl border border-slate-200 bg-white text-rose-700 text-xs font-semibold hover:bg-rose-50 whitespace-nowrap"
                  >
                    Leave Circle
                  </button>
                ) : (
                  <button
                    type="button"
                    disabled={seedingDemo}
                    onClick={handleSeedDemo}
                    className="min-h-[40px] px-3.5 rounded-xl border border-slate-200 bg-white text-slate-700 text-xs font-semibold flex items-center gap-1.5 hover:bg-slate-50 whitespace-nowrap"
                  >
                    <RefreshCw
                      className={`w-3.5 h-3.5 ${seedingDemo ? 'animate-spin' : ''}`}
                      aria-hidden="true"
                    />
                    <span>{seedingDemo ? 'Seeding...' : 'Reset Sample Data'}</span>
                  </button>
                )}

                {effectiveRole !== 'elderly' && (
                  <button
                    type="button"
                    onClick={() => setSosModalOpen(true)}
                    className="hidden md:flex min-h-[40px] px-3.5 rounded-xl bg-rose-700 text-white text-xs font-bold items-center gap-1.5 hover:bg-rose-800 whitespace-nowrap"
                  >
                    <AlertOctagon className="w-3.5 h-3.5" aria-hidden="true" />
                    <span>Demo SOS</span>
                  </button>
                )}
              </div>
            </div>

            {!isOwner && medications.length === 0 && doseLogs.length === 0 && (
              <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4 text-sm text-amber-950">
                <strong>Waiting for historical Care Circle sync:</strong> You joined{' '}
                <strong>{circle.elderName}</strong>’s Care Circle as{' '}
                <strong className="capitalize">{effectiveRole}</strong>. Historical medications and
                logs will appear automatically once the Care Circle owner opens ELDERCARE AI (or
                clicks <em>Sync Shared Records</em>).
              </div>
            )}

            {effectiveRole === 'elderly' && (
              <ElderlyDashboard
                circle={circle}
                medications={medications}
                doseLogs={doseLogs}
                appointments={appointments}
                sosEvents={sosEvents}
                latestRoutine={aiRoutines[0] || null}
                busyMedId={busyId}
                onLogDose={(med, status, existingLog) =>
                  handleRecordDose(med, status, existingLog)
                }
                onOpenSos={() => setSosModalOpen(true)}
                onQuickAiQuestion={(q) =>
                  handleGenerateAiRoutine(
                    'Simple daily routine check-in for senior',
                    q
                  )
                }
              />
            )}

            {effectiveRole === 'caretaker' && (
              <CaretakerDashboard
                circle={circle}
                medications={medications}
                doseLogs={doseLogs}
                appointments={appointments}
                sosEvents={sosEvents}
                notificationLogs={notificationLogs}
                busyId={busyId}
                onCreateMedication={handleCreateMedication}
                onUpdateMedication={handleUpdateMedication}
                onDeleteMedication={handleDeleteMedication}
                onRecordDose={handleRecordDose}
                onAcknowledgeDoseAlert={handleAcknowledgeDoseAlert}
                onCreateAppointment={handleCreateAppointment}
                onUpdateAppointmentDetails={handleUpdateAppointmentDetails}
                onUpdateAppointmentStatus={handleUpdateAppointmentStatus}
                onDeleteAppointment={handleDeleteAppointment}
                onSendAppointmentReminder={handleSendAppointmentReminder}
                onUpdateSosStatus={handleUpdateSosStatus}
              />
            )}

            {effectiveRole === 'family' && (
              <FamilyDashboard
                circle={circle}
                isOwner={isOwner}
                currentUserUid={user.uid}
                members={members}
                invites={invites}
                syncingMembers={syncingMembers}
                medications={medications}
                doseLogs={doseLogs}
                appointments={appointments}
                sosEvents={sosEvents}
                notificationLogs={notificationLogs}
                aiRoutines={aiRoutines}
                onSaveEmailSettings={handleSaveEmailSettings}
                onSendTestNotification={handleSendTestNotification}
                onGenerateAiRoutine={handleGenerateAiRoutine}
                onSaveAiRoutine={handleSaveAiRoutine}
                onDeleteAiRoutine={handleDeleteAiRoutine}
                onUpdateEmergencyContact={handleUpdateEmergencyContact}
                onCreateInvite={handleCreateInvite}
                onRevokeInvite={handleRevokeInvite}
                onUpdateMemberRole={handleUpdateMemberRole}
                onRemoveMember={handleRemoveMember}
                onSyncMembersNow={handleSyncMembersNow}
                onReportFeedback={pushToast}
              />
            )}
          </>
        )}
      </main>

      {/* Mobile Fixed Thumb-Zone Bottom Bar (60px height) */}
      <nav
        aria-label="Mobile dashboard navigation"
        className={`md:hidden fixed bottom-0 left-0 right-0 z-40 h-[60px] bg-white/95 backdrop-blur-md border-t border-slate-200 grid ${
          isOwner || !circle ? 'grid-cols-4' : 'grid-cols-3'
        } items-center`}
      >
        {(isOwner || !circle || effectiveRole === 'elderly') && (
          <button
            type="button"
            onClick={() => isOwner && handleRoleChange('elderly')}
            className={`h-full flex flex-col items-center justify-center gap-0.5 ${
              effectiveRole === 'elderly' ? 'text-teal-700 font-bold' : 'text-slate-600 font-medium'
            }`}
          >
            <HeartHandshake className="w-5 h-5" aria-hidden="true" />
            <span className="text-[11px] whitespace-nowrap">Elderly</span>
          </button>
        )}

        {(isOwner || !circle || effectiveRole === 'caretaker') && (
          <button
            type="button"
            onClick={() => isOwner && handleRoleChange('caretaker')}
            className={`h-full flex flex-col items-center justify-center gap-0.5 ${
              effectiveRole === 'caretaker' ? 'text-teal-700 font-bold' : 'text-slate-600 font-medium'
            }`}
          >
            <Stethoscope className="w-5 h-5" aria-hidden="true" />
            <span className="text-[11px] whitespace-nowrap">Caretaker</span>
          </button>
        )}

        {(isOwner || !circle || effectiveRole === 'family') && (
          <button
            type="button"
            onClick={() => isOwner && handleRoleChange('family')}
            className={`h-full flex flex-col items-center justify-center gap-0.5 ${
              effectiveRole === 'family' ? 'text-teal-700 font-bold' : 'text-slate-600 font-medium'
            }`}
          >
            <BarChart3 className="w-5 h-5" aria-hidden="true" />
            <span className="text-[11px] whitespace-nowrap">Family &amp; AI</span>
          </button>
        )}

        {!isOwner && circle && (
          <button
            type="button"
            onClick={() => {
              setJoinError(null);
              setJoinModalOpen(true);
            }}
            className="h-full flex flex-col items-center justify-center gap-0.5 text-slate-700 font-medium"
          >
            <KeyRound className="w-5 h-5" aria-hidden="true" />
            <span className="text-[11px] whitespace-nowrap">Invite Code</span>
          </button>
        )}

        <button
          type="button"
          onClick={() => setSosModalOpen(true)}
          className="h-full flex flex-col items-center justify-center gap-0.5 text-rose-700 font-bold"
        >
          <AlertOctagon className="w-5 h-5" aria-hidden="true" />
          <span className="text-[11px] whitespace-nowrap">SOS Demo</span>
        </button>
      </nav>

      {/* Join Care Circle Modal */}
      {joinModalOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="join-circle-title"
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-slate-950/60 backdrop-blur-sm p-0 sm:p-4"
        >
          <div className="w-full sm:max-w-md bg-white rounded-t-3xl sm:rounded-3xl border border-slate-200 shadow-2xl p-6 space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-slate-200">
              <div className="flex items-center gap-2">
                <KeyRound className="w-5 h-5 text-teal-700" aria-hidden="true" />
                <h2 id="join-circle-title" className="text-lg font-bold text-slate-900">
                  Join Shared Care Circle
                </h2>
              </div>
              <button
                type="button"
                onClick={() => setJoinModalOpen(false)}
                aria-label="Close modal"
                className="min-h-[40px] min-w-[40px] flex items-center justify-center rounded-xl hover:bg-slate-100"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <p className="text-sm text-slate-600 leading-relaxed">
              Enter the single-use invite code shared by a Care Circle owner (generated in{' '}
              <strong>Family &amp; AI → Care Circle Team</strong>). Your account will be locked to
              the role assigned by that invite.
            </p>

            <form onSubmit={handleJoinCircleSubmit} className="space-y-4">
              {joinError && (
                <p className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-xs sm:text-sm text-rose-800">
                  {joinError}
                </p>
              )}
              <div>
                <label className="block text-sm font-semibold text-slate-800 mb-1">
                  Invite Code
                </label>
                <input
                  type="text"
                  required
                  minLength={8}
                  maxLength={64}
                  value={inviteCodeInput}
                  onChange={(e) => setInviteCodeInput(e.target.value.toUpperCase())}
                  placeholder="CARE_XXXXXXXXXX"
                  className="w-full min-h-[46px] px-3.5 rounded-xl border border-slate-300 text-sm font-mono uppercase"
                />
              </div>

              <div className="flex gap-3 pt-1">
                <button
                  type="button"
                  onClick={() => setJoinModalOpen(false)}
                  className="w-1/2 min-h-[46px] rounded-xl border border-slate-300 text-slate-800 font-semibold text-sm"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={joiningCircle || !inviteCodeInput.trim()}
                  className="w-1/2 min-h-[46px] rounded-xl bg-teal-700 text-white font-semibold text-sm hover:bg-teal-800 disabled:opacity-50"
                >
                  {joiningCircle ? 'Joining...' : 'Join Care Circle'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {circle && (
        <SosModal
          open={sosModalOpen}
          circle={circle}
          submitting={sosSubmitting}
          onClose={() => setSosModalOpen(false)}
          onConfirmSos={handleConfirmSos}
        />
      )}
    </div>
  );
}
