import { useEffect } from 'react';
import { AppProvider, useApp } from './state';
import { Story } from './screens/Story';
import { Workspace } from './screens/Workspace';
import { Proof } from './screens/Proof';
import { DataSourcesPanel } from './components/DataSourcesPanel';
import { ConnectionBadge } from './components/CacheControls';
import { ACCENT } from './theme';

const NAV = [
  { id: 'story', label: 'Story' },
  { id: 'workspace', label: 'Workspace' },
  { id: 'proof', label: 'Proof / Lab' },
] as const;

function Shell() {
  const { screen, go } = useApp();

  return (
    <div className="flex min-h-full flex-col">
      <header className="border-b border-line bg-surface-2/60">
        <div className="mx-auto flex max-w-[1400px] items-center gap-6 px-4 py-3">
          <button
            onClick={() => go('story')}
            className="flex items-center gap-2 text-lg font-bold tracking-tight"
            aria-label="EMBERWISE home"
          >
            <svg width="22" height="22" viewBox="0 0 32 32" aria-hidden="true">
              <polygon points="16,2 30,9 30,23 16,30 2,23 2,9" fill={ACCENT} />
            </svg>
            EMBERWISE
          </button>
          <nav aria-label="Main" className="flex gap-1">
            {NAV.map((n) => (
              <button
                key={n.id}
                onClick={() => go(n.id)}
                aria-current={screen === n.id ? 'page' : undefined}
                className={`rounded px-3 py-1.5 text-sm ${
                  screen === n.id
                    ? 'bg-line/60 font-semibold text-ink'
                    : 'text-ink-dim hover:text-ink'
                }`}
              >
                {n.label}
              </button>
            ))}
          </nav>
          <span className="ml-auto hidden text-[11px] text-ink-dim sm:block">
            MODIS–VIIRS harmonization · Punjab &amp; Haryana
          </span>
        </div>
      </header>

      <main className="mx-auto w-full max-w-[1400px] flex-1 px-4 py-6">
        {screen === 'story' && <Story />}
        {screen === 'workspace' && <Workspace />}
        {screen === 'proof' && <Proof />}
      </main>

      <footer className="border-t border-line bg-surface-2/60">
        <div className="mx-auto max-w-[1400px] space-y-2 px-4 py-3">
          <ConnectionBadge />
          <DataSourcesPanel />
          <p className="text-center text-xs text-ink-dim">
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
