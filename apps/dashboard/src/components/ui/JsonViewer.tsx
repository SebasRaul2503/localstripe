import { CopyButton } from './CopyButton';

export function JsonViewer({ value, maxHeight = '32rem' }: { value: unknown; maxHeight?: string }) {
  const json = JSON.stringify(value, null, 2);
  return (
    <div className="relative rounded-md border border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-950">
      <div className="absolute top-1.5 right-1.5">
        <CopyButton value={json} label="Copy JSON" showLabel />
      </div>
      <pre
        className="overflow-auto p-3 pr-20 font-mono text-xs leading-relaxed text-zinc-800 dark:text-zinc-200"
        style={{ maxHeight }}
        tabIndex={0}
        aria-label="JSON"
      >
        {json}
      </pre>
    </div>
  );
}
