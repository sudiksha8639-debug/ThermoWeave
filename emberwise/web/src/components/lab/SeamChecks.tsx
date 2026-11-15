import { useMemo } from 'react';
import { LabelChip } from '../LabelChip';
import { ACCENT, ACCENT_2, INK, INK_DIM, LINE } from '../../theme';
import { fmt, fmtPct, observedStep } from '../../lib/derive';
import type { JsonFile, RegionDailyRow } from '../../types';

const RELAY_BOUNDARY = '2026-11-03';

type Obj = Record<string, unknown>;

function isObj(v: unknown): v is Obj {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

function str(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v : null;
}

interface NrtSeam {
  shiftPct: number;
  n: number;
  satellites: string[];
  months: string[];
  thresholdPct: number | null;
  applied: boolean;
}

function readNrtSeam(validation: JsonFile | null): NrtSeam | null {
  const raw = validation?.nrt_seam;
  if (!raw) return null;
  if (Array.isArray(raw)) {
    const rows = raw.filter(isObj);
    const shifts = rows
      .map((r) => num(r.shift_pct) ?? num(r.pct))
      .filter((v): v is number => v !== null);
    if (shifts.length === 0) return null;
    return {
      shiftPct: shifts.reduce((s, v) => s + v, 0) / shifts.length,
      n: rows.length,
      satellites: [...new Set(rows.map((r) => str(r.satellite) ?? str(r.sensor)).filter((s): s is string => !!s))],
      months: [...new Set(rows.map((r) => str(r.month)).filter((s): s is string => !!s))],
      thresholdPct: null,
      applied: rows.some((r) => r.applied === true),
    };
  }
  if (isObj(raw)) {
    const shift = num(raw.shift_pct) ?? num(raw.pct);
    if (shift === null) return null;
    return {
      shiftPct: shift,
      n: num(raw.n_pairs) ?? 0,
      satellites: [str(raw.satellite) ?? str(raw.sensor) ?? 'same satellite'].filter(Boolean),
      months: [],
      thresholdPct: num(raw.threshold_pct),
      applied: raw.factor_applied === true || raw.applied === true,
    };
  }
  return null;
}

interface RelaySeam {
  shiftPct: number;
  relaySatellite: string | null;
  overlapYears: number | null;
}

function readRelaySeam(validation: JsonFile | null): RelaySeam | null {
  const raw = validation?.relay_seam;
  if (!isObj(raw)) return null;
  const shift = num(raw.shift_pct) ?? num(raw.pct);
  if (shift === null) return null;
  return {
    shiftPct: shift,
    relaySatellite: str(raw.relay_satellite) ?? str(raw.satellite),
    overlapYears: num(raw.overlap_years),
  };
}

interface HistoricSeam {
  naiveStepPct: number | null;
  harmStepPct: number | null;
}

function readSeam(validation: JsonFile | null): HistoricSeam | null {
  const raw = validation?.seam;
  if (!isObj(raw)) return null;
  const naive = num(raw.naive_step_pct) ?? num(raw.naive_pct) ?? num(raw.before_pct);
  const harm = num(raw.harm_step_pct) ?? num(raw.harmonized_step_pct) ?? num(raw.after_pct);
  if (naive === null && harm === null) return null;
  return { naiveStepPct: naive, harmStepPct: harm };
}

function ShiftBar({ pct, tone = 'ember' }: { pct: number; tone?: 'ember' | 'teal' }) {
  const clamped = Math.max(-40, Math.min(40, pct));
  const half = 50;
  const w = (Math.abs(clamped) / 40) * half;
  const color = tone === 'teal' ? ACCENT_2 : ACCENT;
  return (
    <div className="relative mt-2 h-2 overflow-hidden rounded-full bg-surface/70 ring-1 ring-line/50">
      <span aria-hidden="true" className="absolute inset-y-0 left-1/2 w-px bg-line" />
      <span
        aria-hidden="true"
        className="absolute top-0 h-full rounded-full"
        style={{
          left: clamped >= 0 ? `${half}%` : `${half - w}%`,
          width: `${Math.max(1.5, w)}%`,
          background: color,
        }}
      />
    </div>
  );
}

function EmptySeam({
  title,
  requirement,
  explanation,
}: {
  title: string;
  requirement: string;
  explanation: string;
}) {
  return (
    <div className="rounded-xl border border-dashed border-line/80 bg-surface/30 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-[12px] font-semibold text-ink">{title}</h3>
        <LabelChip label="Not supplied" />
      </div>
      <p className="mt-1.5 text-[10.5px] leading-relaxed text-ink-dim">{explanation}</p>
      <p className="mt-1.5 rounded-md border border-line/60 bg-surface/50 px-2 py-1.5 font-mono text-[9.5px] leading-relaxed text-ink-dim">
        Required: {requirement}
      </p>
    </div>
  );
}

/**
 * Both 2026 seams, shown separately: NRT versus SP on the same satellite
 * first, then the relay satellite. When the validated pair data is not in the
 * loaded files the panel says exactly what is missing instead of drawing a
 * placeholder shift.
 */
export function SeamChecksPanel({
  validation,
  dailyRows,
  loading,
  error,
}: {
  validation: JsonFile | null;
  dailyRows: RegionDailyRow[];
  loading: boolean;
  error: string | null;
}) {
  const nrt = useMemo(() => readNrtSeam(validation), [validation]);
  const relay = useMemo(() => readRelaySeam(validation), [validation]);
  const historic = useMemo(() => readSeam(validation), [validation]);
  const observed = useMemo(() => observedStep(dailyRows, RELAY_BOUNDARY, 14), [dailyRows]);

  return (
    <section className="card flex min-w-0 flex-col p-4 lg:col-span-2" aria-labelledby="seam-title">
      <header className="mb-2 flex items-start justify-between gap-3">
        <div>
          <h2 id="seam-title" className="card-title">
            Seam checks
          </h2>
          <p className="mt-1 text-[11px] leading-relaxed text-ink-dim">
            Two things change in November 2026: standard processing hands over to near-real-time
            (NRT), and Suomi NPP hands over to the relay satellite. They are reported separately, in
            that order.
          </p>
        </div>
        <LabelChip label="Provisional" />
      </header>

      {loading && <p className="py-8 text-center text-xs text-ink-dim">Loading seam diagnostics…</p>}
      {error && !loading && <p className="py-4 text-xs text-red-300">{error}</p>}

      {!loading && !error && (
        <div className="grid gap-3 md:grid-cols-2">
          {/* Step 1 — NRT seam */}
          <div className="rounded-xl border border-line/70 bg-surface/40 p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-[12px] font-semibold text-ink">Step 1 · NRT seam</h3>
              <LabelChip label={nrt ? 'Estimated' : 'Not supplied'} />
            </div>
            {nrt ? (
              <>
                <div className="mt-2 flex flex-wrap items-baseline gap-2">
                  <span className="font-mono text-xl text-ink">{fmtPct(nrt.shiftPct, 1)}</span>
                  <span className="text-[10.5px] text-ink-dim">
                    NRT vs SP, same satellite{nrt.n ? ` · ${nrt.n} pairs` : ''}
                  </span>
                </div>
                <ShiftBar pct={nrt.shiftPct} />
                <p className="mt-2 text-[10.5px] leading-relaxed text-ink-dim">
                  {nrt.satellites.join(', ')}
                  {nrt.months.length ? ` · ${nrt.months.join(', ')}` : ''}.{' '}
                  {nrt.thresholdPct !== null
                    ? `Threshold ${nrt.thresholdPct}% — ${
                        nrt.applied ? 'a per-zone-month NRT factor is applied' : 'no factor needed'
                      }.`
                    : nrt.applied
                      ? 'A per-zone-month NRT factor is applied and labelled.'
                      : 'No factor recorded.'}
                </p>
              </>
            ) : (
              <EmptySeam
                title="Same-satellite NRT vs SP"
                requirement="validation.nrt_seam — rows or summary with satellite, month, sp_tile_days, nrt_tile_days, shift_pct (M1 pairs, M2 evaluates)"
                explanation="The bundled coverage file only carries standard-processing products, so NRT and SP cannot be compared in the browser. The panel is kept here so the check has a home on screen."
              />
            )}
          </div>

          {/* Step 2 — relay seam */}
          <div className="rounded-xl border border-line/70 bg-surface/40 p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-[12px] font-semibold text-ink">Step 2 · Relay seam</h3>
              <LabelChip label={relay ? 'Estimated' : 'Not supplied'} />
            </div>
            {relay ? (
              <>
                <div className="mt-2 flex flex-wrap items-baseline gap-2">
                  <span className="font-mono text-xl text-ink">{fmtPct(relay.shiftPct, 1)}</span>
                  <span className="text-[10.5px] text-ink-dim">
                    Suomi NPP → {relay.relaySatellite ?? 'relay'}
                    {relay.overlapYears ? ` · ${relay.overlapYears} shared years` : ''}
                  </span>
                </div>
                <ShiftBar pct={relay.shiftPct} tone="teal" />
                <p className="mt-2 text-[10.5px] leading-relaxed text-ink-dim">
                  Shown after the NRT factor, so the two changes are never conflated.
                </p>
              </>
            ) : (
              <EmptySeam
                title="Relay alignment"
                requirement="validation.relay_seam — relay_satellite, overlap_years, shift_pct (aligned on SP-to-SP shared years)"
                explanation="The relay alignment is not in the loaded validation file. The observed step in the bundled daily record is shown below as indicative context only — it is not a validated percent shift."
              />
            )}
            {observed && (
              <div className="mt-2 rounded-lg border border-line/60 bg-surface/50 px-2.5 py-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="section-label">Observed step in bundled data</span>
                  <LabelChip label="Indicative" />
                </div>
                <p className="mt-1 font-mono text-[12.5px] text-ink">
                  {fmtPct(observed.pct, 1)}{' '}
                  <span className="font-sans text-[10px] font-normal text-ink-dim">
                    around {RELAY_BOUNDARY}
                  </span>
                </p>
                <p className="mt-1 text-[9.5px] leading-snug text-ink-dim">
                  14-day means: {fmt(observed.beforeMean, 1)} before ({observed.beforeDays} days) →{' '}
                  {fmt(observed.afterMean, 1)} after ({observed.afterDays} days) tile-days/day.
                  Short windows and development data — not a relay calibration.
                </p>
              </div>
            )}
          </div>

          {/* Historic 2012 seam */}
          <div className="rounded-xl border border-line/70 bg-surface/40 p-3 md:col-span-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-[12px] font-semibold text-ink">The 2012 seam · before vs after harmonizing</h3>
              <LabelChip label={historic ? 'Estimated' : 'Not supplied'} />
            </div>
            {historic ? (
              <div className="mt-2 grid gap-3 sm:grid-cols-2">
                <div>
                  <p className="section-label">Naive step</p>
                  <p className="font-mono text-lg text-ink">
                    {historic.naiveStepPct === null ? '—' : fmtPct(historic.naiveStepPct, 1)}
                  </p>
                  {historic.naiveStepPct !== null && <ShiftBar pct={historic.naiveStepPct} />}
                </div>
                <div>
                  <p className="section-label">Harmonized step</p>
                  <p className="font-mono text-lg text-ink">
                    {historic.harmStepPct === null ? '—' : fmtPct(historic.harmStepPct, 1)}
                  </p>
                  {historic.harmStepPct !== null && <ShiftBar pct={historic.harmStepPct} tone="teal" />}
                </div>
              </div>
            ) : (
              <p className="mt-1.5 text-[10.5px] leading-relaxed text-ink-dim">
                Not supplied. Required:{' '}
                <span className="font-mono">validation.seam — {'{'}naive_step_pct, harm_step_pct{'}'}</span>. The
                step is the size of the 2012 jump, raw and after conversion; the bundled window starts
                in 2019, so it cannot be computed here.
              </p>
            )}
          </div>
        </div>
      )}

      <p className="mt-2 text-[10px] leading-relaxed text-ink-dim">
        A visible weakness scores better than a hidden one: a shift above about 10% gets a factor
        and a label; an untested seam says so plainly.
      </p>
      <div className="mt-1 flex items-center gap-2">
        <span aria-hidden="true" className="h-px flex-1" style={{ background: LINE }} />
        <span className="font-mono text-[9px]" style={{ color: INK_DIM }}>
          NRT first · then relay
        </span>
        <span aria-hidden="true" className="h-px flex-1" style={{ background: LINE }} />
      </div>
      <span className="sr-only" style={{ color: INK }}>
        Seam checks
      </span>
    </section>
  );
}
