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
      className="group flex items-center gap-2.5 rounded-lg pr-1 text-left"
      aria-label="EMBERWISE home"
    >
      <span className="relative grid h-9 w-9 place-items-center">
        <span
          aria-hidden="true"
          className="absolute inset-0 rounded-full bg-accent/25 blur-md transition group-hover:bg-accent/35"
        />
        <svg width="26" height="26" viewBox="0 0 32 32" aria-hidden="true" className="relative">
          <defs>
            <linearGradient id="brand-hex" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0" stopColor="#ffbd68" />
              <stop offset="1" stopColor="#ef8a2a" />
            </linearGradient>
          </defs>
          <polygon points="16,2 30,9 30,23 16,30 2,23 2,9" fill="url(#brand-hex)" />
          <path
            d="M16 8.2c2.5 2.3 4.2 4.4 4.2 7.1 0 2.5-1.9 4.6-4.2 4.6s-4.2-2.1-4.2-4.6c0-2.7 1.7-4.8 4.2-7.1z"
            fill="#0b1020"
            opacity="0.82"
          />
        </svg>
      </span>
      <span className="leading-tight">
        <span className="block text-[15px] font-bold tracking-[0.02em]">EMBERWISE</span>
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
