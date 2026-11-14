import { useEffect, useState } from 'react';
import { ACCENT_2 } from '../theme';

// Visible online/offline indicator + service-worker cache controls.
// Rendered in the footer on every screen.
export function ConnectionBadge() {
  const [online, setOnline] = useState(() => navigator.onLine);
  const [cacheCount, setCacheCount] = useState<number | null>(null);
  const [cleared, setCleared] = useState(false);

  useEffect(() => {
    const up = () => setOnline(true);
    const down = () => setOnline(false);
    window.addEventListener('online', up);
    window.addEventListener('offline', down);
    return () => {
      window.removeEventListener('online', up);
      window.removeEventListener('offline', down);
    };
  }, []);

  useEffect(() => {
    if (!('caches' in window)) return;
    caches.keys().then((ks) => setCacheCount(ks.length)).catch(() => {});
  }, [cleared]);

  const clearCache = async () => {
    if (!('caches' in window)) return;
    const ks = await caches.keys();
    await Promise.all(ks.map((k) => caches.delete(k)));
    setCleared(true);
    setCacheCount(0);
    // re-register so the shell re-precaches on next load
    if ('serviceWorker' in navigator && import.meta.env.PROD) {
      const regs = await navigator.serviceWorker.getRegistrations();
      await Promise.all(regs.map((r) => r.update()));
    }
  };

  return (
    <div className="flex flex-wrap items-center gap-2.5 text-[11px] text-ink-dim">
      <span
        role="status"
        aria-live="polite"
        className="inline-flex items-center gap-1.5 rounded-full border border-line/70 bg-surface/40 px-2.5 py-1"
        title={online ? 'Online' : 'Offline — showing cached data only'}
      >
        <span
          aria-hidden="true"
          className="inline-block h-1.5 w-1.5 rounded-full"
          style={{
            background: online ? ACCENT_2 : '#f0a03c',
            boxShadow: `0 0 8px ${online ? ACCENT_2 : '#f0a03c'}`,
          }}
        />
        {online ? 'Online' : 'Offline — cached data only'}
      </span>
      {cacheCount !== null && cacheCount > 0 && (
        <button onClick={clearCache} className="btn btn-ghost btn-sm">
          Clear cache ({cacheCount} store{cacheCount === 1 ? '' : 's'})
        </button>
      )}
      {cleared && <span className="text-[11px] text-accent-2">Cache cleared — reload to repopulate.</span>}
    </div>
  );
}
