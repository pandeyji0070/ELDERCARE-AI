import { useState } from 'react';

interface AvatarImgProps {
  src: string;
  alt: string;
  fallbackInitials: string;
  className?: string;
}

export function AvatarImg({ src, alt, fallbackInitials, className = 'w-12 h-12' }: AvatarImgProps) {
  const [failed, setFailed] = useState(false);

  if (failed) {
    return (
      <div
        aria-label={alt}
        className={`${className} rounded-2xl bg-teal-100 text-teal-900 font-bold flex items-center justify-center shrink-0 border border-teal-200`}
      >
        {fallbackInitials}
      </div>
    );
  }

  return (
    <img
      src={src}
      alt={alt}
      referrerPolicy="no-referrer"
      onError={() => setFailed(true)}
      className={`${className} rounded-2xl object-cover shrink-0 border border-slate-200 bg-slate-100`}
    />
  );
}
