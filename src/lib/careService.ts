import {
  collection,
  deleteDoc,
  deleteField,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  writeBatch,
  type Unsubscribe,
} from 'firebase/firestore';
import type { User } from 'firebase/auth';
import { db, handleFirestoreError, OperationType } from './firebase';
import { getLocalDateString, getLocalDateTimeIso, getOffsetDateString } from './analytics';
import type {
  AiRoutine,
  Appointment,
  AppointmentStatus,
  CareCircle,
  CircleInvite,
  CircleMember,
  DashboardRole,
  DeliveryStatus,
  DoseLog,
  DoseStatus,
  Medication,
  NotificationEventType,
  NotificationLog,
  SosEvent,
  SosStatus,
  TimeSlot,
  UserProfile,
} from '../types';

function makeId(prefix: string): string {
  const rand = Math.random().toString(36).slice(2, 8);
  return `${prefix}_${Date.now()}_${rand}`.replace(/[^a-zA-Z0-9_\-]/g, '');
}

function clampStr(value: string | null | undefined, max: number): string {
  return (value ?? '').trim().slice(0, max);
}

export function sanitizeMemberUids(
  memberUids: string[] | undefined,
  ownerId: string,
  extraUid?: string
): string[] {
  const seen = new Set<string>();
  const addIfValid = (id: unknown) => {
    if (typeof id === 'string' && id.length >= 1 && id.length <= 128 && /^[a-zA-Z0-9_\-]+$/.test(id)) {
      seen.add(id);
    }
  };
  addIfValid(ownerId);
  if (Array.isArray(memberUids)) {
    for (const id of memberUids) addIfValid(id);
  }
  if (extraUid) addIfValid(extraUid);
  return Array.from(seen).slice(0, 10);
}

function generateInviteCode(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let suffix = '';
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    const bytes = new Uint8Array(10);
    crypto.getRandomValues(bytes);
    for (let i = 0; i < bytes.length; i++) {
      suffix += alphabet[bytes[i] % alphabet.length];
    }
  } else {
    for (let i = 0; i < 10; i++) {
      suffix += alphabet[Math.floor(Math.random() * alphabet.length)];
    }
  }
  return `CARE_${suffix}`;
}

export async function ensureUserProfile(user: User): Promise<UserProfile> {
  const path = `users/${user.uid}`;
  const ref = doc(db, 'users', user.uid);
  let snap;
  try {
    snap = await getDoc(ref);
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, path);
  }

  if (snap.exists()) {
    return snap.data() as UserProfile;
  }

  const safeDisplayName =
    clampStr(user.displayName, 100) ||
    clampStr(user.email?.split('@')[0], 100) ||
    'Caregiver';
  const safeEmail =
    clampStr(user.email, 160) || `${user.uid.slice(0, 16)}@user.local`;

  const profile: UserProfile = {
    uid: user.uid,
    displayName: safeDisplayName,
    email: safeEmail,
    activeRole: 'elderly',
  };

  try {
    await setDoc(ref, {
      ...profile,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    return profile;
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
  }
}

export async function updateUserActiveRole(uid: string, activeRole: DashboardRole): Promise<void> {
  const path = `users/${uid}`;
  try {
    await updateDoc(doc(db, 'users', uid), {
      activeRole,
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

async function runInChunks<T>(
  items: T[],
  chunkSize: number,
  worker: (item: T) => Promise<void>
): Promise<void> {
  for (let i = 0; i < items.length; i += chunkSize) {
    const chunk = items.slice(i, i + chunkSize);
    await Promise.all(chunk.map((item) => worker(item)));
  }
}

export async function ensureOrCreateCareCircle(user: User): Promise<CareCircle> {
  const userPath = `users/${user.uid}`;
  const userRef = doc(db, 'users', user.uid);
  let userSnap;
  try {
    userSnap = await getDoc(userRef);
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, userPath);
  }

  const userProfileData = userSnap.exists() ? (userSnap.data() as Partial<UserProfile>) : {};
  let resolvedDocId: string | null = null;
  let resolvedData: Omit<CareCircle, 'id'> | null = null;

  // 1. Prefer linked defaultCircleId (covers both owned circles and joined shared circles)
  if (userProfileData.defaultCircleId) {
    try {
      const linkedSnap = await getDoc(doc(db, 'careCircles', userProfileData.defaultCircleId));
      if (linkedSnap.exists()) {
        resolvedDocId = linkedSnap.id;
        resolvedData = linkedSnap.data() as Omit<CareCircle, 'id'>;
      }
    } catch {
      // Membership may have been revoked; clear stale link and fall through to owned/member lookup
      try {
        await updateDoc(userRef, {
          defaultCircleId: deleteField(),
          updatedAt: serverTimestamp(),
        });
      } catch {
        // Ignore cleanup failure
      }
    }
  }

  // 2. Look up owned Care Circles or shared Care Circles where user is a verified member
  if (!resolvedData) {
    const colPath = 'careCircles';
    try {
      const [ownedSnap, sharedSnap] = await Promise.all([
        getDocs(query(collection(db, colPath), where('ownerId', '==', user.uid))),
        getDocs(query(collection(db, colPath), where('memberUids', 'array-contains', user.uid))),
      ]);

      // Verify membership subcollection doc exists for any non-owned shared circle
      let verifiedSharedDoc = null;
      for (const candidate of sharedSnap.docs) {
        if (candidate.data().ownerId === user.uid) continue;
        try {
          const memberSnap = await getDoc(
            doc(db, colPath, candidate.id, 'members', user.uid)
          );
          if (memberSnap.exists()) {
            verifiedSharedDoc = candidate;
            break;
          }
        } catch {
          // Ignore stale or unverified memberUids entries on foreign circles
        }
      }

      const pickDoc = verifiedSharedDoc || ownedSnap.docs[0] || null;
      if (pickDoc) {
        resolvedDocId = pickDoc.id;
        resolvedData = pickDoc.data() as Omit<CareCircle, 'id'>;
      }
    } catch (error) {
      handleFirestoreError(error, OperationType.LIST, colPath);
    }
  }

  if (resolvedDocId && resolvedData) {
    const circleId = resolvedDocId;
    const isOwner = resolvedData.ownerId === user.uid;
    let elderPhone = resolvedData.elderPhone;
    let memberUids = resolvedData.memberUids;

    // Owner-only maintenance: ensure elderPhone, bounded memberUids, and owner membership record exist
    if (isOwner) {
      const ownerPatch: Record<string, unknown> = {};
      if (!elderPhone) {
        const defaultPhone = '+1 (555) 890-4123';
        ownerPatch.elderPhone = defaultPhone;
        elderPhone = defaultPhone;
      }
      if (!Array.isArray(memberUids) || memberUids.length === 0 || !memberUids.includes(user.uid)) {
        const nextUids = sanitizeMemberUids(memberUids, resolvedData.ownerId, user.uid);
        ownerPatch.memberUids = nextUids;
        memberUids = nextUids;
      }
      if (Object.keys(ownerPatch).length > 0) {
        ownerPatch.updatedAt = serverTimestamp();
        try {
          await updateDoc(doc(db, 'careCircles', circleId), ownerPatch);
        } catch (error) {
          handleFirestoreError(error, OperationType.UPDATE, `careCircles/${circleId}`);
        }
      }

      const memberPath = `careCircles/${circleId}/members/${user.uid}`;
      const memberRef = doc(db, 'careCircles', circleId, 'members', user.uid);
      try {
        const memberSnap = await getDoc(memberRef);
        if (!memberSnap.exists()) {
          const safeMemberName =
            clampStr(user.displayName, 100) ||
            clampStr(user.email?.split('@')[0], 100) ||
            'Care Coordinator';
          await setDoc(memberRef, {
            uid: user.uid,
            circleId,
            ownerId: resolvedData.ownerId,
            displayName: safeMemberName,
            role: 'caretaker',
            addedBy: user.uid,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          });
        }
      } catch (error) {
        handleFirestoreError(error, OperationType.WRITE, memberPath);
      }

      const needsOnboardingCompletion = userProfileData.defaultCircleId !== circleId;
      if (needsOnboardingCompletion) {
        let medsSnap;
        let logsSnap;
        let apptsSnap;
        try {
          [medsSnap, logsSnap, apptsSnap] = await Promise.all([
            getDocs(
              query(
                collection(db, 'careCircles', circleId, 'medications'),
                where('ownerId', '==', resolvedData.ownerId)
              )
            ),
            getDocs(
              query(
                collection(db, 'careCircles', circleId, 'doseLogs'),
                where('ownerId', '==', resolvedData.ownerId)
              )
            ),
            getDocs(
              query(
                collection(db, 'careCircles', circleId, 'appointments'),
                where('ownerId', '==', resolvedData.ownerId)
              )
            ),
          ]);
        } catch (error) {
          handleFirestoreError(error, OperationType.LIST, `careCircles/${circleId}`);
        }

        const hasPartialDemoSeed =
          (medsSnap.empty && logsSnap.empty && apptsSnap.empty) ||
          (medsSnap.docs.some((d) => d.id === 'med_lisinopril') && apptsSnap.empty);

        if (hasPartialDemoSeed) {
          await seedDemoData(circleId, resolvedData.ownerId, user.uid, {
            resetExisting: false,
            memberUids,
          });
        }

        try {
          await updateDoc(userRef, {
            defaultCircleId: circleId,
            updatedAt: serverTimestamp(),
          });
        } catch (error) {
          handleFirestoreError(error, OperationType.UPDATE, userPath);
        }
      }
    } else if (userProfileData.defaultCircleId !== circleId) {
      try {
        await updateDoc(userRef, {
          defaultCircleId: circleId,
          updatedAt: serverTimestamp(),
        });
      } catch (error) {
        handleFirestoreError(error, OperationType.UPDATE, userPath);
      }
    }

    return { id: circleId, ...resolvedData, elderPhone, memberUids };
  }

  const circleId = `circle_${user.uid.slice(0, 100)}`.replace(/[^a-zA-Z0-9_\-]/g, '');
  const circleRef = doc(db, 'careCircles', circleId);
  const memberRef = doc(db, 'careCircles', circleId, 'members', user.uid);

  const safeContactName =
    clampStr(user.displayName, 100) ||
    clampStr(user.email?.split('@')[0], 100) ||
    'David Vance (Son)';
  const safeMemberName =
    clampStr(user.displayName, 100) ||
    clampStr(user.email?.split('@')[0], 100) ||
    'Care Coordinator';

  const initialMemberUids = [user.uid];

  const circleData = {
    ownerId: user.uid,
    elderName: 'Margaret Vance',
    elderAge: 76,
    elderPhone: '+1 (555) 890-4123',
    bloodType: 'O+',
    allergies: 'Penicillin (mild rash)',
    emergencyContactName: safeContactName,
    emergencyContactPhone: '+1 (555) 234-8910',
    notificationEmail: clampStr(user.email || '', 160),
    emailAlertsEnabled: true,
    missedDoseThresholdMinutes: 30,
    memberUids: initialMemberUids,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };

  // Step 1: Create CareCircle parent document first so subcollection security rules can read it
  try {
    await setDoc(circleRef, circleData);
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, `careCircles/${circleId}`);
  }

  // Step 2: Register owner membership record
  try {
    await setDoc(memberRef, {
      uid: user.uid,
      circleId,
      ownerId: user.uid,
      displayName: safeMemberName,
      role: 'caretaker',
      addedBy: user.uid,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(
      error,
      OperationType.CREATE,
      `careCircles/${circleId}/members/${user.uid}`
    );
  }

  // Step 3: Seed initial demonstration data before marking onboarding complete
  await seedDemoData(circleId, user.uid, user.uid, {
    resetExisting: false,
    memberUids: initialMemberUids,
  });

  // Step 4: Link user profile defaultCircleId once initial onboarding seed succeeds
  try {
    await updateDoc(userRef, {
      defaultCircleId: circleId,
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, `users/${user.uid}`);
  }

  try {
    const createdSnap = await getDoc(circleRef);
    return { id: circleId, ...(createdSnap.data() as Omit<CareCircle, 'id'>) };
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, `careCircles/${circleId}`);
  }
}

export async function seedDemoData(
  circleId: string,
  ownerId: string,
  uid: string,
  options: { resetExisting?: boolean; memberUids?: string[] } = {}
): Promise<void> {
  const path = `careCircles/${circleId}`;
  const resetExisting = Boolean(options.resetExisting);
  let memberUids = sanitizeMemberUids(options.memberUids, ownerId, uid);
  try {
    const parentCircleSnap = await getDoc(doc(db, 'careCircles', circleId));
    const parentUids = parentCircleSnap.exists() ? parentCircleSnap.data()?.memberUids : null;
    if (Array.isArray(parentUids) && parentUids.length > 0) {
      memberUids = sanitizeMemberUids(parentUids as string[], ownerId);
    }

    const [existingMedsSnap, existingLogsSnap, existingApptsSnap, existingRoutinesSnap] =
      await Promise.all([
        getDocs(query(collection(db, 'careCircles', circleId, 'medications'), where('ownerId', '==', ownerId))),
        getDocs(query(collection(db, 'careCircles', circleId, 'doseLogs'), where('ownerId', '==', ownerId))),
        getDocs(query(collection(db, 'careCircles', circleId, 'appointments'), where('ownerId', '==', ownerId))),
        getDocs(query(collection(db, 'careCircles', circleId, 'aiRoutines'), where('ownerId', '==', ownerId))),
      ]);

    const existingMedIds = new Set(existingMedsSnap.docs.map((d) => d.id));
    const existingLogIds = new Set(existingLogsSnap.docs.map((d) => d.id));
    const existingApptIds = new Set(existingApptsSnap.docs.map((d) => d.id));
    const existingRoutineIds = new Set(existingRoutinesSnap.docs.map((d) => d.id));

    const meds: Array<{
      id: string;
      name: string;
      dosage: string;
      scheduleTime: string;
      timeSlot: TimeSlot;
      withFood: boolean;
      instructions: string;
      stockCount: number;
    }> = [
      {
        id: 'med_lisinopril',
        name: 'Lisinopril',
        dosage: '10 mg tablet',
        scheduleTime: '08:00',
        timeSlot: 'morning',
        withFood: false,
        instructions: 'Take with a full glass of water for blood pressure support.',
        stockCount: 18,
      },
      {
        id: 'med_metformin',
        name: 'Metformin',
        dosage: '500 mg tablet',
        scheduleTime: '08:30',
        timeSlot: 'morning',
        withFood: true,
        instructions: 'Take immediately after breakfast to avoid stomach upset.',
        stockCount: 6,
      },
      {
        id: 'med_vitamind',
        name: 'Vitamin D3 + Calcium',
        dosage: '1000 IU / 500 mg',
        scheduleTime: '13:00',
        timeSlot: 'afternoon',
        withFood: true,
        instructions: 'Take with lunch for optimal bone health absorption.',
        stockCount: 24,
      },
      {
        id: 'med_atorvastatin',
        name: 'Atorvastatin',
        dosage: '20 mg tablet',
        scheduleTime: '20:30',
        timeSlot: 'night',
        withFood: false,
        instructions: 'Evening cholesterol support before bedtime.',
        stockCount: 14,
      },
    ];

    const todayStr = getLocalDateString();
    const futureDate1 = getOffsetDateString(-3); // 3 days ahead
    const futureDate2 = getOffsetDateString(-10); // 10 days ahead
    const pastDate1 = getOffsetDateString(7); // 7 days ago

    const appointments = [
      {
        id: 'appt_cardio_1',
        doctorName: 'Dr. Elena Rostova',
        specialty: 'Cardiology',
        clinicName: 'Oakridge Senior Heart Clinic',
        appointmentDate: futureDate1,
        appointmentTime: '10:30',
        purpose: 'Quarterly blood pressure review & Lisinopril follow-up',
        status: 'upcoming' as AppointmentStatus,
        notes: 'Bring 7-day home blood pressure log and morning medication list.',
      },
      {
        id: 'appt_primary_2',
        doctorName: 'Dr. Samuel Okafor',
        specialty: 'Geriatric Medicine',
        clinicName: 'Maple Street Family Practice',
        appointmentDate: futureDate2,
        appointmentTime: '14:15',
        purpose: 'A1C blood sugar check & Vitamin D panel',
        status: 'upcoming' as AppointmentStatus,
        notes: 'Fasting not required for afternoon check-in.',
      },
      {
        id: 'appt_optom_3',
        doctorName: 'Dr. Claire Lin',
        specialty: 'Ophthalmology',
        clinicName: 'ClearView Eye Center',
        appointmentDate: pastDate1,
        appointmentTime: '09:30',
        purpose: 'Annual retina & prescription glasses check',
        status: 'completed' as AppointmentStatus,
        notes: 'Prescription unchanged; next visit in 12 months.',
      },
    ];

    // If resetting sample data, delete existing demo docs first so fresh create rules apply cleanly
    if (resetExisting) {
      const deleteTasks: Array<() => Promise<void>> = [];

      for (const med of meds) {
        if (existingMedIds.has(med.id)) {
          deleteTasks.push(() =>
            deleteDoc(doc(db, 'careCircles', circleId, 'medications', med.id))
          );
        }
      }
      for (let dayOffset = 29; dayOffset >= 1; dayOffset--) {
        const dateStr = getOffsetDateString(dayOffset);
        for (const med of meds) {
          const logId = `${med.id}_${dateStr}`;
          if (existingLogIds.has(logId)) {
            deleteTasks.push(() =>
              deleteDoc(doc(db, 'careCircles', circleId, 'doseLogs', logId))
            );
          }
        }
      }
      const todayLogId = `med_lisinopril_${todayStr}`;
      if (existingLogIds.has(todayLogId)) {
        deleteTasks.push(() =>
          deleteDoc(doc(db, 'careCircles', circleId, 'doseLogs', todayLogId))
        );
      }
      for (const appt of appointments) {
        if (existingApptIds.has(appt.id)) {
          deleteTasks.push(() =>
            deleteDoc(doc(db, 'careCircles', circleId, 'appointments', appt.id))
          );
        }
      }
      if (existingRoutineIds.has('routine_initial')) {
        deleteTasks.push(() =>
          deleteDoc(doc(db, 'careCircles', circleId, 'aiRoutines', 'routine_initial'))
        );
      }

      if (deleteTasks.length > 0) {
        await runInChunks(deleteTasks, 15, (fn) => fn());
        existingMedIds.clear();
        existingLogIds.clear();
        existingApptIds.clear();
        existingRoutineIds.clear();
      }
    }

    // Use individual setDoc calls in parallel chunks rather than a single 125-doc writeBatch,
    // because Firestore enforces a hard cap of 20 get()/exists() rule lookups per batch.
    const createTasks: Array<() => Promise<void>> = [];

    for (const med of meds) {
      if (!existingMedIds.has(med.id)) {
        const medRef = doc(db, 'careCircles', circleId, 'medications', med.id);
        createTasks.push(() =>
          setDoc(medRef, {
            circleId,
            ownerId,
            name: med.name,
            dosage: med.dosage,
            scheduleTime: med.scheduleTime,
            timeSlot: med.timeSlot,
            withFood: med.withFood,
            instructions: med.instructions,
            stockCount: med.stockCount,
            active: true,
            createdBy: uid,
            memberUids,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          })
        );
      }
    }

    // Seed 29 prior days of adherence logs + today's sample morning log so the 30-day calendar & analytics work immediately
    for (let dayOffset = 29; dayOffset >= 1; dayOffset--) {
      const dateStr = getOffsetDateString(dayOffset);
      for (const med of meds) {
        const logId = `${med.id}_${dateStr}`;
        if (!existingLogIds.has(logId)) {
          const logRef = doc(db, 'careCircles', circleId, 'doseLogs', logId);
          const isMissed =
            (dayOffset === 2 && med.id === 'med_vitamind') ||
            (dayOffset === 4 && med.id === 'med_atorvastatin') ||
            (dayOffset === 11 && med.id === 'med_vitamind') ||
            (dayOffset === 17 && med.id === 'med_metformin') ||
            (dayOffset === 23 && med.id === 'med_atorvastatin');
          const status: DoseStatus = isMissed ? 'missed' : 'taken';
          createTasks.push(() =>
            setDoc(logRef, {
              circleId,
              ownerId,
              medicationId: med.id,
              medicationName: med.name,
              dosage: med.dosage,
              scheduledDate: dateStr,
              scheduledTime: med.scheduleTime,
              timeSlot: med.timeSlot,
              status,
              ...(status === 'taken' ? { takenAtIso: `${dateStr}T${med.scheduleTime}:00` } : {}),
              loggedBy: uid,
              note: isMissed ? 'Reported delayed during check-in' : 'Confirmed on schedule',
              alertAcknowledged: dayOffset > 2,
              memberUids,
              createdAt: serverTimestamp(),
              updatedAt: serverTimestamp(),
            })
          );
        }
      }
    }

    // Today: mark first morning med taken
    const todayLogId = `med_lisinopril_${todayStr}`;
    if (!existingLogIds.has(todayLogId)) {
      const todayTakenRef = doc(db, 'careCircles', circleId, 'doseLogs', todayLogId);
      createTasks.push(() =>
        setDoc(todayTakenRef, {
          circleId,
          ownerId,
          medicationId: 'med_lisinopril',
          medicationName: 'Lisinopril',
          dosage: '10 mg tablet',
          scheduledDate: todayStr,
          scheduledTime: '08:00',
          timeSlot: 'morning',
          status: 'taken',
          takenAtIso: `${todayStr}T08:06:00`,
          loggedBy: uid,
          note: 'Taken with warm tea',
          alertAcknowledged: true,
          memberUids,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        })
      );
    }

    for (const appt of appointments) {
      if (!existingApptIds.has(appt.id)) {
        const apptPath = `careCircles/${circleId}/appointments/${appt.id}`;
        const apptRef = doc(db, 'careCircles', circleId, 'appointments', appt.id);
        createTasks.push(async () => {
          try {
            await setDoc(apptRef, {
              circleId,
              ownerId,
              doctorName: appt.doctorName,
              specialty: appt.specialty,
              clinicName: appt.clinicName,
              appointmentDate: appt.appointmentDate,
              appointmentTime: appt.appointmentTime,
              purpose: appt.purpose,
              status: appt.status,
              notes: appt.notes,
              memberUids,
              createdAt: serverTimestamp(),
              updatedAt: serverTimestamp(),
            });
          } catch (error) {
            handleFirestoreError(error, OperationType.CREATE, apptPath);
          }
        });
      }
    }

    if (!existingRoutineIds.has('routine_initial')) {
      const routinePath = `careCircles/${circleId}/aiRoutines/routine_initial`;
      const routineRef = doc(db, 'careCircles', circleId, 'aiRoutines', 'routine_initial');
      createTasks.push(async () => {
        try {
          await setDoc(routineRef, {
            circleId,
            ownerId,
            promptFocus: 'Blood pressure balance, gentle morning mobility, and meal-paired dosing',
            summary:
              'A steady, gentle rhythm pairing morning medications with hydration and breakfast, followed by a short midday walk and calm evening wind-down.',
            morningPlan:
              '8:00 AM: Take Lisinopril 10 mg with a full glass of water. 8:30 AM: Enjoy oatmeal or toast with protein, then take Metformin 500 mg immediately after eating. Follow with 10 minutes of seated ankle and shoulder stretches.',
            afternoonPlan:
              '1:00 PM: Take Vitamin D3 + Calcium alongside lunch. Drink one glass of water mid-afternoon and take a slow 15-minute walk indoors or in the garden with supportive footwear.',
            eveningPlan:
              '8:30 PM: Take Atorvastatin 20 mg before preparing for bed. Dim bright screens 45 minutes prior to sleep and set out tomorrow’s morning water glass.',
            safetyTip:
              'Stand up slowly from bed or chairs for 10 seconds before walking to prevent blood-pressure dizziness, especially after morning Lisinopril.',
            createdBy: uid,
            memberUids,
            createdAt: serverTimestamp(),
          });
        } catch (error) {
          handleFirestoreError(error, OperationType.CREATE, routinePath);
        }
      });
    }

    if (createTasks.length > 0) {
      await runInChunks(createTasks, 15, (fn) => fn());
    }
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('{"error":')) {
      throw error;
    }
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

export function subscribeCareCircle(
  circleId: string,
  onData: (circle: CareCircle | null) => void
): Unsubscribe {
  const path = `careCircles/${circleId}`;
  return onSnapshot(
    doc(db, 'careCircles', circleId),
    (snap) => {
      if (!snap.exists()) {
        onData(null);
        return;
      }
      onData({ id: snap.id, ...(snap.data() as Omit<CareCircle, 'id'>) });
    },
    (error) => handleFirestoreError(error, OperationType.GET, path)
  );
}

export function subscribeOwnMembership(
  circleId: string,
  uid: string,
  onData: (member: CircleMember | null) => void
): Unsubscribe {
  const path = `careCircles/${circleId}/members/${uid}`;
  return onSnapshot(
    doc(db, 'careCircles', circleId, 'members', uid),
    (snap) => {
      if (!snap.exists()) {
        onData(null);
        return;
      }
      onData({ id: snap.id, ...(snap.data() as Omit<CircleMember, 'id'>) });
    },
    (error) => handleFirestoreError(error, OperationType.GET, path)
  );
}

export function subscribeCircleMembers(
  circleId: string,
  ownerId: string,
  onData: (members: CircleMember[]) => void
): Unsubscribe {
  const path = `careCircles/${circleId}/members`;
  const q = query(collection(db, 'careCircles', circleId, 'members'), where('ownerId', '==', ownerId));
  return onSnapshot(
    q,
    (snap) => {
      const items = snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<CircleMember, 'id'>) }));
      items.sort((a, b) => a.displayName.localeCompare(b.displayName));
      onData(items);
    },
    (error) => handleFirestoreError(error, OperationType.LIST, path)
  );
}

export function subscribeCircleInvites(
  ownerId: string,
  circleId: string,
  onData: (invites: CircleInvite[]) => void
): Unsubscribe {
  const path = 'circleInvites';
  const q = query(collection(db, 'circleInvites'), where('ownerId', '==', ownerId));
  return onSnapshot(
    q,
    (snap) => {
      const items = snap.docs
        .map((d) => ({ id: d.id, ...(d.data() as Omit<CircleInvite, 'id'>) }))
        .filter((inv) => inv.circleId === circleId);
      items.sort((a, b) => b.inviteCode.localeCompare(a.inviteCode));
      onData(items);
    },
    (error) => handleFirestoreError(error, OperationType.LIST, path)
  );
}

function buildMemberScopedQuery(
  circleId: string,
  subcollection: string,
  ownerId: string,
  viewerUid: string
) {
  const col = collection(db, 'careCircles', circleId, subcollection);
  return viewerUid === ownerId
    ? query(col, where('ownerId', '==', ownerId))
    : query(col, where('memberUids', 'array-contains', viewerUid));
}

export function subscribeMedications(
  circleId: string,
  ownerId: string,
  viewerUid: string,
  onData: (meds: Medication[]) => void
): Unsubscribe {
  const path = `careCircles/${circleId}/medications`;
  const q = buildMemberScopedQuery(circleId, 'medications', ownerId, viewerUid);
  return onSnapshot(
    q,
    (snap) => {
      const items = snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<Medication, 'id'>) }));
      items.sort((a, b) => a.scheduleTime.localeCompare(b.scheduleTime));
      onData(items);
    },
    (error) => handleFirestoreError(error, OperationType.LIST, path)
  );
}

export function subscribeDoseLogs(
  circleId: string,
  ownerId: string,
  viewerUid: string,
  onData: (logs: DoseLog[]) => void
): Unsubscribe {
  const path = `careCircles/${circleId}/doseLogs`;
  const q = buildMemberScopedQuery(circleId, 'doseLogs', ownerId, viewerUid);
  return onSnapshot(
    q,
    (snap) => {
      const items = snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<DoseLog, 'id'>) }));
      items.sort((a, b) => `${b.scheduledDate}_${b.scheduledTime}`.localeCompare(`${a.scheduledDate}_${a.scheduledTime}`));
      onData(items);
    },
    (error) => handleFirestoreError(error, OperationType.LIST, path)
  );
}

export function subscribeAppointments(
  circleId: string,
  ownerId: string,
  viewerUid: string,
  onData: (appts: Appointment[]) => void
): Unsubscribe {
  const path = `careCircles/${circleId}/appointments`;
  const q = buildMemberScopedQuery(circleId, 'appointments', ownerId, viewerUid);
  return onSnapshot(
    q,
    (snap) => {
      const items = snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<Appointment, 'id'>) }));
      items.sort((a, b) => `${a.appointmentDate}_${a.appointmentTime}`.localeCompare(`${b.appointmentDate}_${b.appointmentTime}`));
      onData(items);
    },
    (error) => handleFirestoreError(error, OperationType.LIST, path)
  );
}

export function subscribeSosEvents(
  circleId: string,
  ownerId: string,
  viewerUid: string,
  onData: (events: SosEvent[]) => void
): Unsubscribe {
  const path = `careCircles/${circleId}/sosEvents`;
  const q = buildMemberScopedQuery(circleId, 'sosEvents', ownerId, viewerUid);
  return onSnapshot(
    q,
    (snap) => {
      const items = snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<SosEvent, 'id'>) }));
      items.sort((a, b) => b.id.localeCompare(a.id));
      onData(items);
    },
    (error) => handleFirestoreError(error, OperationType.LIST, path)
  );
}

export function subscribeNotificationLogs(
  circleId: string,
  ownerId: string,
  viewerUid: string,
  onData: (logs: NotificationLog[]) => void
): Unsubscribe {
  const path = `careCircles/${circleId}/notificationLogs`;
  const q = buildMemberScopedQuery(circleId, 'notificationLogs', ownerId, viewerUid);
  return onSnapshot(
    q,
    (snap) => {
      const items = snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<NotificationLog, 'id'>) }));
      const toMs = (ts: unknown): number => {
        if (ts && typeof ts === 'object' && 'toMillis' in ts && typeof (ts as { toMillis: unknown }).toMillis === 'function') {
          return (ts as { toMillis: () => number }).toMillis();
        }
        return 0;
      };
      items.sort((a, b) => toMs(b.createdAt) - toMs(a.createdAt) || b.id.localeCompare(a.id));
      onData(items);
    },
    (error) => handleFirestoreError(error, OperationType.LIST, path)
  );
}

export function subscribeAiRoutines(
  circleId: string,
  ownerId: string,
  viewerUid: string,
  onData: (routines: AiRoutine[]) => void
): Unsubscribe {
  const path = `careCircles/${circleId}/aiRoutines`;
  const q = buildMemberScopedQuery(circleId, 'aiRoutines', ownerId, viewerUid);
  return onSnapshot(
    q,
    (snap) => {
      const items = snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<AiRoutine, 'id'>) }));
      items.sort((a, b) => b.id.localeCompare(a.id));
      onData(items);
    },
    (error) => handleFirestoreError(error, OperationType.LIST, path)
  );
}

// --- Multi-Member Care Circle Sharing & Invites ---

function sameUidList(a: unknown, target: string[]): boolean {
  if (!Array.isArray(a) || a.length !== target.length) return false;
  for (let i = 0; i < target.length; i++) {
    if (a[i] !== target[i]) return false;
  }
  return true;
}

export async function syncCircleMemberUids(
  circleId: string,
  ownerId: string,
  memberUids: string[]
): Promise<void> {
  const target = sanitizeMemberUids(memberUids, ownerId);
  const path = `careCircles/${circleId}`;
  try {
    const circleRef = doc(db, 'careCircles', circleId);
    const circleSnap = await getDoc(circleRef);
    if (!circleSnap.exists() || circleSnap.data()?.ownerId !== ownerId) return;

    // Update parent CareCircle.memberUids BEFORE subcollections so matchesCircleMemberUids() passes
    if (!sameUidList(circleSnap.data()?.memberUids, target)) {
      await updateDoc(circleRef, {
        memberUids: target,
        updatedAt: serverTimestamp(),
      });
    }

    const updateTasks: Array<() => Promise<void>> = [];

    const subcollectionsWithUpdatedAt = [
      'medications',
      'doseLogs',
      'appointments',
      'sosEvents',
    ] as const;

    const immutableTimestampCollections = ['notificationLogs', 'aiRoutines'] as const;

    const snaps = await Promise.all([
      ...subcollectionsWithUpdatedAt.map((sub) =>
        getDocs(query(collection(db, 'careCircles', circleId, sub), where('ownerId', '==', ownerId)))
      ),
      ...immutableTimestampCollections.map((sub) =>
        getDocs(query(collection(db, 'careCircles', circleId, sub), where('ownerId', '==', ownerId)))
      ),
    ]);

    subcollectionsWithUpdatedAt.forEach((sub, idx) => {
      for (const d of snaps[idx].docs) {
        if (!sameUidList(d.data()?.memberUids, target)) {
          updateTasks.push(() =>
            updateDoc(doc(db, 'careCircles', circleId, sub, d.id), {
              memberUids: target,
              updatedAt: serverTimestamp(),
            })
          );
        }
      }
    });

    immutableTimestampCollections.forEach((sub, idx) => {
      const snap = snaps[subcollectionsWithUpdatedAt.length + idx];
      for (const d of snap.docs) {
        if (!sameUidList(d.data()?.memberUids, target)) {
          updateTasks.push(() =>
            updateDoc(doc(db, 'careCircles', circleId, sub, d.id), {
              memberUids: target,
            })
          );
        }
      }
    });

    if (updateTasks.length > 0) {
      await runInChunks(updateTasks, 15, (fn) => fn());
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function createCircleInvite(
  circle: CareCircle,
  ownerUid: string,
  invitedRole: DashboardRole,
  invitedEmail?: string
): Promise<CircleInvite> {
  const inviteCode = generateInviteCode();
  const path = `circleInvites/${inviteCode}`;
  const normalizedEmail = clampStr(invitedEmail, 160).toLowerCase();
  const payload = {
    inviteCode,
    circleId: circle.id,
    ownerId: circle.ownerId,
    elderName: clampStr(circle.elderName, 100) || 'Resident',
    invitedRole,
    ...(normalizedEmail ? { invitedEmail: normalizedEmail } : {}),
    status: 'pending' as const,
    createdBy: ownerUid,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };

  try {
    await setDoc(doc(db, 'circleInvites', inviteCode), payload);
    return {
      id: inviteCode,
      ...payload,
    };
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
  }
}

export async function revokeCircleInvite(inviteCode: string): Promise<void> {
  const code = clampStr(inviteCode, 64);
  const path = `circleInvites/${code}`;
  try {
    await updateDoc(doc(db, 'circleInvites', code), {
      status: 'revoked',
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function joinCareCircleByInvite(
  user: User,
  rawCode: string
): Promise<{ circleId: string; role: DashboardRole; elderName: string }> {
  const code = rawCode.trim();
  if (!code || code.length < 8 || code.length > 64 || !/^[a-zA-Z0-9_\-]+$/.test(code)) {
    throw new Error('Please enter a valid Care Circle invite code (e.g., CARE_...).');
  }

  const invitePath = `circleInvites/${code}`;
  const inviteRef = doc(db, 'circleInvites', code);
  let inviteSnap;
  try {
    inviteSnap = await getDoc(inviteRef);
  } catch (error) {
    const codeStr = (error as { code?: string })?.code;
    const msgStr = error instanceof Error ? error.message : String(error);
    if (codeStr === 'permission-denied' || msgStr.toLowerCase().includes('missing or insufficient permissions')) {
      throw new Error(
        'Invite code not found or restricted to a different Google email address.'
      );
    }
    handleFirestoreError(error, OperationType.GET, invitePath);
  }

  if (!inviteSnap.exists()) {
    throw new Error('Invite code not found. Please double-check the code with your Care Circle owner.');
  }

  const invite = inviteSnap.data() as Omit<CircleInvite, 'id'>;
  if (invite.status !== 'pending') {
    throw new Error(`This invite code has already been ${invite.status}. Ask the Care Circle owner for a new invite.`);
  }

  if (invite.ownerId === user.uid) {
    throw new Error('You already own this Care Circle.');
  }

  const userEmail = clampStr(user.email, 160).toLowerCase();
  if (invite.invitedEmail && invite.invitedEmail.trim().length > 0) {
    if (!userEmail || invite.invitedEmail.trim().toLowerCase() !== userEmail) {
      throw new Error(
        `This invite is restricted to ${invite.invitedEmail}. You are signed in as ${user.email || 'another account'}.`
      );
    }
  }

  const safeMemberName =
    clampStr(user.displayName, 100) ||
    clampStr(user.email?.split('@')[0], 100) ||
    'Care Circle Member';
  const memberRef = doc(db, 'careCircles', invite.circleId, 'members', user.uid);

  try {
    const existingMember = await getDoc(memberRef);
    if (existingMember.exists()) {
      throw new Error('You are already a member of this Care Circle.');
    }
  } catch (err) {
    if (err instanceof Error && err.message === 'You are already a member of this Care Circle.') {
      throw err;
    }
    // Non-members receive permission-denied on getDoc(memberRef), which is expected before redemption
  }

  try {
    const batch = writeBatch(db);
    batch.update(inviteRef, {
      status: 'accepted',
      acceptedByUid: user.uid,
      ...(userEmail ? { acceptedByEmail: userEmail } : {}),
      updatedAt: serverTimestamp(),
    });
    batch.set(memberRef, {
      uid: user.uid,
      circleId: invite.circleId,
      ownerId: invite.ownerId,
      displayName: safeMemberName,
      role: invite.invitedRole,
      addedBy: invite.ownerId,
      inviteCode: code,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    await batch.commit();
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, `careCircles/${invite.circleId}/members/${user.uid}`);
  }

  try {
    await updateDoc(doc(db, 'users', user.uid), {
      defaultCircleId: invite.circleId,
      activeRole: invite.invitedRole,
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, `users/${user.uid}`);
  }

  // Register user.uid on parent CareCircle.memberUids when supported so queries persist cleanly across refreshes
  try {
    const circleRef = doc(db, 'careCircles', invite.circleId);
    const circleSnap = await getDoc(circleRef);
    if (circleSnap.exists()) {
      const existingUids = circleSnap.data()?.memberUids;
      if (Array.isArray(existingUids) && !existingUids.includes(user.uid) && existingUids.length < 10) {
        await updateDoc(circleRef, {
          memberUids: [...existingUids, user.uid],
          updatedAt: serverTimestamp(),
        });
      }
    }
  } catch {
    // Non-blocking: owner sync also keeps memberUids updated
  }

  return {
    circleId: invite.circleId,
    role: invite.invitedRole,
    elderName: invite.elderName,
  };
}

export async function updateCircleMemberRole(
  circleId: string,
  memberUid: string,
  role: DashboardRole
): Promise<void> {
  const path = `careCircles/${circleId}/members/${memberUid}`;
  try {
    await updateDoc(doc(db, 'careCircles', circleId, 'members', memberUid), {
      role,
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function removeCircleMember(
  circleId: string,
  memberUid: string
): Promise<void> {
  const path = `careCircles/${circleId}/members/${memberUid}`;
  try {
    await deleteDoc(doc(db, 'careCircles', circleId, 'members', memberUid));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}

export async function leaveCareCircle(user: User, circleId: string): Promise<void> {
  // Step 1: While still a verified member, strip own UID from all subcollections and parent CareCircle.memberUids
  const subcollectionsWithUpdatedAt = [
    'medications',
    'doseLogs',
    'appointments',
    'sosEvents',
  ] as const;
  const immutableTimestampCollections = ['notificationLogs', 'aiRoutines'] as const;

  try {
    const snaps = await Promise.all([
      ...subcollectionsWithUpdatedAt.map((sub) =>
        getDocs(
          query(
            collection(db, 'careCircles', circleId, sub),
            where('memberUids', 'array-contains', user.uid)
          )
        )
      ),
      ...immutableTimestampCollections.map((sub) =>
        getDocs(
          query(
            collection(db, 'careCircles', circleId, sub),
            where('memberUids', 'array-contains', user.uid)
          )
        )
      ),
    ]);

    const cleanupTasks: Array<() => Promise<void>> = [];

    subcollectionsWithUpdatedAt.forEach((sub, idx) => {
      for (const d of snaps[idx].docs) {
        const current = d.data()?.memberUids;
        if (Array.isArray(current) && current.includes(user.uid)) {
          const next = current.filter((u) => u !== user.uid);
          if (next.length >= 1) {
            cleanupTasks.push(() =>
              updateDoc(doc(db, 'careCircles', circleId, sub, d.id), {
                memberUids: next,
                updatedAt: serverTimestamp(),
              })
            );
          }
        }
      }
    });

    immutableTimestampCollections.forEach((sub, idx) => {
      const snap = snaps[subcollectionsWithUpdatedAt.length + idx];
      for (const d of snap.docs) {
        const current = d.data()?.memberUids;
        if (Array.isArray(current) && current.includes(user.uid)) {
          const next = current.filter((u) => u !== user.uid);
          if (next.length >= 1) {
            cleanupTasks.push(() =>
              updateDoc(doc(db, 'careCircles', circleId, sub, d.id), {
                memberUids: next,
              })
            );
          }
        }
      }
    });

    if (cleanupTasks.length > 0) {
      await runInChunks(cleanupTasks, 15, (fn) => fn());
    }

    const circleRef = doc(db, 'careCircles', circleId);
    const circleSnap = await getDoc(circleRef);
    if (circleSnap.exists()) {
      const current = circleSnap.data()?.memberUids;
      if (Array.isArray(current) && current.includes(user.uid)) {
        const next = current.filter((u) => u !== user.uid);
        if (next.length >= 1) {
          await updateDoc(circleRef, {
            memberUids: next,
            updatedAt: serverTimestamp(),
          });
        }
      }
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, `careCircles/${circleId}`);
  }

  // Step 2: Delete membership document
  const memberPath = `careCircles/${circleId}/members/${user.uid}`;
  try {
    await deleteDoc(doc(db, 'careCircles', circleId, 'members', user.uid));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, memberPath);
  }

  // Step 3: Clear defaultCircleId link on own profile
  try {
    await updateDoc(doc(db, 'users', user.uid), {
      defaultCircleId: deleteField(),
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, `users/${user.uid}`);
  }
}

// --- CRUD Operations ---

export async function updateCareCircleSettings(
  circleId: string,
  updates: Partial<
    Pick<
      CareCircle,
      | 'elderName'
      | 'elderAge'
      | 'elderPhone'
      | 'bloodType'
      | 'allergies'
      | 'emergencyContactName'
      | 'emergencyContactPhone'
      | 'notificationEmail'
      | 'emailAlertsEnabled'
      | 'missedDoseThresholdMinutes'
    >
  >
): Promise<void> {
  const path = `careCircles/${circleId}`;
  try {
    const payload: Record<string, unknown> = {
      updatedAt: serverTimestamp(),
    };
    if (updates.elderName !== undefined) payload.elderName = clampStr(updates.elderName, 100);
    if (updates.elderAge !== undefined) payload.elderAge = Math.max(18, Math.min(125, Math.round(updates.elderAge)));
    if (updates.elderPhone !== undefined) payload.elderPhone = clampStr(updates.elderPhone, 32);
    if (updates.bloodType !== undefined) payload.bloodType = clampStr(updates.bloodType, 16);
    if (updates.allergies !== undefined) payload.allergies = clampStr(updates.allergies, 300);
    if (updates.emergencyContactName !== undefined) payload.emergencyContactName = clampStr(updates.emergencyContactName, 100);
    if (updates.emergencyContactPhone !== undefined) payload.emergencyContactPhone = clampStr(updates.emergencyContactPhone, 32);
    if (updates.notificationEmail !== undefined) payload.notificationEmail = clampStr(updates.notificationEmail, 160);
    if (updates.emailAlertsEnabled !== undefined) payload.emailAlertsEnabled = Boolean(updates.emailAlertsEnabled);
    if (updates.missedDoseThresholdMinutes !== undefined) {
      payload.missedDoseThresholdMinutes = Math.max(5, Math.min(240, Math.round(updates.missedDoseThresholdMinutes)));
    }
    await updateDoc(doc(db, 'careCircles', circleId), payload);
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export interface MedicationInput {
  name: string;
  dosage: string;
  scheduleTime: string;
  timeSlot: TimeSlot;
  withFood: boolean;
  instructions?: string;
  stockCount: number;
  active: boolean;
}

export async function createMedication(
  circleId: string,
  ownerId: string,
  uid: string,
  input: MedicationInput,
  circleMemberUids?: string[]
): Promise<void> {
  const name = clampStr(input.name, 100);
  const dosage = clampStr(input.dosage, 60);
  if (!name || !dosage) {
    throw new Error('Medication name and dosage are required.');
  }
  if (!/^([01][0-9]|2[0-3]):[0-5][0-9]$/.test(input.scheduleTime)) {
    throw new Error('Medication scheduleTime must be in 24-hour HH:MM format.');
  }

  const medId = makeId('med');
  const path = `careCircles/${circleId}/medications/${medId}`;
  try {
    await setDoc(doc(db, 'careCircles', circleId, 'medications', medId), {
      circleId,
      ownerId,
      name,
      dosage,
      scheduleTime: input.scheduleTime,
      timeSlot: input.timeSlot,
      withFood: Boolean(input.withFood),
      instructions: clampStr(input.instructions, 250),
      stockCount: Math.max(0, Math.min(5000, Math.round(Number(input.stockCount) || 0))),
      active: Boolean(input.active),
      createdBy: uid,
      memberUids: sanitizeMemberUids(circleMemberUids, ownerId, uid),
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
  }
}

export async function updateMedication(
  circleId: string,
  medId: string,
  input: Partial<MedicationInput>
): Promise<void> {
  const path = `careCircles/${circleId}/medications/${medId}`;
  const payload: Record<string, unknown> = {
    updatedAt: serverTimestamp(),
  };
  if (input.name !== undefined) {
    const name = clampStr(input.name, 100);
    if (!name) throw new Error('Medication name cannot be empty.');
    payload.name = name;
  }
  if (input.dosage !== undefined) {
    const dosage = clampStr(input.dosage, 60);
    if (!dosage) throw new Error('Medication dosage cannot be empty.');
    payload.dosage = dosage;
  }
  if (input.scheduleTime !== undefined) {
    if (!/^([01][0-9]|2[0-3]):[0-5][0-9]$/.test(input.scheduleTime)) {
      throw new Error('Medication scheduleTime must be in 24-hour HH:MM format.');
    }
    payload.scheduleTime = input.scheduleTime;
  }
  if (input.timeSlot !== undefined) payload.timeSlot = input.timeSlot;
  if (input.withFood !== undefined) payload.withFood = Boolean(input.withFood);
  if (input.instructions !== undefined) payload.instructions = clampStr(input.instructions, 250);
  if (input.stockCount !== undefined) {
    payload.stockCount = Math.max(0, Math.min(5000, Math.round(Number(input.stockCount) || 0)));
  }
  if (input.active !== undefined) payload.active = Boolean(input.active);

  try {
    await updateDoc(doc(db, 'careCircles', circleId, 'medications', medId), payload);
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function deleteMedication(circleId: string, medId: string): Promise<void> {
  const path = `careCircles/${circleId}/medications/${medId}`;
  try {
    await deleteDoc(doc(db, 'careCircles', circleId, 'medications', medId));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}

export async function recordDoseStatus(
  circleId: string,
  ownerId: string,
  uid: string,
  medication: Medication,
  scheduledDate: string,
  status: DoseStatus,
  existingLog: DoseLog | null,
  note = '',
  circleMemberUids?: string[]
): Promise<void> {
  const logId = existingLog?.id || `${medication.id}_${scheduledDate}`.replace(/[^a-zA-Z0-9_\-]/g, '');
  const path = `careCircles/${circleId}/doseLogs/${logId}`;
  try {
    const logRef = doc(db, 'careCircles', circleId, 'doseLogs', logId);
    const takenAtIso = status === 'taken' ? getLocalDateTimeIso() : '';

    let priorStatus: DoseStatus | undefined = existingLog?.status;
    let docAlreadyExists = Boolean(existingLog);

    if (!existingLog) {
      const existingSnap = await getDoc(logRef);
      if (existingSnap.exists()) {
        docAlreadyExists = true;
        priorStatus = (existingSnap.data() as Partial<DoseLog>).status;
      }
    }

    if (docAlreadyExists) {
      const updatePayload: Record<string, unknown> = {
        status,
        takenAtIso,
        loggedBy: uid,
        note: clampStr(note, 250),
        updatedAt: serverTimestamp(),
      };
      // Preserve alertAcknowledged on pending <-> taken transitions so Elderly role updates pass rules
      if (status === 'missed') {
        updatePayload.alertAcknowledged = false;
      } else if (priorStatus === 'missed') {
        updatePayload.alertAcknowledged = status === 'taken' || status === 'skipped';
      }
      await updateDoc(logRef, updatePayload);
    } else {
      await setDoc(logRef, {
        circleId,
        ownerId,
        medicationId: medication.id,
        medicationName: clampStr(medication.name, 100),
        dosage: clampStr(medication.dosage, 60),
        scheduledDate,
        scheduledTime: medication.scheduleTime,
        timeSlot: medication.timeSlot,
        status,
        takenAtIso,
        loggedBy: uid,
        note: clampStr(note, 250),
        alertAcknowledged: false,
        memberUids: sanitizeMemberUids(circleMemberUids, ownerId, uid),
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    }

    // Adjust stock count cleanly when transitioning into or out of 'taken'
    const wasTaken = priorStatus === 'taken';
    if ((status === 'taken' && !wasTaken) || (status !== 'taken' && wasTaken)) {
      const medRef = doc(db, 'careCircles', circleId, 'medications', medication.id);
      const medSnap = await getDoc(medRef);
      if (medSnap.exists()) {
        const currentStock = Number((medSnap.data() as Partial<Medication>).stockCount ?? medication.stockCount) || 0;
        const nextStock =
          status === 'taken' && !wasTaken
            ? Math.max(0, Math.min(5000, Math.round(currentStock) - 1))
            : Math.max(0, Math.min(5000, Math.round(currentStock) + 1));
        if (nextStock !== currentStock) {
          await updateDoc(medRef, {
            stockCount: nextStock,
            updatedAt: serverTimestamp(),
          });
        }
      }
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

export async function acknowledgeDoseAlert(circleId: string, logId: string): Promise<void> {
  const path = `careCircles/${circleId}/doseLogs/${logId}`;
  try {
    await updateDoc(doc(db, 'careCircles', circleId, 'doseLogs', logId), {
      alertAcknowledged: true,
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export interface AppointmentInput {
  doctorName: string;
  specialty: string;
  clinicName: string;
  appointmentDate: string;
  appointmentTime: string;
  purpose: string;
  notes?: string;
}

export async function createAppointment(
  circleId: string,
  ownerId: string,
  input: AppointmentInput,
  circleMemberUids?: string[]
): Promise<void> {
  const doctorName = clampStr(input.doctorName, 100);
  const specialty = clampStr(input.specialty, 80);
  const clinicName = clampStr(input.clinicName, 120);
  const purpose = clampStr(input.purpose, 200);
  if (!doctorName || !specialty || !clinicName || !purpose) {
    throw new Error('Doctor name, specialty, clinic name, and purpose are required.');
  }
  if (!/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(input.appointmentDate)) {
    throw new Error('Appointment date must be in YYYY-MM-DD format.');
  }
  if (!/^([01][0-9]|2[0-3]):[0-5][0-9]$/.test(input.appointmentTime)) {
    throw new Error('Appointment time must be in 24-hour HH:MM format.');
  }

  const apptId = makeId('appt');
  const path = `careCircles/${circleId}/appointments/${apptId}`;
  try {
    await setDoc(doc(db, 'careCircles', circleId, 'appointments', apptId), {
      circleId,
      ownerId,
      doctorName,
      specialty,
      clinicName,
      appointmentDate: input.appointmentDate,
      appointmentTime: input.appointmentTime,
      purpose,
      status: 'upcoming',
      notes: clampStr(input.notes, 400),
      memberUids: sanitizeMemberUids(circleMemberUids, ownerId),
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
  }
}

export async function updateAppointmentDetails(
  circleId: string,
  apptId: string,
  input: AppointmentInput
): Promise<void> {
  const doctorName = clampStr(input.doctorName, 100);
  const specialty = clampStr(input.specialty, 80);
  const clinicName = clampStr(input.clinicName, 120);
  const purpose = clampStr(input.purpose, 200);
  if (!doctorName || !specialty || !clinicName || !purpose) {
    throw new Error('Doctor name, specialty, clinic name, and purpose are required.');
  }
  if (!/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(input.appointmentDate)) {
    throw new Error('Appointment date must be in YYYY-MM-DD format.');
  }
  if (!/^([01][0-9]|2[0-3]):[0-5][0-9]$/.test(input.appointmentTime)) {
    throw new Error('Appointment time must be in 24-hour HH:MM format.');
  }

  const path = `careCircles/${circleId}/appointments/${apptId}`;
  try {
    await updateDoc(doc(db, 'careCircles', circleId, 'appointments', apptId), {
      doctorName,
      specialty,
      clinicName,
      appointmentDate: input.appointmentDate,
      appointmentTime: input.appointmentTime,
      purpose,
      notes: clampStr(input.notes, 400),
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function updateAppointmentStatus(
  circleId: string,
  apptId: string,
  status: AppointmentStatus,
  notes?: string
): Promise<void> {
  const path = `careCircles/${circleId}/appointments/${apptId}`;
  try {
    const payload: Record<string, unknown> = {
      status,
      updatedAt: serverTimestamp(),
    };
    if (notes !== undefined) payload.notes = clampStr(notes, 400);
    await updateDoc(doc(db, 'careCircles', circleId, 'appointments', apptId), payload);
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function deleteAppointment(circleId: string, apptId: string): Promise<void> {
  const path = `careCircles/${circleId}/appointments/${apptId}`;
  try {
    await deleteDoc(doc(db, 'careCircles', circleId, 'appointments', apptId));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}

export async function triggerDemoSosEvent(
  circleId: string,
  ownerId: string,
  uid: string,
  triggeredByName: string,
  note: string,
  circleMemberUids?: string[]
): Promise<string> {
  const sosId = makeId('sos');
  const path = `careCircles/${circleId}/sosEvents/${sosId}`;
  try {
    await setDoc(doc(db, 'careCircles', circleId, 'sosEvents', sosId), {
      circleId,
      ownerId,
      triggeredByUid: uid,
      triggeredByName: clampStr(triggeredByName, 100),
      status: 'active_demo',
      note: clampStr(note || 'Emergency assistance requested via ELDERCARE AI demo SOS button.', 250),
      demoOnlyConfirmed: true,
      memberUids: sanitizeMemberUids(circleMemberUids, ownerId, uid),
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    return sosId;
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
  }
}

export async function updateSosEventStatus(
  circleId: string,
  sosId: string,
  status: SosStatus,
  acknowledgedBy: string
): Promise<void> {
  const path = `careCircles/${circleId}/sosEvents/${sosId}`;
  try {
    await updateDoc(doc(db, 'careCircles', circleId, 'sosEvents', sosId), {
      status,
      acknowledgedBy: clampStr(acknowledgedBy, 100),
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export function buildAlertDedupId(
  eventType: NotificationEventType,
  entityId: string,
  dateStr?: string
): string {
  const cleanEntity = entityId.replace(/[^a-zA-Z0-9_\-]/g, '');
  const cleanDate = (dateStr || getLocalDateString()).replace(/[^a-zA-Z0-9_\-]/g, '');
  if (eventType === 'missed_dose') {
    return `nlog_missed_${cleanEntity}_${cleanDate}`.slice(0, 128);
  }
  if (eventType === 'sos_demo') {
    return `nlog_sos_${cleanEntity}`.slice(0, 128);
  }
  if (eventType === 'appointment_reminder') {
    return `nlog_appt_${cleanEntity}_${cleanDate}`.slice(0, 128);
  }
  return makeId('nlog').slice(0, 128);
}

export async function hasNotificationLog(circleId: string, logId: string): Promise<boolean> {
  const cleanId = logId.replace(/[^a-zA-Z0-9_\-]/g, '').slice(0, 128);
  if (!cleanId) return false;
  const path = `careCircles/${circleId}/notificationLogs/${cleanId}`;
  try {
    const snap = await getDoc(doc(db, 'careCircles', circleId, 'notificationLogs', cleanId));
    return snap.exists();
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, path);
  }
}

export async function createNotificationLog(
  circleId: string,
  ownerId: string,
  recipientEmail: string,
  subject: string,
  eventType: NotificationEventType,
  deliveryStatus: DeliveryStatus,
  detail: string,
  circleMemberUids?: string[],
  customLogId?: string
): Promise<void> {
  const sanitizedCustom = customLogId
    ? customLogId.replace(/[^a-zA-Z0-9_\-]/g, '').slice(0, 128)
    : '';
  const logId = sanitizedCustom || makeId('nlog');
  const path = `careCircles/${circleId}/notificationLogs/${logId}`;
  try {
    await setDoc(doc(db, 'careCircles', circleId, 'notificationLogs', logId), {
      circleId,
      ownerId,
      recipientEmail: clampStr(recipientEmail, 160) || 'unknown@user.local',
      subject: clampStr(subject, 160) || 'ELDERCARE AI Alert',
      eventType,
      deliveryStatus,
      detail: clampStr(detail, 400),
      memberUids: sanitizeMemberUids(circleMemberUids, ownerId),
      createdAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
  }
}

export async function saveAiRoutine(
  circleId: string,
  ownerId: string,
  uid: string,
  routine: {
    promptFocus: string;
    summary: string;
    morningPlan: string;
    afternoonPlan: string;
    eveningPlan: string;
    safetyTip: string;
  },
  circleMemberUids?: string[]
): Promise<void> {
  const routineId = makeId('routine');
  const path = `careCircles/${circleId}/aiRoutines/${routineId}`;
  try {
    await setDoc(doc(db, 'careCircles', circleId, 'aiRoutines', routineId), {
      circleId,
      ownerId,
      promptFocus: clampStr(routine.promptFocus, 200) || 'Daily Care Routine',
      summary: clampStr(routine.summary, 1000) || 'Daily wellness overview.',
      morningPlan: clampStr(routine.morningPlan, 1200) || 'Morning medication and hydration.',
      afternoonPlan: clampStr(routine.afternoonPlan, 1200) || 'Afternoon meal-paired dosing and light walk.',
      eveningPlan: clampStr(routine.eveningPlan, 1200) || 'Evening wind-down and next-day prep.',
      safetyTip: clampStr(routine.safetyTip, 600) || 'Rise slowly and keep water nearby.',
      createdBy: uid,
      memberUids: sanitizeMemberUids(circleMemberUids, ownerId, uid),
      createdAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
  }
}

export async function deleteAiRoutine(circleId: string, routineId: string): Promise<void> {
  const path = `careCircles/${circleId}/aiRoutines/${routineId}`;
  try {
    await deleteDoc(doc(db, 'careCircles', circleId, 'aiRoutines', routineId));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}
