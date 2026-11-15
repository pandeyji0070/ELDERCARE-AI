import { useState } from 'react';
import { AlertOctagon, PhoneCall, ShieldAlert, X } from 'lucide-react';
import type { CareCircle } from '../types';

interface SosModalProps {
  open: boolean;
  circle: CareCircle;
  submitting: boolean;
  onClose: () => void;
  onConfirmSos: (note: string) => Promise<void>;
}

export function SosModal({ open, circle, submitting, onClose, onConfirmSos }: SosModalProps) {
  const [understoodDemoOnly, setUnderstoodDemoOnly] = useState(false);
  const [note, setNote] = useState('');

  if (!open) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!understoodDemoOnly || submitting) return;
    await onConfirmSos(note);
    setUnderstoodDemoOnly(false);
    setNote('');
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="sos-modal-title"
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-slate-950/65 backdrop-blur-sm p-0 sm:p-4"
    >
      <div className="w-full sm:max-w-lg bg-white rounded-t-3xl sm:rounded-3xl border border-slate-200 shadow-2xl overflow-hidden">
        <div className="bg-rose-700 text-white px-6 py-5 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <AlertOctagon className="w-8 h-8 shrink-0" aria-hidden="true" />
            <div>
              <h2 id="sos-modal-title" className="text-xl font-bold leading-tight">
                Emergency SOS Confirmation
              </h2>
              <p className="text-sm text-rose-100">Hackathon Demo Alert Workflow</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close SOS modal"
            className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-xl hover:bg-white/15 focus-visible:outline-2 focus-visible:outline-white"
          >
            <X className="w-6 h-6" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-5">
          <div className="p-4 rounded-2xl bg-amber-50 border border-amber-300 text-amber-950 flex items-start gap-3">
            <ShieldAlert className="w-6 h-6 text-amber-700 shrink-0 mt-0.5" aria-hidden="true" />
            <div className="text-sm leading-relaxed space-y-1">
              <p className="font-bold text-base">DEMO ONLY — NO REAL DISPATCH</p>
              <p>
                This SOS trigger is a software demonstration. It records an alert in your Care
                Circle dashboard for caretakers and family, and does <strong>NOT</strong> contact
                911, ambulance services, or emergency dispatchers.
              </p>
              <p className="font-semibold">
                In a real medical emergency, call your local emergency number (e.g., 911)
                immediately.
              </p>
            </div>
          </div>

          <div className="p-4 rounded-2xl bg-slate-50 border border-slate-200 flex items-center justify-between gap-3">
            <div>
              <p className="text-xs font-medium text-slate-500">Primary Emergency Contact</p>
              <p className="text-base font-bold text-slate-900">{circle.emergencyContactName}</p>
              <p className="text-sm text-slate-700 font-mono tabular-nums">
                {circle.emergencyContactPhone}
              </p>
            </div>
            <a
              href={`tel:${circle.emergencyContactPhone.replace(/[^+\d]/g, '')}`}
              className="min-h-[48px] px-4 py-2 rounded-xl bg-white border border-slate-300 text-slate-900 font-semibold text-sm flex items-center gap-2 hover:bg-slate-100 whitespace-nowrap shrink-0"
            >
              <PhoneCall className="w-4 h-4 text-teal-700" aria-hidden="true" />
              Call Contact
            </a>
          </div>

          <div>
            <label htmlFor="sos-note" className="block text-sm font-semibold text-slate-800 mb-1.5">
              Optional Note for Caretaker & Family
            </label>
            <input
              id="sos-note"
              type="text"
              maxLength={250}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="e.g., Feeling dizzy after standing up"
              className="w-full min-h-[48px] px-4 rounded-xl border border-slate-300 text-base text-slate-900 placeholder:text-slate-400 focus:border-rose-600 focus:outline-none"
            />
          </div>

          <label className="flex items-start gap-3 p-4 rounded-2xl border border-slate-200 bg-slate-50 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={understoodDemoOnly}
              onChange={(e) => setUnderstoodDemoOnly(e.target.checked)}
              className="mt-1 w-6 h-6 rounded border-slate-400 text-rose-700 focus:ring-rose-600 shrink-0"
            />
            <span className="text-sm font-medium text-slate-800 leading-relaxed">
              I confirm this is a demo alert only and understand no real emergency dispatch will
              occur.
            </span>
          </label>

          <div className="flex flex-col sm:flex-row gap-3 pt-1">
            <button
              type="button"
              onClick={onClose}
              className="w-full sm:w-1/2 min-h-[52px] px-5 rounded-xl border border-slate-300 bg-white text-slate-800 font-semibold text-base hover:bg-slate-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!understoodDemoOnly || submitting}
              className="w-full sm:w-1/2 min-h-[52px] px-5 rounded-xl bg-rose-700 text-white font-bold text-base hover:bg-rose-800 disabled:opacity-45 disabled:cursor-not-allowed transition-colors"
            >
              {submitting ? 'Logging Demo SOS...' : 'Confirm Demo SOS Alert'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
