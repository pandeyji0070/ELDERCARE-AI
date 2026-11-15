import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import {
  formatSlotLabel,
  formatTime12h,
  getLocalDateString,
  getOffsetDateString,
  isDoseTakenLate,
} from './analytics';
import type { Appointment, CareCircle, DoseLog, Medication } from '../types';

export type ReportRange = '7d' | '14d' | '30d' | 'all';

export interface DoctorReportOptions {
  circle: CareCircle;
  medications: Medication[];
  doseLogs: DoseLog[];
  appointments: Appointment[];
  range: ReportRange;
  includeActiveRegimen: boolean;
  includeAdherenceLogs: boolean;
  includeAppointments: boolean;
}

interface JsPdfWithAutoTable extends jsPDF {
  lastAutoTable?: {
    finalY: number;
  };
}

function getRangeLabel(range: ReportRange): string {
  switch (range) {
    case '7d':
      return 'Last 7 Days';
    case '14d':
      return 'Last 14 Days';
    case '30d':
      return 'Last 30 Days';
    case 'all':
      return 'All Recorded History';
  }
}

function filterLogsByRange(logs: DoseLog[], range: ReportRange): DoseLog[] {
  if (range === 'all') return logs;
  const daysBack = range === '7d' ? 6 : range === '14d' ? 13 : 29;
  const cutoffDate = getOffsetDateString(daysBack);
  return logs.filter((l) => l.scheduledDate >= cutoffDate);
}

export function exportDoctorVisitPdf(options: DoctorReportOptions): {
  fileName: string;
  logsExported: number;
  appointmentsExported: number;
} {
  const {
    circle,
    medications,
    doseLogs,
    appointments,
    range,
    includeActiveRegimen,
    includeAdherenceLogs,
    includeAppointments,
  } = options;

  const doc = new jsPDF({ orientation: 'portrait', unit: 'pt', format: 'letter' }) as JsPdfWithAutoTable;
  const pageWidth = doc.internal.pageSize.getWidth();
  const marginX = 40;
  let cursorY = 44;

  // Header Banner
  doc.setFillColor(15, 118, 110); // Teal 700
  doc.rect(0, 0, pageWidth, 82, 'F');

  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(18);
  doc.text('ELDERCARE AI — Doctor Visit Care Report', marginX, 36);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  const generatedStamp = new Date().toLocaleString('en-US', {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
  doc.text(`Generated: ${generatedStamp}  |  Report Period: ${getRangeLabel(range)}`, marginX, 56);

  cursorY = 104;

  // Resident Information Block
  doc.setTextColor(15, 23, 42);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(12);
  doc.text('Patient / Resident Summary', marginX, cursorY);
  cursorY += 10;

  autoTable(doc, {
    startY: cursorY,
    margin: { left: marginX, right: marginX },
    theme: 'plain',
    styles: { fontSize: 9.5, cellPadding: 4, textColor: [30, 41, 59] },
    columnStyles: {
      0: { fontStyle: 'bold', cellWidth: 115, textColor: [71, 85, 105] },
      1: { cellWidth: 155 },
      2: { fontStyle: 'bold', cellWidth: 115, textColor: [71, 85, 105] },
      3: { cellWidth: 'auto' },
    },
    body: [
      ['Resident Name:', circle.elderName, 'Age:', `${circle.elderAge} years`],
      ['Blood Type:', circle.bloodType || 'Not recorded', 'Allergies:', circle.allergies || 'None recorded'],
      [
        'Emergency Contact:',
        circle.emergencyContactName,
        'Contact Phone:',
        circle.emergencyContactPhone,
      ],
    ],
  });

  cursorY = (doc.lastAutoTable?.finalY ?? cursorY + 60) + 18;

  const filteredLogs = filterLogsByRange(doseLogs, range)
    .slice()
    .sort((a, b) =>
      `${b.scheduledDate}_${b.scheduledTime}`.localeCompare(`${a.scheduledDate}_${a.scheduledTime}`)
    );

  const completedOrMissed = filteredLogs.filter((l) => l.status !== 'pending');
  const takenCount = completedOrMissed.filter((l) => l.status === 'taken').length;
  const missedCount = completedOrMissed.filter((l) => l.status === 'missed').length;
  const skippedCount = completedOrMissed.filter((l) => l.status === 'skipped').length;
  const adherenceRate =
    completedOrMissed.length > 0 ? Math.round((takenCount / completedOrMissed.length) * 100) : 0;

  // Adherence Summary Metrics
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(12);
  doc.setTextColor(15, 23, 42);
  doc.text(`Adherence Overview (${getRangeLabel(range)})`, marginX, cursorY);
  cursorY += 10;

  autoTable(doc, {
    startY: cursorY,
    margin: { left: marginX, right: marginX },
    theme: 'grid',
    headStyles: { fillColor: [241, 245, 249], textColor: [15, 23, 42], fontStyle: 'bold', fontSize: 9 },
    styles: { fontSize: 10, cellPadding: 6, halign: 'center', textColor: [15, 23, 42] },
    head: [['Adherence Rate', 'Doses Taken', 'Doses Missed', 'Doses Skipped', 'Total Logged']],
    body: [
      [
        `${adherenceRate}%`,
        String(takenCount),
        String(missedCount),
        String(skippedCount),
        String(completedOrMissed.length),
      ],
    ],
  });

  cursorY = (doc.lastAutoTable?.finalY ?? cursorY + 50) + 20;

  // Active Medication Regimen
  if (includeActiveRegimen) {
    if (cursorY > 680) {
      doc.addPage();
      cursorY = 44;
    }
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(12);
    doc.setTextColor(15, 23, 42);
    doc.text('Scheduled Medication Regimen', marginX, cursorY);
    cursorY += 10;

    const medRows =
      medications.length > 0
        ? medications.map((m) => [
            m.name,
            m.dosage,
            `${formatTime12h(m.scheduleTime)} (${formatSlotLabel(m.timeSlot)})`,
            m.withFood ? 'With food' : 'No food req.',
            `${m.stockCount} left`,
            m.active ? 'Active' : 'Paused',
          ])
        : [['No medications configured', '—', '—', '—', '—', '—']];

    autoTable(doc, {
      startY: cursorY,
      margin: { left: marginX, right: marginX },
      theme: 'striped',
      headStyles: { fillColor: [15, 118, 110], textColor: [255, 255, 255], fontSize: 9 },
      styles: { fontSize: 8.5, cellPadding: 5, textColor: [30, 41, 59] },
      head: [['Medication', 'Dosage', 'Schedule', 'Food', 'Refill Stock', 'Status']],
      body: medRows,
    });

    cursorY = (doc.lastAutoTable?.finalY ?? cursorY + 60) + 20;
  }

  // Medication Adherence Logs
  if (includeAdherenceLogs) {
    if (cursorY > 660) {
      doc.addPage();
      cursorY = 44;
    }
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(12);
    doc.setTextColor(15, 23, 42);
    doc.text(`Medication Adherence Logs (${filteredLogs.length} entries)`, marginX, cursorY);
    cursorY += 10;

    const logRows =
      filteredLogs.length > 0
        ? filteredLogs.map((log) => [
            log.scheduledDate,
            formatTime12h(log.scheduledTime),
            `${log.medicationName} (${log.dosage})`,
            isDoseTakenLate(log, circle.missedDoseThresholdMinutes)
              ? 'Taken Late'
              : log.status.charAt(0).toUpperCase() + log.status.slice(1),
            log.takenAtIso ? formatTime12h(log.takenAtIso.slice(11, 16)) : '—',
            log.note || '—',
          ])
        : [['—', '—', 'No dose logs recorded in selected period', '—', '—', '—']];

    autoTable(doc, {
      startY: cursorY,
      margin: { left: marginX, right: marginX },
      theme: 'striped',
      headStyles: { fillColor: [15, 23, 42], textColor: [255, 255, 255], fontSize: 9 },
      styles: { fontSize: 8.5, cellPadding: 5, textColor: [30, 41, 59] },
      columnStyles: {
        0: { cellWidth: 66 },
        1: { cellWidth: 56 },
        2: { cellWidth: 130 },
        3: { cellWidth: 54 },
        4: { cellWidth: 56 },
        5: { cellWidth: 'auto' },
      },
      head: [['Date', 'Scheduled', 'Medication', 'Status', 'Logged At', 'Notes']],
      body: logRows,
    });

    cursorY = (doc.lastAutoTable?.finalY ?? cursorY + 60) + 20;
  }

  // Doctor Appointment History
  if (includeAppointments) {
    if (cursorY > 660) {
      doc.addPage();
      cursorY = 44;
    }
    const sortedAppts = appointments
      .slice()
      .sort((a, b) =>
        `${b.appointmentDate}_${b.appointmentTime}`.localeCompare(
          `${a.appointmentDate}_${a.appointmentTime}`
        )
      );

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(12);
    doc.setTextColor(15, 23, 42);
    doc.text(`Doctor Appointment History (${sortedAppts.length} visits)`, marginX, cursorY);
    cursorY += 10;

    const apptRows =
      sortedAppts.length > 0
        ? sortedAppts.map((appt) => [
            `${appt.appointmentDate}\n${formatTime12h(appt.appointmentTime)}`,
            `${appt.doctorName}\n${appt.specialty}`,
            appt.clinicName,
            appt.status.charAt(0).toUpperCase() + appt.status.slice(1),
            appt.notes ? `${appt.purpose} — ${appt.notes}` : appt.purpose,
          ])
        : [['—', '—', 'No doctor appointments recorded', '—', '—']];

    autoTable(doc, {
      startY: cursorY,
      margin: { left: marginX, right: marginX },
      theme: 'striped',
      headStyles: { fillColor: [15, 118, 110], textColor: [255, 255, 255], fontSize: 9 },
      styles: { fontSize: 8.5, cellPadding: 5, textColor: [30, 41, 59] },
      columnStyles: {
        0: { cellWidth: 72 },
        1: { cellWidth: 112 },
        2: { cellWidth: 105 },
        3: { cellWidth: 62 },
        4: { cellWidth: 'auto' },
      },
      head: [['Date & Time', 'Doctor & Specialty', 'Clinic', 'Status', 'Purpose & Notes']],
      body: apptRows,
    });
  }

  // Page Footer on all pages
  const totalPages = doc.getNumberOfPages();
  const pageHeight = doc.internal.pageSize.getHeight();
  for (let i = 1; i <= totalPages; i++) {
    doc.setPage(i);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(100, 116, 139);
    doc.text(
      'ELDERCARE AI Care Summary — Prepared for physician review. Verify all prescriptions directly with patient records.',
      marginX,
      pageHeight - 24
    );
    doc.text(`Page ${i} of ${totalPages}`, pageWidth - marginX, pageHeight - 24, {
      align: 'right',
    });
  }

  const safeName = circle.elderName.replace(/[^a-zA-Z0-9]+/g, '_').replace(/^_|_$/g, '') || 'Resident';
  const fileName = `ELDERCARE_AI_Doctor_Report_${safeName}_${getLocalDateString()}.pdf`;
  doc.save(fileName);

  return {
    fileName,
    logsExported: includeAdherenceLogs ? filteredLogs.length : 0,
    appointmentsExported: includeAppointments ? appointments.length : 0,
  };
}
