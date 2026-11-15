export type DashboardRole = 'elderly' | 'caretaker' | 'family';

export type TimeSlot = 'morning' | 'afternoon' | 'evening' | 'night';

export type DoseStatus = 'taken' | 'missed' | 'skipped' | 'pending';

export type AppointmentStatus = 'upcoming' | 'completed' | 'cancelled';

export type SosStatus = 'active_demo' | 'acknowledged' | 'resolved';

export type NotificationEventType =
  | 'missed_dose'
  | 'sos_demo'
  | 'appointment_reminder'
  | 'test_setup';

export type DeliveryStatus =
  | 'smtp_sent'
  | 'logged_unconfigured_smtp'
  | 'failed';

export interface UserProfile {
  uid: string;
  displayName: string;
  email: string;
  activeRole: DashboardRole;
  defaultCircleId?: string;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export type InviteStatus = 'pending' | 'accepted' | 'revoked';

export interface CareCircle {
  id: string;
  ownerId: string;
  elderName: string;
  elderAge: number;
  elderPhone?: string;
  bloodType?: string;
  allergies?: string;
  emergencyContactName: string;
  emergencyContactPhone: string;
  notificationEmail?: string;
  emailAlertsEnabled: boolean;
  missedDoseThresholdMinutes: number;
  memberUids?: string[];
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface CircleMember {
  id: string;
  uid: string;
  circleId: string;
  ownerId: string;
  displayName: string;
  role: DashboardRole;
  addedBy: string;
  inviteCode?: string;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface CircleInvite {
  id: string;
  inviteCode: string;
  circleId: string;
  ownerId: string;
  elderName: string;
  invitedRole: DashboardRole;
  invitedEmail?: string;
  status: InviteStatus;
  createdBy: string;
  acceptedByUid?: string;
  acceptedByEmail?: string;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface Medication {
  id: string;
  circleId: string;
  ownerId: string;
  name: string;
  dosage: string;
  scheduleTime: string; // HH:MM
  timeSlot: TimeSlot;
  withFood: boolean;
  instructions?: string;
  stockCount: number;
  active: boolean;
  createdBy: string;
  memberUids?: string[];
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface DoseLog {
  id: string;
  circleId: string;
  ownerId: string;
  medicationId: string;
  medicationName: string;
  dosage: string;
  scheduledDate: string; // YYYY-MM-DD
  scheduledTime: string; // HH:MM
  timeSlot: TimeSlot;
  status: DoseStatus;
  takenAtIso?: string;
  loggedBy: string;
  note?: string;
  alertAcknowledged: boolean;
  memberUids?: string[];
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface Appointment {
  id: string;
  circleId: string;
  ownerId: string;
  doctorName: string;
  specialty: string;
  clinicName: string;
  appointmentDate: string; // YYYY-MM-DD
  appointmentTime: string; // HH:MM
  purpose: string;
  status: AppointmentStatus;
  notes?: string;
  memberUids?: string[];
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface SosEvent {
  id: string;
  circleId: string;
  ownerId: string;
  triggeredByUid: string;
  triggeredByName: string;
  status: SosStatus;
  note?: string;
  demoOnlyConfirmed: boolean;
  acknowledgedBy?: string;
  memberUids?: string[];
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface NotificationLog {
  id: string;
  circleId: string;
  ownerId: string;
  recipientEmail: string;
  subject: string;
  eventType: NotificationEventType;
  deliveryStatus: DeliveryStatus;
  detail: string;
  memberUids?: string[];
  createdAt?: unknown;
}

export interface AiRoutine {
  id: string;
  circleId: string;
  ownerId: string;
  promptFocus: string;
  summary: string;
  morningPlan: string;
  afternoonPlan: string;
  eveningPlan: string;
  safetyTip: string;
  createdBy: string;
  memberUids?: string[];
  createdAt?: unknown;
}

export interface AiRoutineResponse {
  summary: string;
  morningPlan: string;
  afternoonPlan: string;
  eveningPlan: string;
  safetyTip: string;
  answerToQuestion: string;
  disclaimer: string;
}

export interface SmtpStatusResponse {
  smtpConfigured: boolean;
  smtpHostSet: boolean;
  smtpUserSet: boolean;
  smtpPassSet: boolean;
  smtpFrom: string | null;
  instructions: string;
}

export interface AiStatusResponse {
  geminiConfigured: boolean;
  status: 'active' | 'configuration_pending';
  instructions: string;
}

export interface ToastMessage {
  id: string;
  type: 'success' | 'error' | 'info';
  title: string;
  detail?: string;
}
