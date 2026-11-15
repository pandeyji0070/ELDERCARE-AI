import { CheckCircle2, AlertTriangle, Info, X } from 'lucide-react';
import type { ToastMessage } from '../types';

interface ToastBannerProps {
  toasts: ToastMessage[];
  onDismiss: (id: string) => void;
}

export function ToastBanner({ toasts, onDismiss }: ToastBannerProps) {
  if (toasts.length === 0) return null;

  return (
    <div
      aria-live="polite"
      className="fixed top-16 right-4 left-4 md:left-auto md:w-[420px] z-50 flex flex-col gap-2 pointer-events-none"
    >
      {toasts.map((toast) => {
        const isSuccess = toast.type === 'success';
        const isError = toast.type === 'error';

        const containerClass = isSuccess
          ? 'bg-emerald-50 border-emerald-300 text-emerald-950'
          : isError
          ? 'bg-rose-50 border-rose-300 text-rose-950'
          : 'bg-sky-50 border-sky-300 text-sky-950';

        const Icon = isSuccess ? CheckCircle2 : isError ? AlertTriangle : Info;
        const iconClass = isSuccess
          ? 'text-emerald-700'
          : isError
          ? 'text-rose-700'
          : 'text-sky-700';

        return (
          <div
            key={toast.id}
            role="status"
            className={`pointer-events-auto flex items-start gap-3 p-4 rounded-2xl border shadow-lg ${containerClass}`}
          >
            <Icon className={`w-6 h-6 shrink-0 mt-0.5 ${iconClass}`} aria-hidden="true" />
            <div className="flex-1 min-w-0">
              <p className="text-base font-semibold leading-snug">{toast.title}</p>
              {toast.detail && (
                <p className="text-sm opacity-90 mt-1 leading-relaxed">{toast.detail}</p>
              )}
            </div>
            <button
              type="button"
              onClick={() => onDismiss(toast.id)}
              aria-label="Dismiss notification"
              className="min-h-[44px] min-w-[44px] -m-2 flex items-center justify-center rounded-xl hover:bg-black/5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        );
      })}
    </div>
  );
}
