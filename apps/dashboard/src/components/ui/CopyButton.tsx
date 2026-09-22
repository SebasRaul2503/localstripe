import { useEffect, useState } from 'react';
import { Check, Copy } from 'lucide-react';
import clsx from 'clsx';
import { copyText } from '../../lib/clipboard';

export function CopyButton({
  value,
  label = 'Copy',
  className,
  showLabel = false,
}: {
  value: string;
  label?: string;
  className?: string;
  showLabel?: boolean;
}) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return undefined;
    const timeout = setTimeout(() => setCopied(false), 1500);
    return () => clearTimeout(timeout);
  }, [copied]);

  return (
    <button
      type="button"
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        void copyText(value).then(setCopied);
      }}
      className={clsx(
        'inline-flex shrink-0 items-center gap-1 rounded p-1 text-xs text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-white',
        className,
      )}
      aria-label={copied ? 'Copied' : `${label}: ${value}`}
      title={copied ? 'Copied!' : label}
    >
      {copied ? (
        <Check className="size-3.5 text-emerald-600" aria-hidden />
      ) : (
        <Copy className="size-3.5" aria-hidden />
      )}
      {showLabel ? <span>{copied ? 'Copied' : label}</span> : null}
      <span className="sr-only" aria-live="polite">
        {copied ? 'Copied to clipboard' : ''}
      </span>
    </button>
  );
}
