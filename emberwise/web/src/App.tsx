import { useEffect } from 'react';
import { AppProvider, useApp } from './state';
import { Story } from './screens/Story';
import { Workspace } from './screens/Workspace';
import { Proof } from './screens/Proof';
import { DataSourcesPanel } from './components/DataSourcesPanel';
import { ConnectionBadge } from './components/CacheControls';

const NAV = [
  { id: 'story', label: 'Story' },
  { id: 'workspace', label: 'Workspace' },
  { id: 'proof', label: 'Proof / Lab' },
] as const;

function Brand({ onClick }: { onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="group flex items-center gap-2.5 rounded-xl pr-1 text-left"
      aria-label="EMBERWISE home"
    >
      <span className="relative grid h-10 w-10 place-items-center">
        <span
          aria-hidden="true"
          className="absolute inset-0 rounded-full bg-accent/25 blur-md transition group-hover:bg-accent/40"
        />
        <svg width="32" height="32" viewBox="0 0 40 40" aria-hidden="true" className="relative">
          <defs>
            <linearGradient id="brand-tile" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0" stopColor="#1a2540" />
              <stop offset="0.55" stopColor="#101a30" />
              <stop offset="1" stopColor="#0a1120" />
            </linearGradient>
            <linearGradient id="brand-edge" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0" stopColor="#ffc878" />
              <stop offset="0.6" stopColor="#f6a544" />
              <stop offset="1" stopColor="#5ee0d0" />
            </linearGradient>
            <linearGradient id="brand-flame" x1="0.5" y1="0" x2="0.5" y2="1">
              <stop offset="0" stopColor="#ffe2ab" />
              <stop offset="0.5" stopColor="#ffbd68" />
              <stop offset="1" stopColor="#ef8a2a" />
            </linearGradient>
          </defs>
          <rect
            x="1"
            y="1"
            width="38"
            height="38"
            rx="12"
            fill="url(#brand-tile)"
            stroke="url(#brand-edge)"
            strokeWidth="1.5"
          />
          <path
            d="M20 8.8c4.4 3.8 7.2 7.5 7.2 11.8 0 4.4-3.2 7.9-7.2 7.9s-7.2-3.5-7.2-7.9c0-4.3 2.8-8 7.2-11.8z"
            fill="url(#brand-flame)"
          />
          <circle cx="27.4" cy="12.6" r="1.5" fill="#7deade" />
        </svg>
      </span>
      <span className="leading-tight">
        <span className="block text-[16px] font-bold tracking-[0.02em]">
          EMBER
          <span className="bg-gradient-to-r from-[#ffc878] to-[#ef8a2a] bg-clip-text text-transparent">
            WISE
          </span>
        </span>
        <span className="hidden text-[10px] font-medium uppercase tracking-[0.18em] text-ink-dim sm:block">
          Harmonized fire record
        </span>
      </span>
    </button>
  );
}

function Shell() {
  const { screen, go } = useApp();

  return (
    <div className="flex min-h-full flex-col">
      <header className="sticky top-0 z-30 border-b border-line/70 bg-surface/75 backdrop-blur-xl">
        <div className="mx-auto flex max-w-[1440px] flex-wrap items-center gap-2 px-4 py-2.5 sm:gap-5">
          <Brand onClick={() => go('story')} />
          <nav
            aria-label="Main"
            className="seg order-3 w-full justify-between sm:order-none sm:ml-4 sm:w-auto"
          >
            {NAV.map((n) => (
              <button
                key={n.id}
                onClick={() => go(n.id)}
                aria-current={screen === n.id ? 'page' : undefined}
                className="seg-item flex-1 text-center sm:flex-none"
              >
                {n.label}
              </button>
            ))}
          </nav>
          <span className="ml-auto hidden text-[11px] text-ink-dim lg:block">
            MODIS–VIIRS · Punjab &amp; Haryana
          </span>
        </div>
      </header>

      <main className="mx-auto w-full max-w-[1440px] flex-1 px-4 py-6 sm:py-8">
        {screen === 'story' && <Story />}
        {screen === 'workspace' && <Workspace />}
        {screen === 'proof' && <Proof />}
      </main>

      <footer className="mt-4 border-t border-line/70 bg-surface/60">
        <div className="mx-auto max-w-[1440px] space-y-3 px-4 py-4">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <ConnectionBadge />
            <p className="text-[11px] text-ink-dim">
              Relative burning activity at VIIRS scale — not fire size or burned area.
            </p>
          </div>
          <DataSourcesPanel />
          <p className="text-center text-[11px] text-ink-dim">
            Not an official fire alert, perimeter map or emergency tool.
          </p>
        </div>
      </footer>
    </div>
  );
}

export default function App() {
  useEffect(() => {
    if ('serviceWorker' in navigator && import.meta.env.PROD) {
      navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`).catch(() => {});
    }
  }, []);

  return (
    <AppProvider>
      <Shell />
    </AppProvider>
  );
}
