import { auth } from './firebase';
import type {
  AiRoutineResponse,
  AiStatusResponse,
  Appointment,
  DeliveryStatus,
  Medication,
  NotificationEventType,
  SmtpStatusResponse,
} from '../types';

export class AiConfigurationPendingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AiConfigurationPendingError';
  }
}

async function getAuthHeaders(): Promise<HeadersInit> {
  const user = auth.currentUser;
  if (!user) {
    throw new Error('You must be signed in to access server features.');
  }
  const token = await user.getIdToken();
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`,
  };
}

export async function fetchSmtpStatus(circleId?: string): Promise<SmtpStatusResponse> {
  const headers = await getAuthHeaders();
  const qs = circleId ? `?circleId=${encodeURIComponent(circleId)}` : '';
  const res = await fetch(`/api/notifications/status${qs}`, { headers });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error || 'Failed to check SMTP configuration status.');
  }
  return data as SmtpStatusResponse;
}

export async function fetchAiStatus(circleId?: string): Promise<AiStatusResponse> {
  const headers = await getAuthHeaders();
  const qs = circleId ? `?circleId=${encodeURIComponent(circleId)}` : '';
  const res = await fetch(`/api/ai/status${qs}`, { headers });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error || 'Failed to check AI Assistant configuration status.');
  }
  return data as AiStatusResponse;
}

export async function sendEmailNotification(payload: {
  circleId: string;
  recipientEmail: string;
  subject: string;
  bodyText: string;
}): Promise<{
  delivered: boolean;
  deliveryStatus: DeliveryStatus;
  detail: string;
}> {
  const headers = await getAuthHeaders();
  const res = await fetch('/api/notifications/send', {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error || data.detail || 'Email notification request failed.');
  }
  return data;
}

export async function dispatchCareAlert(payload: {
  circleId: string;
  sosId?: string;
  eventType: NotificationEventType;
  recipientEmail: string;
  elderName: string;
  subject?: string;
  summary: string;
  details?: Record<string, string | number | boolean | undefined>;
}): Promise<{
  delivered: boolean;
  deliveryStatus: DeliveryStatus;
  subject: string;
  detail: string;
}> {
  const headers = await getAuthHeaders();
  const res = await fetch('/api/notifications/dispatch-alert', {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error || data.detail || 'Alert dispatch request failed.');
  }
  return data;
}

export async function generateAiHealthRoutine(payload: {
  circleId: string;
  elderName: string;
  elderAge: number;
  focus: string;
  question: string;
  medications: Medication[];
  upcomingAppointments: Appointment[];
}): Promise<AiRoutineResponse> {
  const headers = await getAuthHeaders();
  const res = await fetch('/api/ai/routine', {
    method: 'POST',
    headers,
    body: JSON.stringify({
      circleId: payload.circleId,
      elderName: payload.elderName,
      elderAge: payload.elderAge,
      focus: payload.focus,
      question: payload.question,
      medications: payload.medications
        .filter((m) => m.active)
        .slice(0, 25)
        .map((m) => ({
          name: m.name,
          dosage: m.dosage,
          scheduleTime: m.scheduleTime,
          timeSlot: m.timeSlot,
          withFood: m.withFood,
          instructions: m.instructions,
        })),
      upcomingAppointments: payload.upcomingAppointments
        .filter((a) => a.status === 'upcoming')
        .slice(0, 20)
        .map((a) => ({
          doctorName: a.doctorName,
          specialty: a.specialty,
          appointmentDate: a.appointmentDate,
          appointmentTime: a.appointmentTime,
          purpose: a.purpose,
        })),
    }),
  });
  const data = await res.json();
  if (!res.ok) {
    if (res.status === 503 && data?.configurationPending) {
      throw new AiConfigurationPendingError(
        data.error ||
          'AI Routine Assistant is currently configuration-pending on the server.'
      );
    }
    throw new Error(data.error || 'Failed to generate AI health routine.');
  }
  return data as AiRoutineResponse;
}
