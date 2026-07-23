import { useState } from 'react';
import { useDebugLogs } from '../../hooks/useRuntime';

export function DebugConsole() {
  const { logs, clearDebugLogs } = useDebugLogs();
  const [open, setOpen] = useState(false);

  if (!open) {
    return (
      <button
        type="button"
        className="p6-debug-toggle fixed bottom-3 right-3 z-[9999] rounded-lg bg-slate-800/90 px-3 py-2 text-xs font-semibold text-slate-200 shadow-lg backdrop-blur"
        onClick={() => setOpen(true)}
      >
        Debug ({logs.length})
      </button>
    );
  }

  return (
    <aside className="p6-debug-console fixed bottom-0 right-0 z-[9999] flex h-[45vh] w-full max-w-xl flex-col border border-slate-700 bg-slate-950/95 shadow-2xl backdrop-blur sm:rounded-tl-xl">
      <header className="flex items-center justify-between border-b border-slate-800 px-3 py-2">
        <span className="text-xs font-bold uppercase tracking-wider text-slate-300">
          Runtime Debug
        </span>
        <div className="flex gap-2">
          <button
            type="button"
            className="rounded px-2 py-1 text-xs text-slate-400 hover:bg-slate-800"
            onClick={clearDebugLogs}
          >
            Clear
          </button>
          <button
            type="button"
            className="rounded px-2 py-1 text-xs text-slate-400 hover:bg-slate-800"
            onClick={() => setOpen(false)}
          >
            Close
          </button>
        </div>
      </header>
      <div className="flex-1 overflow-y-auto p-2 font-mono text-[11px] leading-relaxed">
        {logs.length === 0 ? (
          <p className="text-slate-500">No logs yet.</p>
        ) : (
          logs.map((log) => (
            <div key={log.id} className="mb-2 border-b border-slate-900 pb-2">
              <div className="text-slate-500">
                {log.timestamp.slice(11, 19)} · {log.category}
              </div>
              <div className="text-slate-200">{log.message}</div>
              {log.data != null && (
                <pre className="mt-1 max-h-24 overflow-auto text-slate-400">
                  {JSON.stringify(log.data, null, 2)}
                </pre>
              )}
            </div>
          ))
        )}
      </div>
    </aside>
  );
}
