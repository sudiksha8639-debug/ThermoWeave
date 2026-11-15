import { useState, type ReactNode } from 'react';
import { useData } from '../hooks';
import { loadManifest } from '../data';
import { LabelChip } from '../components/LabelChip';
import { DataSourcesPanel } from '../components/DataSourcesPanel';
import { DIAL_CAPTION } from '../components/FireClockDial';
import { ERAS } from '../types';

type TabId = 'methods' | 'reading' | 'limits' | 'provenance';

const TABS: { id: TabId; label: string; blurb: string }[] = [
  { id: 'methods', label: 'Methods', blurb: 'How the record is built' },
  { id: 'reading', label: 'How to read', blurb: 'What each mark means' },
  { id: 'limits', label: 'Limits', blurb: 'What we cannot claim' },
  { id: 'provenance', label: 'Provenance', blurb: 'Files, sources, licences' },
];

function Block({
  title,
  children,
  tone = 'default',
}: {
  title: string;
  children: ReactNode;
  tone?: 'default' | 'warn' | 'key';
}) {
  return (
    <section
      className={`rounded-xl border p-4 ${
        tone === 'warn'
          ? 'border-amber-400/30 bg-amber-400/[0.05]'
          : tone === 'key'
            ? 'border-accent-2/30 bg-accent-2/[0.05]'
            : 'border-line/70 bg-surface/40'
      }`}
    >
      <h3 className="text-[13px] font-semibold text-ink">{title}</h3>
      <div className="mt-2 space-y-2 text-[12px] leading-relaxed text-ink-dim">{children}</div>
    </section>
  );
}

function Rule({ children }: { children: ReactNode }) {
  return (
    <li className="flex gap-2">
      <span aria-hidden="true" className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-accent-2" />
      <span>{children}</span>
    </li>
  );
}

function Quote({ children }: { children: ReactNode }) {
  return (
    <p className="rounded-lg border border-line/70 bg-surface/60 px-3 py-2 font-mono text-[10.5px] leading-relaxed text-ink">
      {children}
    </p>
  );
}

function Methods() {
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Block title="The counting unit" tone="key">
        <p>
          A <strong className="text-ink">burning tile-day</strong> is one H3 resolution-6 tile (about
          36 km²) with at least one clean hotspot on one local solar date. Every headline number is
          burning tile-days at VIIRS scale — relative burning activity, not fire size, burned area or
          a count of fires.
        </p>
        <p>
          Raw hotspot counts are kept for the CSV download and for the calendar&rsquo;s plain-count
          view. Tile-days and raw counts are never mixed in one number.
        </p>
      </Block>

      <Block title="MODIS converts to VIIRS, never the other way">
        <p>
          Per H3 res-3 zone and calendar month, the ratio of VIIRS to MODIS tile-days is learned over
          2012–2019, before Terra and Aqua drifted. Thin zones borrow from the region with about 20
          pseudo tile-days. MODIS tile-days are multiplied by that ratio and capped at the in-scope
          tile count.
        </p>
        <p>
          From 2012 the index uses VIIRS directly, so drift after 2019 never enters the headline
          value. Era A (Terra only) and Era B (Terra ∪ Aqua) use the same learned ratio and carry
          wider ranges.
        </p>
      </Block>

      <Block title="The Fire Clock is a diagnostic" tone="warn">
        <p>
          EMBERWISE learns the MODIS-to-VIIRS conversion in years before the satellites drifted, so
          the headline index is not distorted by drift. The Fire Clock Dial shows exactly when each
          satellite looked, so anyone can see the drift and judge the limits. A chart of the
          MODIS-to-VIIRS ratio by year shows whether, and when, that relationship moved.
        </p>
        <Quote>{DIAL_CAPTION}</Quote>
        <p>
          Never &ldquo;clock-corrected&rdquo; and never &ldquo;drift-corrected&rdquo;: the dial, the
          drift chart and the ratio-by-year chart change nothing in the headline number.
        </p>
      </Block>

      <Block title="Ranges and trust">
        <p>
          The range is the 10th–90th percentile of yearly ratios, widened by the hide-a-year error
          and, for Era A, by the era-B test error. It is a transparent heuristic.
        </p>
        <Quote>Range of yearly ratios, widened by tested error; not a confidence interval.</Quote>
        <p>
          Trust score per tile-month: 100 × (1 − widened range width ÷ value) × era factor, floored at
          0. Era factors are 1.0 Measured, 0.8 Estimated, 0.6 Indicative; Provisional uses 0.9 while
          validation is open. No activity means the score is n/a, not zero.
        </p>
      </Block>

      <Block title="This month, fairly">
        <p>
          A month in progress is compared with the same days of that month in past years, never with
          a whole past month. The card names the day count, the median of those windows, the percent
          difference and the rank band (below 10% much below, 10–30 below, 30–70 near, 70–90 above,
          above 90 much above).
        </p>
        <p>Newest days come from near-real-time data and are labelled Provisional.</p>
      </Block>

      <Block title="Two 2026 seams, shown separately">
        <p>
          First the NRT seam: NRT against standard processing for the same satellite, in months where
          both exist. If the shift is material, a per-zone-month NRT factor is applied and labelled.
          Then the relay seam: the relay satellite aligned to Suomi NPP on shared years, shown after
          the NRT factor.
        </p>
        <p>
          Real data after 2 November 2026 is Provisional and carries no percent-shift claim. The
          Sensor-Loss panel is a simulation on a past season, not a measured real-world percentage.
        </p>
      </Block>

      <Block title="Eras">
        <ul className="space-y-1.5">
          {ERAS.map((e) => (
            <li key={e.id} className="flex flex-wrap items-center gap-2">
              <LabelChip label={e.trust} />
              <span className="text-ink">{e.name}</span>
              <span className="font-mono text-[10px] text-ink-dim">
                {e.start} → {e.end || 'open'}
              </span>
            </li>
          ))}
        </ul>
      </Block>

      <Block title="Checks with named owners">
        <p>
          Hide-a-year, error by activity level, both baselines, the rank test, ratio stability, the
          NRT seam, the relay seam and the ratio-by-year chart are visible in Proof / Lab. Failures
          are shown with a caveat; a visible weakness scores better than a hidden one.
        </p>
      </Block>
    </div>
  );
}

function Reading() {
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Block title="Trust labels" tone="key">
        <ul className="space-y-2">
          <li className="flex gap-2">
            <LabelChip label="Measured" className="mt-0.5 shrink-0" />
            <span>Direct observation from one consistent sensor.</span>
          </li>
          <li className="flex gap-2">
            <LabelChip label="Estimated" className="mt-0.5 shrink-0" />
            <span>Modelled across overlapping sensors; wider range.</span>
          </li>
          <li className="flex gap-2">
            <LabelChip label="Indicative" className="mt-0.5 shrink-0" />
            <span>Early single-sensor era — directional only.</span>
          </li>
          <li className="flex gap-2">
            <LabelChip label="Provisional" className="mt-0.5 shrink-0" />
            <span>Newest data, pending cross-calibration.</span>
          </li>
        </ul>
      </Block>

      <Block title="Marks and patterns">
        <ul className="space-y-1.5">
          <Rule>
            <strong className="text-ink">Solid colour</strong> is the value. Colour is never the
            only clue: a dotted box marks an era that is estimated, indicative or provisional.
          </Rule>
          <Rule>
            <strong className="text-ink">Blank days</strong> are gaps — no usable observation. They
            are never drawn as zero burning.
          </Rule>
          <Rule>
            <strong className="text-ink">Band under the line</strong> is the lo–hi range from the
            widened yearly ratios, not a confidence interval.
          </Rule>
          <Rule>
            <strong className="text-ink">Two lines</strong> in the series compare raw MODIS, raw
            VIIRS and the harmonized value on the same axis.
          </Rule>
        </ul>
      </Block>

      <Block title="Calendar">
        <p>
          Years run down the grid, months across. Switch between harmonized tile-days and the plain
          raw hotspot count. Click a box to load that month on the map; the arrow keys move between
          boxes and a text-table alternative is one click away.
        </p>
      </Block>

      <Block title="Fire Clock Dial" tone="warn">
        <p>
          Each bar is detections in one local solar hour, and the thin arcs mark nominal overpass
          windows. The shape shows when the satellites looked, not when fires burned.
        </p>
        <Quote>{DIAL_CAPTION}</Quote>
      </Block>

      <Block title="Phantom Surge">
        <p>
          The dashed line is a naive stitch of raw sensor counts; the ember-to-teal line is the
          harmonized record. Replay melts one into the other. The 2012 handover is the seam the app
          exists to remove.
        </p>
      </Block>

      <Block title="Saturation">
        <p>
          When much of the region is burning, tile-days flatten: two days can look equal while one
          had far more fire. Read the fraction of tiles burning and the raw hotspot view beside the
          index in peak weeks.
        </p>
      </Block>
    </div>
  );
}

function Limits() {
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Block title="Stated limits" tone="warn">
        <ul className="space-y-2">
          <Rule>
            A MODIS-to-VIIRS relationship learned after 2012 is applied to years before 2012. That
            backward extrapolation cannot be fully tested.
          </Rule>
          <Rule>
            Behaviour confound: burning in the region has shifted later in the day, and Terra (about
            10:30) sees less afternoon burning than VIIRS (about 13:30). A learned ratio may partly
            reflect habit rather than sensor difference. The ratio-by-year chart shows how much.
          </Rule>
          <Rule>
            Saturation: at the peak many tiles burn, so tile-days flatten. Use the fraction burning
            and the raw hotspot view together.
          </Rule>
          <Rule>
            The index is relative activity, not fire size, burned area or total fires. A hotspot is
            not a confirmed fire; no hotspot is not no fire.
          </Rule>
          <Rule>
            Era A (Terra only) is the least certain. Where burning has shifted to late afternoon,
            counts can understate activity.
          </Rule>
          <Rule>
            Validated for Indian Punjab and Haryana only. Other regions are roadmap unless shown
            passing the same checks. Boundaries are approximate and not an official depiction.
          </Rule>
          <Rule>
            The external check uses a source that is only partly independent and may itself miss
            small crop fires; a weak correlation is reported, not hidden.
          </Rule>
        </ul>
      </Block>

      <div className="space-y-4">
        <Block title="What the app does not do">
          <ul className="space-y-1.5">
            <Rule>It does not add MODIS and VIIRS observations together.</Rule>
            <Rule>It does not interpolate missing observations or fill gaps with zeros.</Rule>
            <Rule>It does not forecast, warn or model fire spread.</Rule>
            <Rule>It does not claim clock-correcting or drift-correcting a value.</Rule>
            <Rule>It does not present mock development data as a scientific finding.</Rule>
          </ul>
        </Block>
        <Block title="Safety" tone="warn">
          <p className="text-amber-200/90">
            Not an official fire alert, perimeter map or emergency tool. Relative burning activity at
            VIIRS scale — not fire size or burned area. For an emergency, contact local authorities.
          </p>
        </Block>
        <Block title="Open work">
          <p>
            The Transparency Lab marks every diagnostic whose file has not been supplied yet with a
            &ldquo;Not supplied&rdquo; chip and lists the exact field it needs. Nothing is replaced
            by a placeholder number.
          </p>
        </Block>
      </div>
    </div>
  );
}

function Provenance() {
  const manifestQ = useData(loadManifest, []);
  const m = manifestQ.data;
  const fields: [string, unknown][] = [
    ['schema_version', m?.schema_version],
    ['model_version', m?.model_version],
    ['boundary_source', m?.boundary_source],
    ['boundary_licence', m?.boundary_licence],
    ['ai_use_note', m?.ai_use_note],
  ];

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Block title="Manifest" tone="key">
        {manifestQ.loading && <p>Loading the manifest…</p>}
        {manifestQ.error && <p className="text-red-300">{manifestQ.error}</p>}
        {!manifestQ.loading && !manifestQ.error && (
          <table className="w-full text-[11px]">
            <tbody>
              {fields.map(([k, v]) => (
                <tr key={k} className="border-t border-line/60">
                  <td className="py-1 pr-3 font-mono text-ink-dim">{k}</td>
                  <td className="py-1 text-ink">{v === undefined || v === null || v === '' ? '—' : String(v)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <p>
          The manifest is the receipt: schema version, model version, boundary source and licence,
          file hashes and the AI-use note. When a field is missing the value stays blank rather than
          being guessed.
        </p>
      </Block>

      <Block title="Data sources and file state">
        <p>
          Every screen reads small static JSON files. Missing or schema-only files fall back to the
          bundled synthetic development mocks, and the panel below names which file came from where.
        </p>
        <div className="pt-1">
          <DataSourcesPanel />
        </div>
      </Block>

      <Block title="NASA FIRMS">
        <p>
          Hotspots originate from NASA FIRMS active-fire products: MODIS (MOD14A1/MYD14A1) and VIIRS
          (VNP14IMGT and the NOAA-20/21 equivalents), with standard processing for history and
          near-real-time products only for months standard processing does not yet cover.
        </p>
        <p>
          Raw files are never edited. Product names, download dates and versions live in the
          manifest. No NASA logo or wording implies NASA endorsement.
        </p>
      </Block>

      <Block title="Development data notice" tone="warn">
        <p>
          In this build, the repo data files are schema-only stubs, so the interface runs on clearly
          labelled synthetic mocks. Diagnostics computed in the browser from those mocks are marked
          as development-window results and must not be quoted as findings.
        </p>
        <p>
          Replace the files in <span className="font-mono">mock-data/</span> (or{' '}
          <span className="font-mono">web/public/data/</span>) with the official outputs; the same
          screens then show the real record with no code change.
        </p>
      </Block>
    </div>
  );
}

export function Docs() {
  const [tab, setTab] = useState<TabId>('methods');
  return (
    <div className="space-y-4">
      <section className="card p-5 sm:p-6">
        <p className="section-label">Documentation</p>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight text-ink sm:text-[28px]">
          Methods, reading guide and limits.
        </h1>
        <p className="mt-2 max-w-3xl text-sm leading-relaxed text-ink-dim">
          The full explanation behind every number, kept beside the app rather than in a slide. If a
          claim cannot be tested, it appears under Limits with the reason.
        </p>
        <div className="mt-4 flex flex-wrap gap-2" role="tablist" aria-label="Documentation sections">
          {TABS.map((t) => (
            <button
              key={t.id}
              role="tab"
              id={`tab-${t.id}`}
              aria-selected={tab === t.id}
              aria-controls={`panel-${t.id}`}
              onClick={() => setTab(t.id)}
              className={`btn btn-sm ${tab === t.id ? 'btn-primary' : 'btn-ghost'}`}
              title={t.blurb}
            >
              {t.label}
            </button>
          ))}
        </div>
      </section>

      <div
        role="tabpanel"
        id={`panel-${tab}`}
        aria-labelledby={`tab-${tab}`}
        className="rise"
      >
        {tab === 'methods' && <Methods />}
        {tab === 'reading' && <Reading />}
        {tab === 'limits' && <Limits />}
        {tab === 'provenance' && <Provenance />}
      </div>

      <section className="card border-amber-400/25 bg-amber-400/[0.04] p-4">
        <p className="text-xs leading-relaxed text-amber-200/90">
          Not an official fire alert, perimeter map or emergency tool. Missing observations stay
          gaps, never zeros; MODIS and VIIRS are never added together; every estimate carries its
          label and range.
        </p>
      </section>
    </div>
  );
}
