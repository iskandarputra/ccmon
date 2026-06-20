/**
 * @file SpatialView.tsx
 * @brief Spatial view — the 3D usage field: 9 data modes, 7 plot renderers.
 * @author Iskandar Putra <www.iskandarputra.com>
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { Canvas, useFrame, useThree, type ThreeEvent } from '@react-three/fiber';
import { OrbitControls, Grid, ContactShadows, Line } from '@react-three/drei';
import * as THREE from 'three';
import './spatial.css';
import { Panel } from '../components/ui/Panel';
import { useUsageStore } from '../store/useUsageStore';
import { tokenColor } from '../lib/themeColors';
import {
  clockTime,
  dayLabel,
  fmtDuration,
  fmtInt,
  fmtPct,
  fmtTok,
  fmtUSD,
  projectName,
  relTime,
  shortModel,
} from '../lib/format';
import type { Snapshot } from '../../shared/types';

type Mode =
  | 'terrain'
  | 'rhythm'
  | 'spend'
  | 'models'
  | 'projects'
  | 'blocks'
  | 'sessions'
  | 'tools'
  | 'whatif';

const MODES: Mode[] = [
  'terrain',
  'rhythm',
  'spend',
  'models',
  'projects',
  'blocks',
  'sessions',
  'tools',
  'whatif',
];
const MODE_LABELS: Partial<Record<Mode, string>> = { spend: 'rhythm $', whatif: 'what-if' };
const WEEKDAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
const MAX_H = 3.4;

/** How the field renders — orthogonal to which data it shows. */
type Plot = 'bars' | 'scatter' | 'surface' | 'contour' | 'ribbon' | 'trail' | 'stacked';
const PLOTS: Plot[] = ['bars', 'scatter', 'surface', 'contour', 'ribbon', 'trail', 'stacked'];
const CONTOUR_H = 0.07; //   contour tiles are flat — value lives in the color bands
const CONTOUR_BANDS = 6;
const STACK_MODELS = 5; //   stacked terrain: top models per day + an "other" slice

const LEGENDS: Record<Mode, string> = {
  terrain: 'columns mon → sun · one row per week · height = est cost',
  rhythm: 'columns 00 → 23 h · rows mon → sun · height = tokens in+out',
  spend: 'columns 00 → 23 h · rows mon → sun · height = est cost',
  models: 'columns = last 35 days · one row per model · height = est cost',
  projects: 'columns = last 14 days · one row per project · height = est cost',
  blocks: 'oldest → newest 5h blocks · height = tokens · flat pads = idle gaps',
  sessions: 'newest → oldest · height = est cost · color = context fill · sage pulse = live',
  tools: 'columns = last 35 days · one peg row per tool · height = invocations',
  whatif: 'front lane = actual mix · each lane = ALL traffic on that model · height = est cost / day',
};

/** decorative floor-grid pitch per mode (sections every 5 cells) */
const GRID_CELL: Record<Mode, number> = {
  terrain: 1.14,
  rhythm: 0.6,
  spend: 0.6,
  models: 0.42,
  projects: 0.82,
  blocks: 0.72,
  sessions: 1.05,
  tools: 0.42,
  whatif: 0.42,
};

/** 'mcp__server__tool' → 'server · tool' (raw name stays in the HUD title). */
const toolLabel = (name: string) =>
  name.startsWith('mcp__') ? name.split('__').slice(1).join(' · ') : name;

/** epoch ms → local 'YYYY-MM-DD' so block titles can reuse dayLabel(). */
const dateKeyOf = (ts: number) => {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

/** One bar of the 3D field, fully resolved (position, size, colors, HUD copy). */
interface Cell {
  x: number;
  z: number;
  h: number;
  sx: number;
  sz: number;
  color: THREE.Color;
  emissive: THREE.Color;
  emissiveIntensity: number;
  /** zero-value slots render as faint translucent pads, not solid blocks */
  opacity: number;
  /** the today / current-hour bar breathes its glow while idle */
  pulse?: boolean;
  /** geometry override — tool pegs are cylinders; default is a box */
  shape?: 'cylinder';
  /** y-rotation in radians — session diamonds sit at 45° */
  rotY?: number;
  /** base height for stacked segments (bar bottoms sit at y0, not 0) */
  y0?: number;
  title: string;
  lines: Array<[string, string]>;
}

/** Theme tokens resolved to concrete colors for three.js materials. */
interface Palette {
  bg: string;
  /** quiet-day bar color — the dark end of the value ramp */
  base: THREE.Color;
  grid: string;
  gridSection: string;
  amber: THREE.Color;
  blue: THREE.Color;
  sage: THREE.Color;
  rose: THREE.Color;
  /** chart-1..6 — one accent per row in the models/projects fields */
  chart: THREE.Color[];
  accentLight: string;
}

function resolvePalette(): Palette {
  return {
    bg: tokenColor('bg0'), // darker than the panel — the stage reads as inset depth
    base: new THREE.Color(tokenColor('bg2')),
    grid: tokenColor('line-soft'),
    gridSection: tokenColor('line'),
    amber: new THREE.Color(tokenColor('amber')),
    blue: new THREE.Color(tokenColor('blue')),
    sage: new THREE.Color(tokenColor('sage')),
    rose: new THREE.Color(tokenColor('rose')),
    chart: [1, 2, 3, 4, 5, 6].map((i) => new THREE.Color(tokenColor(`chart-${i}`))),
    accentLight: tokenColor('amber'),
  };
}

/** sqrt-ish scaling keeps small days visible next to record days. */
const intensity = (v: number, max: number) => (max > 0 ? Math.pow(v / max, 0.6) : 0);

/** 35-day cost calendar — columns mon…sun, one row per week, height = est cost. */
function terrainCells(snapshot: Snapshot, p: Palette): Cell[] {
  const days = snapshot.days;
  const max = Math.max(...days.map((d) => d.cost), 0.0001);
  const firstCol = (new Date(`${days[0].date}T12:00:00`).getDay() + 6) % 7;
  const rows = Math.ceil((firstCol + days.length) / 7);
  const todayKey = days[days.length - 1].date;
  const SP = 1.14;

  return days.map((d, i) => {
    const col = (firstCol + i) % 7;
    const row = Math.floor((firstCol + i) / 7);
    const t = intensity(d.cost, max);
    const isToday = d.date === todayKey;
    const active = d.cost > 0 || isToday;
    return {
      x: (col - 3) * SP,
      z: (row - (rows - 1) / 2) * SP,
      h: d.cost > 0 ? Math.max(0.08, t * MAX_H) : 0.03,
      sx: active ? 0.94 : 0.78,
      sz: active ? 0.94 : 0.78,
      // dark base → saturated accent: big days glow, quiet days recede
      color: p.base.clone().lerp(p.amber, d.cost > 0 ? 0.18 + 0.82 * t : 0.12),
      emissive: (isToday ? p.sage : p.amber).clone(),
      emissiveIntensity: isToday ? 0.38 : 0.22 * t,
      opacity: active ? 1 : 0.25,
      pulse: isToday,
      title: `${dayLabel(d.date)}${isToday ? ' · today' : ''} · ${WEEKDAYS[col]}`,
      lines: [
        ['est cost', fmtUSD(d.cost)],
        ['tokens in+out', fmtTok(d.tokens)],
        ['messages', fmtInt(d.entries)],
        ['sessions', String(d.sessions)],
      ],
    };
  });
}

/** 7×24 work-rhythm field — columns are hours, rows mon…sun, height = tokens. */
function rhythmCells(snapshot: Snapshot, p: Palette, now: Date): Cell[] {
  const hourly = snapshot.hourly;
  const max = Math.max(...hourly.flat(), 1);
  const nowWd = (now.getDay() + 6) % 7;
  const nowHour = now.getHours();

  const cells: Cell[] = [];
  hourly.forEach((row, wd) =>
    row.forEach((v, hour) => {
      const t = intensity(v, max);
      const isNow = wd === nowWd && hour === nowHour;
      cells.push({
        x: (hour - 11.5) * 0.6,
        z: (wd - 3) * 0.82,
        h: v > 0 ? Math.max(0.07, t * (MAX_H - 0.4)) : 0.03,
        sx: 0.48,
        sz: 0.64,
        color: p.base.clone().lerp(p.blue, v > 0 ? 0.18 + 0.82 * t : 0.1),
        emissive: (isNow ? p.amber : p.blue).clone(),
        emissiveIntensity: isNow ? 0.45 : 0.22 * t,
        opacity: v > 0 || isNow ? 1 : 0.3,
        pulse: isNow,
        title: `${WEEKDAYS[wd]} ${String(hour).padStart(2, '0')}:00${isNow ? ' · now' : ''}`,
        lines: [['tokens in+out · 30d', fmtTok(v)]],
      });
    }),
  );
  return cells;
}

/** Model ridges — columns = the 35-day window, one row per top model. */
function modelCells(snapshot: Snapshot, p: Palette): Cell[] {
  const top = snapshot.models.slice(0, 6).map((m) => m.model);
  if (!top.length) return [];
  const days = snapshot.days;
  let max = 0.0001;
  const perDay = days.map((d) => {
    const byModel = new Map(d.models.map((m) => [m.model, m]));
    return top.map((id) => {
      const r = byModel.get(id) ?? null;
      if (r && r.cost > max) max = r.cost;
      return r;
    });
  });
  const SPX = 0.42;
  const SPZ = 1.0;
  const cells: Cell[] = [];
  days.forEach((d, di) => {
    top.forEach((id, mi) => {
      const r = perDay[di][mi];
      const cost = r?.cost || 0;
      const t = intensity(cost, max);
      const accent = p.chart[mi % p.chart.length];
      cells.push({
        x: (di - (days.length - 1) / 2) * SPX,
        z: (mi - (top.length - 1) / 2) * SPZ,
        h: cost > 0 ? Math.max(0.06, t * MAX_H) : 0.02,
        sx: 0.34,
        sz: 0.8,
        color: p.base.clone().lerp(accent, cost > 0 ? 0.25 + 0.75 * t : 0.1),
        emissive: accent.clone(),
        emissiveIntensity: 0.2 * t,
        opacity: cost > 0 ? 1 : 0.16,
        title: `${shortModel(id)} · ${dayLabel(d.date)}`,
        lines: [
          ['est cost', fmtUSD(cost)],
          ['tokens in+out', fmtTok((r?.in || 0) + (r?.out || 0))],
          ['messages', fmtInt(r?.entries || 0)],
        ],
      });
    });
  });
  return cells;
}

/** Project ridges — columns = the 14-day sparkline window, one row per project. */
function projectCells(snapshot: Snapshot, p: Palette): Cell[] {
  const projs = [...snapshot.projects]
    .sort((a, b) => b.weekCost - a.weekCost || b.cost - a.cost)
    .slice(0, 8);
  if (!projs.length) return [];
  let max = 0.0001;
  for (const pr of projs) for (const d of pr.daily) if (d.cost > max) max = d.cost;
  const SPX = 0.82;
  const SPZ = 1.0;
  const cells: Cell[] = [];
  projs.forEach((pr, zi) => {
    const accent = p.chart[zi % p.chart.length];
    pr.daily.forEach((d, xi) => {
      const t = intensity(d.cost, max);
      cells.push({
        x: (xi - (pr.daily.length - 1) / 2) * SPX,
        z: (zi - (projs.length - 1) / 2) * SPZ,
        h: d.cost > 0 ? Math.max(0.06, t * MAX_H) : 0.02,
        sx: 0.68,
        sz: 0.8,
        color: p.base.clone().lerp(accent, d.cost > 0 ? 0.25 + 0.75 * t : 0.1),
        emissive: accent.clone(),
        emissiveIntensity: 0.2 * t,
        opacity: d.cost > 0 ? 1 : 0.16,
        title: `${projectName(pr.path)} · ${dayLabel(d.date)}`,
        lines: [
          ['est cost', fmtUSD(d.cost)],
          ['project · 14d', fmtUSD(pr.daily.reduce((s, x) => s + x.cost, 0))],
          ['project · all-time', fmtUSD(pr.cost)],
        ],
      });
    });
  });
  return cells;
}

/** 5h-block sequence — oldest → newest, wrapped; flat pads are idle gaps. */
function blockCells(snapshot: Snapshot, p: Palette): Cell[] {
  const blocks = snapshot.blocks;
  if (!blocks.length) return [];
  const max = Math.max(...blocks.filter((b) => !b.isGap).map((b) => b.totalTokens), 1);
  const PER_ROW = 16;
  const rows = Math.ceil(blocks.length / PER_ROW);
  const SPX = 0.72;
  const SPZ = 1.05;
  return blocks.map((b, i) => {
    const x = ((i % PER_ROW) - (PER_ROW - 1) / 2) * SPX;
    const z = (Math.floor(i / PER_ROW) - (rows - 1) / 2) * SPZ;
    if (b.isGap) {
      return {
        x,
        z,
        h: 0.02,
        sx: 0.46,
        sz: 0.46,
        color: p.base.clone(),
        emissive: p.base.clone(),
        emissiveIntensity: 0,
        opacity: 0.16,
        title: `idle · ${fmtDuration(b.end - b.start)}`,
        lines: [
          ['from', `${dayLabel(dateKeyOf(b.start))} ${clockTime(b.start)}`],
          ['to', `${dayLabel(dateKeyOf(b.end))} ${clockTime(b.end)}`],
        ],
      };
    }
    const t = intensity(b.totalTokens, max);
    const accent = b.isActive ? p.sage : p.amber;
    const endTs = b.isActive ? b.end : b.actualEnd || b.end;
    return {
      x,
      z,
      h: Math.max(0.08, t * MAX_H),
      sx: 0.58,
      sz: 0.78,
      color: p.base.clone().lerp(accent, 0.2 + 0.8 * t),
      emissive: accent.clone(),
      emissiveIntensity: b.isActive ? 0.4 : 0.2 * t,
      opacity: 1,
      pulse: b.isActive,
      title: `${dayLabel(dateKeyOf(b.start))} ${clockTime(b.start)} – ${clockTime(endTs)}${b.isActive ? ' · live' : ''}`,
      lines: [
        ['tokens · all', fmtTok(b.totalTokens)],
        ['est cost', fmtUSD(b.cost)],
        ['messages', fmtInt(b.entries)],
        ['fill vs biggest', `${Math.round((b.totalTokens / max) * 100)}%`],
      ],
    };
  });
}

/** Cost rhythm — the same 7×24 field, but in dollars (where the money lands). */
function spendCells(snapshot: Snapshot, p: Palette, now: Date): Cell[] {
  const grid = snapshot.hourlyCost;
  const max = Math.max(...grid.flat(), 0.0001);
  const nowWd = (now.getDay() + 6) % 7;
  const nowHour = now.getHours();
  const cells: Cell[] = [];
  grid.forEach((row, wd) =>
    row.forEach((v, hour) => {
      const t = intensity(v, max);
      const isNow = wd === nowWd && hour === nowHour;
      cells.push({
        x: (hour - 11.5) * 0.6,
        z: (wd - 3) * 0.82,
        h: v > 0 ? Math.max(0.07, t * (MAX_H - 0.4)) : 0.03,
        sx: 0.48,
        sz: 0.64,
        color: p.base.clone().lerp(p.rose, v > 0 ? 0.18 + 0.82 * t : 0.1),
        emissive: (isNow ? p.amber : p.rose).clone(),
        emissiveIntensity: isNow ? 0.45 : 0.22 * t,
        opacity: v > 0 || isNow ? 1 : 0.3,
        pulse: isNow,
        title: `${WEEKDAYS[wd]} ${String(hour).padStart(2, '0')}:00${isNow ? ' · now' : ''}`,
        lines: [['est cost · 30d', fmtUSD(v)]],
      });
    }),
  );
  return cells;
}

/** Recent sessions as 45°-rotated diamond towers — newest front-left. */
function sessionCells(snapshot: Snapshot, p: Palette, now: number): Cell[] {
  const sessions = snapshot.sessions.slice(0, 36);
  if (!sessions.length) return [];
  const max = Math.max(...sessions.map((s) => s.cost), 0.0001);
  const PER_ROW = 9;
  const rows = Math.ceil(sessions.length / PER_ROW);
  const SPX = 1.05;
  const SPZ = 1.15;
  return sessions.map((s, i) => {
    const t = intensity(s.cost, max);
    const live = now - s.lastTs < 10 * 60e3;
    const ctxPct = s.context?.pct ?? null;
    // color carries the context-window severity; height carries the bill
    const accent =
      ctxPct != null && ctxPct >= 80 ? p.rose : ctxPct != null && ctxPct >= 50 ? p.amber : p.blue;
    return {
      x: ((i % PER_ROW) - (PER_ROW - 1) / 2) * SPX,
      z: (Math.floor(i / PER_ROW) - (rows - 1) / 2) * SPZ,
      h: Math.max(0.08, t * MAX_H),
      sx: 0.52,
      sz: 0.52,
      rotY: Math.PI / 4,
      color: p.base.clone().lerp(accent, 0.2 + 0.8 * t),
      emissive: (live ? p.sage : accent).clone(),
      emissiveIntensity: live ? 0.4 : 0.2 * t,
      opacity: 1,
      pulse: live,
      title: `${projectName(s.project)}${live ? ' · live' : ''}`,
      lines: [
        ['est cost', fmtUSD(s.cost)],
        ['duration', fmtDuration(s.durationMs)],
        ['messages', fmtInt(s.entries)],
        ['tokens in+out', fmtTok(s.tokens)],
        ...(ctxPct != null ? ([['context', fmtPct(ctxPct)]] as Array<[string, string]>) : []),
        ...(s.compactions ? ([['compactions', String(s.compactions)]] as Array<[string, string]>) : []),
        ['last active', relTime(s.lastTs, now)],
      ],
    };
  });
}

/** Tool pegs — top tools × the 35-day window, cylinders; height = invocations. */
function toolCells(snapshot: Snapshot, p: Palette): Cell[] {
  const rows = snapshot.toolUse.daily;
  if (!rows?.length) return [];
  const days = snapshot.days;
  const max = Math.max(...rows.flatMap((r) => r.days), 1);
  const SPX = 0.42;
  const SPZ = 1.0;
  const cells: Cell[] = [];
  rows.forEach((r, zi) => {
    const accent = p.chart[zi % p.chart.length];
    r.days.forEach((v, xi) => {
      const t = intensity(v, max);
      cells.push({
        x: (xi - (r.days.length - 1) / 2) * SPX,
        z: (zi - (rows.length - 1) / 2) * SPZ,
        h: v > 0 ? Math.max(0.06, t * MAX_H) : 0.02,
        sx: 0.34,
        sz: 0.34,
        shape: 'cylinder',
        color: p.base.clone().lerp(accent, v > 0 ? 0.25 + 0.75 * t : 0.1),
        emissive: accent.clone(),
        emissiveIntensity: 0.2 * t,
        opacity: v > 0 ? 1 : 0.14,
        title: `${toolLabel(r.name)} · ${dayLabel(days[xi].date)}`,
        lines: [['invocations', fmtInt(v)]],
      });
    });
  });
  return cells;
}

/** What-if lanes — actual daily spend in front, each model's re-priced day behind. */
function whatifCells(snapshot: Snapshot, p: Palette): Cell[] {
  const rows = snapshot.whatIf.filter((w) => w.daily?.length);
  if (!rows.length) return [];
  const days = snapshot.days;
  const actual = days.map((d) => d.cost);
  let max = Math.max(...actual, 0.0001);
  for (const w of rows) for (const v of w.daily!) if (v > max) max = v;
  const SPX = 0.42;
  const SPZ = 1.0;
  const lanes = [
    { name: 'actual mix', daily: actual, accent: p.amber, isActual: true },
    ...rows.map((w, i) => ({
      name: shortModel(w.model),
      daily: w.daily!,
      accent: p.chart[i % p.chart.length],
      isActual: false,
    })),
  ];
  const cells: Cell[] = [];
  lanes.forEach((lane, zi) => {
    lane.daily.forEach((v, xi) => {
      const t = intensity(v, max);
      const diff = v - actual[xi];
      cells.push({
        x: (xi - (days.length - 1) / 2) * SPX,
        z: (zi - (lanes.length - 1) / 2) * SPZ,
        h: v > 0 ? Math.max(0.05, t * MAX_H) : 0.02,
        sx: 0.34,
        sz: 0.78,
        color: p.base.clone().lerp(lane.accent, v > 0 ? 0.25 + 0.75 * t : 0.1),
        emissive: lane.accent.clone(),
        emissiveIntensity: (lane.isActual ? 0.3 : 0.18) * t,
        opacity: v > 0 ? 1 : 0.14,
        title: `${lane.name} · ${dayLabel(days[xi].date)}`,
        lines: lane.isActual
          ? [['est cost', fmtUSD(v)]]
          : [
              ['re-priced cost', fmtUSD(v)],
              ['vs actual', `${diff <= 0 ? '−' : '+'}${fmtUSD(Math.abs(diff))}`],
            ],
      });
    });
  });
  return cells;
}

/** Terrain days split into stacked model segments (top 5 by cost + other). */
function stackedCells(snapshot: Snapshot, p: Palette): Cell[] {
  const days = snapshot.days;
  const top = snapshot.models.slice(0, STACK_MODELS).map((m) => m.model);
  const accentOf = new Map(top.map((id, i) => [id, p.chart[i % p.chart.length]]));
  const max = Math.max(...days.map((d) => d.cost), 0.0001);
  const firstCol = (new Date(`${days[0].date}T12:00:00`).getDay() + 6) % 7;
  const rows = Math.ceil((firstCol + days.length) / 7);
  const todayKey = days[days.length - 1].date;
  const SP = 1.14;
  const cells: Cell[] = [];
  days.forEach((d, i) => {
    const x = (((firstCol + i) % 7) - 3) * SP;
    const z = (Math.floor((firstCol + i) / 7) - (rows - 1) / 2) * SP;
    const isToday = d.date === todayKey;
    if (d.cost <= 0) {
      cells.push({
        x, z, h: 0.03, sx: 0.78, sz: 0.78,
        color: p.base.clone().lerp(p.amber, 0.12),
        emissive: (isToday ? p.sage : p.amber).clone(),
        emissiveIntensity: isToday ? 0.3 : 0,
        opacity: 0.25,
        pulse: isToday,
        title: `${dayLabel(d.date)}${isToday ? ' · today' : ''} · quiet`,
        lines: [['est cost', fmtUSD(0)]],
      });
      return;
    }
    const totalH = Math.max(0.08, intensity(d.cost, max) * MAX_H);
    const byModel = new Map(d.models.map((m) => [m.model, m.cost]));
    const segs: Array<{ name: string; cost: number; accent: THREE.Color }> = [];
    for (const id of top) {
      const c = byModel.get(id) || 0;
      if (c > 0) segs.push({ name: shortModel(id), cost: c, accent: accentOf.get(id)! });
    }
    const otherCost = d.cost - segs.reduce((s, g) => s + g.cost, 0);
    if (otherCost > 0.0001) {
      segs.push({ name: 'other', cost: otherCost, accent: p.base.clone().lerp(p.amber, 0.5) });
    }
    let y0 = 0;
    for (const g of segs) {
      const h = (g.cost / d.cost) * totalH;
      cells.push({
        x, z, h, y0, sx: 0.94, sz: 0.94,
        color: p.base.clone().lerp(g.accent, 0.75),
        emissive: g.accent.clone(),
        emissiveIntensity: 0.16,
        opacity: 1,
        pulse: isToday && y0 === 0,
        title: `${g.name} · ${dayLabel(d.date)}${isToday ? ' · today' : ''}`,
        lines: [
          ['est cost', fmtUSD(g.cost)],
          ['share of day', `${Math.round((g.cost / d.cost) * 100)}%`],
          ['day total', fmtUSD(d.cost)],
        ],
      });
      y0 += h;
    }
  });
  return cells;
}

interface Hover {
  index: number;
  cell: Cell;
}

interface BarsProps {
  cells: Cell[];
  hover: Hover | null;
  setHover: (updater: (h: Hover | null) => Hover | null) => void;
  /** false under prefers-reduced-motion — instant fields, no shimmer/pulse */
  motion: boolean;
  /** bars (boxes/cylinders), scatter (floating points), contour (flat tiles),
   *  stacked (segment bars with y0 offsets) */
  plot: 'bars' | 'scatter' | 'contour' | 'stacked';
}

const RIPPLE_DELAY = 0.5; //  max entrance stagger (outermost bars)
const GROW_SPEED = 2.4; //    per-bar grow-in rate

/**
 * The bar field (re-keyed per mode). Entrance is a ripple: every bar grows
 * in ease-out, delayed by its distance from the field center, so mode
 * switches sweep outward. Idle, a slow brightness wave drifts across the
 * field and pulse-flagged bars (today / now / live) breathe their glow. All
 * of it collapses under prefers-reduced-motion.
 */
function Bars({ cells, hover, setHover, motion, plot }: BarsProps) {
  const group = useRef<THREE.Group>(null);
  const t0 = useRef<number | null>(null);
  const settled = useRef(!motion);

  // scatter points float at the data height; bars/tiles anchor their base
  // (offset by y0 for stacked segments)
  const anchorY = (c: Cell) => (plot === 'scatter' ? Math.max(c.h, 0.12) : (c.y0 || 0) + c.h / 2);
  const dotR = (c: Cell) => Math.min(0.3, Math.max(0.09, Math.min(c.sx, c.sz) * 0.42));

  // ripple delays, normalized by the field's extent
  const delays = useMemo(() => {
    const maxD = Math.max(...cells.map((c) => Math.hypot(c.x, c.z)), 0.0001);
    return cells.map((c) => (Math.hypot(c.x, c.z) / maxD) * RIPPLE_DELAY);
  }, [cells]);

  useFrame((state, delta) => {
    if (!group.current) return;
    if (t0.current == null) t0.current = state.clock.elapsedTime;
    const t = state.clock.elapsedTime - t0.current;
    const k = Math.min(1, delta * 11);
    const breathe = 0.5 + 0.5 * Math.sin(state.clock.elapsedTime * 2);
    group.current.children.forEach((child, i) => {
      const cell = cells[i];
      if (!cell) return;
      if (!settled.current) {
        // rise from the floor: scatter points lift without squashing; bars
        // scale around the center while re-anchoring the base
        const g = Math.min(1, Math.max(0, (t - delays[i]) * GROW_SPEED));
        const e = Math.max(0.001, 1 - Math.pow(1 - g, 3));
        if (plot !== 'scatter') child.scale.y = e;
        child.position.y = anchorY(cell) * e;
      }
      const target = hover?.index === i ? 1.12 : 1;
      child.scale.x += (target - child.scale.x) * k;
      child.scale.z += (target - child.scale.z) * k;
      if (!motion || hover?.index === i) return;
      const mat = (child as THREE.Mesh).material as THREE.MeshStandardMaterial;
      if (cell.pulse) {
        mat.emissiveIntensity = cell.emissiveIntensity + 0.22 * breathe;
      } else if (cell.opacity === 1 && cell.h > 0.05) {
        // idle shimmer: a dim wave drifting diagonally across the field
        mat.emissiveIntensity =
          cell.emissiveIntensity +
          0.05 *
            (0.5 + 0.5 * Math.sin(state.clock.elapsedTime * 1.5 - (cell.x + cell.z) * 0.7));
      }
    });
    if (!settled.current && t > RIPPLE_DELAY + 1 / GROW_SPEED + 0.1) settled.current = true;
  });

  return (
    <group ref={group}>
      {cells.map((c, i) => (
        <mesh
          key={i}
          position={[c.x, motion ? 0 : anchorY(c), c.z]}
          rotation={[0, c.rotY || 0, 0]}
          scale={[1, motion && plot !== 'scatter' ? 0.001 : 1, 1]}
          onPointerOver={(ev: ThreeEvent<PointerEvent>) => {
            ev.stopPropagation();
            setHover(() => ({ index: i, cell: c }));
          }}
          onPointerOut={() => setHover((h) => (h?.index === i ? null : h))}
        >
          {plot === 'scatter' ? (
            <sphereGeometry args={[dotR(c), 18, 14]} />
          ) : c.shape === 'cylinder' ? (
            <cylinderGeometry args={[c.sx / 2, c.sx / 2, c.h, 18]} />
          ) : (
            <boxGeometry args={[c.sx, c.h, c.sz]} />
          )}
          <meshStandardMaterial
            color={c.color}
            emissive={c.emissive}
            emissiveIntensity={hover?.index === i ? 0.95 : c.emissiveIntensity}
            roughness={0.45}
            metalness={0.12}
            transparent={c.opacity < 1}
            opacity={c.opacity}
          />
        </mesh>
      ))}
    </group>
  );
}

const round3 = (v: number) => Math.round(v * 1000) / 1000;

interface SurfaceFieldProps {
  cells: Cell[];
  palette: Palette;
  setHover: (updater: (h: Hover | null) => Hover | null) => void;
  motion: boolean;
}

/**
 * Continuous surface through the field's grid points, vertex-colored by each
 * cell's ramp, with a faint wireframe overlay. Grid slots without a cell
 * (e.g. the terrain calendar's leading/trailing days) dip to the floor.
 * Hover maps the pointer to the nearest grid vertex → that cell's HUD.
 */
function SurfaceField({ cells, palette, setHover, motion }: SurfaceFieldProps) {
  const group = useRef<THREE.Group>(null);
  const grow = useRef(motion ? 0 : 1);

  const surf = useMemo(() => {
    const xs = [...new Set(cells.map((c) => round3(c.x)))].sort((a, b) => a - b);
    const zs = [...new Set(cells.map((c) => round3(c.z)))].sort((a, b) => a - b);
    if (xs.length < 2 || zs.length < 2) return null;
    const byPos = new Map<string, number>();
    cells.forEach((c, i) => byPos.set(`${round3(c.x)}|${round3(c.z)}`, i));
    const geo = new THREE.PlaneGeometry(
      xs[xs.length - 1] - xs[0],
      zs[zs.length - 1] - zs[0],
      xs.length - 1,
      zs.length - 1,
    );
    geo.rotateX(-Math.PI / 2);
    const pos = geo.attributes.position as THREE.BufferAttribute;
    const colors: number[] = [];
    for (let i = 0; i < pos.count; i++) {
      const ix = i % xs.length;
      const iz = Math.floor(i / xs.length);
      const ci = byPos.get(`${xs[ix]}|${zs[iz]}`);
      const cell = ci !== undefined ? cells[ci] : undefined;
      pos.setY(i, cell ? cell.h : 0);
      const col = cell && cell.opacity >= 1 ? cell.color : palette.base;
      colors.push(col.r, col.g, col.b);
    }
    geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    geo.computeVertexNormals();
    return { geo, xs, zs, byPos };
  }, [cells, palette]);

  useEffect(() => () => surf?.geo.dispose(), [surf]);

  useFrame((_state, delta) => {
    if (!group.current || grow.current >= 1) return;
    grow.current = Math.min(1, grow.current + delta * 1.6);
    group.current.scale.y = Math.max(0.001, 1 - Math.pow(1 - grow.current, 3));
  });

  if (!surf) return null;

  const nearest = (arr: number[], v: number) =>
    arr.reduce((best, cur) => (Math.abs(cur - v) < Math.abs(best - v) ? cur : best));
  const onMove = (ev: ThreeEvent<PointerEvent>) => {
    ev.stopPropagation();
    const ci = surf.byPos.get(`${nearest(surf.xs, ev.point.x)}|${nearest(surf.zs, ev.point.z)}`);
    if (ci !== undefined) setHover(() => ({ index: ci, cell: cells[ci] }));
  };

  return (
    <group ref={group} scale={[1, motion ? 0.001 : 1, 1]}>
      <mesh geometry={surf.geo} onPointerMove={onMove} onPointerOut={() => setHover(() => null)}>
        <meshStandardMaterial
          vertexColors
          roughness={0.5}
          metalness={0.1}
          side={THREE.DoubleSide}
        />
      </mesh>
      <mesh geometry={surf.geo} position={[0, 0.012, 0]}>
        <meshBasicMaterial wireframe color={palette.gridSection} transparent opacity={0.16} />
      </mesh>
    </group>
  );
}

/** Cells grouped into z-rows, each row's indexes sorted by x. */
function rowsOf(cells: Cell[]): Array<{ z: number; idx: number[] }> {
  const byZ = new Map<number, number[]>();
  cells.forEach((c, i) => {
    const z = round3(c.z);
    const arr = byZ.get(z);
    if (arr) arr.push(i);
    else byZ.set(z, [i]);
  });
  return [...byZ.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([z, idx]) => ({ z, idx: idx.sort((a, b) => cells[a].x - cells[b].x) }));
}

/**
 * Ribbon plot — each z-row becomes a vertical curtain: base at the floor,
 * top edge tracing the row's heights, vertex-colored from floor (base) to
 * crest (each cell's ramp). Reads like a skyline per lane.
 */
function RibbonField({ cells, palette, setHover, motion }: SurfaceFieldProps) {
  const group = useRef<THREE.Group>(null);
  const grow = useRef(motion ? 0 : 1);
  const rows = useMemo(() => rowsOf(cells), [cells]);

  const geos = useMemo(
    () =>
      rows.map(({ z, idx }) => {
        if (idx.length < 2) return null;
        const positions: number[] = [];
        const colors: number[] = [];
        const base = palette.base;
        for (let k = 0; k < idx.length - 1; k++) {
          const a = cells[idx[k]];
          const b = cells[idx[k + 1]];
          const ac = a.opacity >= 1 ? a.color : base;
          const bc = b.opacity >= 1 ? b.color : base;
          // quad as two triangles: aBottom→aTop→bTop, aBottom→bTop→bBottom
          positions.push(a.x, 0, z, a.x, a.h, z, b.x, b.h, z);
          positions.push(a.x, 0, z, b.x, b.h, z, b.x, 0, z);
          colors.push(base.r, base.g, base.b, ac.r, ac.g, ac.b, bc.r, bc.g, bc.b);
          colors.push(base.r, base.g, base.b, bc.r, bc.g, bc.b, base.r, base.g, base.b);
        }
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
        geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
        geo.computeVertexNormals();
        return geo;
      }),
    [rows, cells, palette],
  );

  useEffect(() => () => geos.forEach((g) => g?.dispose()), [geos]);

  useFrame((_state, delta) => {
    if (!group.current || grow.current >= 1) return;
    grow.current = Math.min(1, grow.current + delta * 1.6);
    group.current.scale.y = Math.max(0.001, 1 - Math.pow(1 - grow.current, 3));
  });

  return (
    <group ref={group} scale={[1, motion ? 0.001 : 1, 1]}>
      {rows.map(({ idx }, r) => {
        const geo = geos[r];
        if (!geo) return null;
        const onMove = (ev: ThreeEvent<PointerEvent>) => {
          ev.stopPropagation();
          let best = idx[0];
          for (const i of idx) {
            if (Math.abs(cells[i].x - ev.point.x) < Math.abs(cells[best].x - ev.point.x)) best = i;
          }
          setHover(() => ({ index: best, cell: cells[best] }));
        };
        return (
          <mesh
            key={r}
            geometry={geo}
            onPointerMove={onMove}
            onPointerOut={() => setHover(() => null)}
          >
            <meshStandardMaterial
              vertexColors
              roughness={0.5}
              metalness={0.1}
              transparent
              opacity={0.92}
              side={THREE.DoubleSide}
            />
          </mesh>
        );
      })}
    </group>
  );
}

interface TrailFieldProps extends SurfaceFieldProps {
  /** one continuous line through ALL cells in index order (terrain trail) */
  joined: boolean;
}

/**
 * Trail plot — polylines through the data points with hoverable dots at each
 * vertex. Per z-row by default (a 3D line chart per lane); joined mode runs
 * one line through every cell in index order, used for the terrain's
 * cumulative-spend snake through the calendar.
 */
function TrailField({ cells, palette, setHover, motion, joined }: TrailFieldProps) {
  const group = useRef<THREE.Group>(null);
  const grow = useRef(motion ? 0 : 1);

  const lines = useMemo(() => {
    const rows = joined
      ? [{ z: 0, idx: cells.map((_, i) => i) }]
      : rowsOf(cells).filter((r) => r.idx.length >= 2);
    return rows.map(({ idx }) => ({
      idx,
      points: idx.map((i) => [cells[i].x, cells[i].h + 0.02, cells[i].z] as [number, number, number]),
      color: (cells[idx[0]]?.emissive ?? palette.amber).clone(),
    }));
  }, [cells, joined, palette]);

  useFrame((_state, delta) => {
    if (!group.current || grow.current >= 1) return;
    grow.current = Math.min(1, grow.current + delta * 1.6);
    group.current.scale.y = Math.max(0.001, 1 - Math.pow(1 - grow.current, 3));
  });

  return (
    <group ref={group} scale={[1, motion ? 0.001 : 1, 1]}>
      {lines.map((l, r) => (
        <Line key={r} points={l.points} color={l.color} lineWidth={1.6} transparent opacity={0.85} />
      ))}
      {cells.map((c, i) => (
        <mesh
          key={i}
          position={[c.x, c.h + 0.02, c.z]}
          onPointerOver={(ev: ThreeEvent<PointerEvent>) => {
            ev.stopPropagation();
            setHover(() => ({ index: i, cell: c }));
          }}
          onPointerOut={() => setHover((h) => (h?.index === i ? null : h))}
        >
          <sphereGeometry args={[0.085, 12, 10]} />
          <meshStandardMaterial
            color={c.color}
            emissive={c.emissive}
            emissiveIntensity={0.5}
            roughness={0.4}
            transparent={c.opacity < 1}
            opacity={Math.max(c.opacity, 0.4)}
          />
        </mesh>
      ))}
    </group>
  );
}

interface SceneProps {
  cells: Cell[];
  hover: Hover | null;
  setHover: (updater: (h: Hover | null) => Hover | null) => void;
  motion: boolean;
  palette: Palette;
  mode: Mode;
  plot: Plot;
  autoRotate: boolean;
}

/**
 * Drives on-demand renders at a capped rate. With `frameloop="demand"` the idle
 * shimmer (a useFrame loop) only ticks when a frame is requested, so this paces
 * it at ~30fps instead of the compositor's 60 — roughly halving the GPU/CPU of a
 * visible-but-otherwise-static field. Inactive (no interval) when nothing
 * animates, leaving the scene fully static. Orbit/hover use `frameloop="always"`
 * and don't rely on this.
 */
function FrameThrottle({ active, fps = 30 }: { active: boolean; fps?: number }) {
  const invalidate = useThree((s) => s.invalidate);
  useEffect(() => {
    if (!active) return;
    const id = window.setInterval(() => invalidate(), Math.round(1000 / fps));
    return () => window.clearInterval(id);
  }, [active, fps, invalidate]);
  return null;
}

function Scene({ palette, mode, plot, autoRotate, cells, hover, setHover, motion }: SceneProps) {
  return (
    <>
      <color attach="background" args={[palette.bg]} />
      <fog attach="fog" args={[palette.bg, 16, 38]} />
      {/* moody lighting — the diffuse ramp carries the data, not the lamps */}
      <ambientLight intensity={0.4} />
      <directionalLight position={[7, 11, 5]} intensity={0.6} />
      <pointLight position={[-7, 6, -6]} intensity={16} color={palette.accentLight} />
      {plot === 'surface' ? (
        <SurfaceField
          key={`${mode}:surface`}
          cells={cells}
          palette={palette}
          setHover={setHover}
          motion={motion}
        />
      ) : plot === 'ribbon' ? (
        <RibbonField
          key={`${mode}:ribbon`}
          cells={cells}
          palette={palette}
          setHover={setHover}
          motion={motion}
        />
      ) : plot === 'trail' ? (
        <TrailField
          key={`${mode}:trail`}
          cells={cells}
          palette={palette}
          setHover={setHover}
          motion={motion}
          joined={mode === 'terrain'}
        />
      ) : (
        <Bars
          key={`${mode}:${plot}`}
          cells={cells}
          hover={hover}
          setHover={setHover}
          motion={motion}
          plot={plot as 'bars' | 'scatter' | 'contour' | 'stacked'}
        />
      )}
      <ContactShadows
        position={[0, 0, 0]}
        opacity={0.3}
        scale={26}
        blur={2.6}
        far={4.5}
        resolution={512}
        color="#000000"
      />
      <Grid
        position={[0, -0.01, 0]}
        args={[34, 34]}
        cellSize={GRID_CELL[mode]}
        cellThickness={0.6}
        cellColor={palette.grid}
        sectionSize={GRID_CELL[mode] * 5}
        sectionThickness={1}
        sectionColor={palette.gridSection}
        fadeDistance={55}
        fadeStrength={1}
        infiniteGrid
      />
      <OrbitControls
        makeDefault
        autoRotate={autoRotate}
        autoRotateSpeed={0.55}
        enableDamping
        minDistance={5.5}
        maxDistance={22}
        maxPolarAngle={Math.PI * 0.47}
        target={[0, 0.5, 0]}
      />
    </>
  );
}

export function SpatialView() {
  const snapshot = useUsageStore((s) => s.snapshot);
  const themeId = useUsageStore((s) => s.settings?.theme);
  const [mode, setMode] = useState<Mode>('terrain');
  const [plot, setPlot] = useState<Plot>('bars');
  const [hover, setHoverState] = useState<Hover | null>(null);
  const setHover = (updater: (h: Hover | null) => Hover | null) => setHoverState(updater);

  // Materials can't read var(--token) — resolve concrete colors per theme.
  const palette = useMemo(() => resolvePalette(), [themeId]); // eslint-disable-line react-hooks/exhaustive-deps

  // orbit, ripple entrance, shimmer, pulses — all decoration; drop them all
  // for reduced-motion users (the data itself never moves)
  const motionOk = useMemo(
    () => !window.matchMedia('(prefers-reduced-motion: reduce)').matches,
    [],
  );
  // the idle camera orbit is pausable; reduced-motion users start paused
  const [orbiting, setOrbiting] = useState(motionOk);

  const cells = useMemo(() => {
    if (!snapshot) return [];
    // stacked replaces the terrain day bars with per-model segments
    if (plot === 'stacked' && mode === 'terrain') return stackedCells(snapshot, palette);
    switch (mode) {
      case 'rhythm':
        return rhythmCells(snapshot, palette, new Date());
      case 'spend':
        return spendCells(snapshot, palette, new Date());
      case 'models':
        return modelCells(snapshot, palette);
      case 'projects':
        return projectCells(snapshot, palette);
      case 'blocks':
        return blockCells(snapshot, palette);
      case 'sessions':
        return sessionCells(snapshot, palette, Date.now());
      case 'tools':
        return toolCells(snapshot, palette);
      case 'whatif':
        return whatifCells(snapshot, palette);
      default:
        return terrainCells(snapshot, palette);
    }
  }, [snapshot, palette, mode, plot]);

  const plotCells = useMemo(() => {
    // contour flattens the field: value moves from height into quantized
    // color bands (the emissive already carries each cell's accent)
    if (plot === 'contour') {
      return cells.map((c) => {
        const t = Math.min(1, Math.max(0, c.h / MAX_H));
        const band = Math.ceil(t * CONTOUR_BANDS) / CONTOUR_BANDS;
        return {
          ...c,
          h: CONTOUR_H,
          color: palette.base.clone().lerp(c.emissive, 0.12 + 0.88 * band),
          emissiveIntensity: 0.12 * band,
        };
      });
    }
    // the terrain trail climbs: height becomes cumulative spend, snaking
    // through the calendar in day order
    if (plot === 'trail' && mode === 'terrain' && snapshot) {
      const days = snapshot.days;
      const total = days.reduce((s, d) => s + d.cost, 0) || 1;
      let cum = 0;
      return cells.map((c, i) => {
        cum += days[i]?.cost || 0;
        return {
          ...c,
          h: Math.max(0.05, (cum / total) * MAX_H),
          lines: [...c.lines, ['cumulative', fmtUSD(cum)] as [string, string]],
        };
      });
    }
    return cells;
  }, [cells, plot, mode, palette, snapshot]);

  const headline = useMemo(() => {
    if (!snapshot) return '';
    // bounded global range substitutes its label for the natural window wording
    const win = (def: string) => (snapshot.range.preset === 'all' ? def : snapshot.range.label);
    switch (mode) {
      case 'rhythm':
        return `${fmtTok(snapshot.hourly.flat().reduce((s, v) => s + v, 0))} tok over ${win('30 days')}`;
      case 'spend':
        return `${fmtUSD(snapshot.hourlyCost.flat().reduce((s, v) => s + v, 0))} over ${win('30 days')}`;
      case 'models':
        return `top ${Math.min(6, snapshot.models.length)} models · ${win('35 days')}`;
      case 'projects':
        return `top ${Math.min(8, snapshot.projects.length)} projects · ${win('14 days')}`;
      case 'blocks': {
        const usage = snapshot.blocks.filter((b) => !b.isGap).length;
        return `${usage} blocks · ${snapshot.blocks.length - usage} gaps · ${win('30 days')}`;
      }
      case 'sessions':
        return `${Math.min(36, snapshot.sessions.length)} recent sessions`;
      case 'tools':
        return `top ${snapshot.toolUse.daily.length} tools · ${win('35 days')}`;
      case 'whatif':
        return `actual vs ${snapshot.whatIf.length} re-priced models · ${win('35 days')}`;
      default:
        return `${fmtUSD(snapshot.days.reduce((s, d) => s + d.cost, 0))} over ${win('35 days')}`;
    }
  }, [snapshot, mode]);

  if (!snapshot) return null;

  return (
    <div className="grid">
      <div className="g12">
        <Panel title="usage in 3d" right={<span className="panel-note">{headline}</span>}>
          <div className="spa-stage">
            {/* Continuous 60fps only while it visibly matters: auto-rotate
                (orbiting) or a hover scale lerp need every frame. Otherwise drop
                to on-demand — r3f still renders on data/theme/view changes
                (prop-driven scene-graph updates) and OrbitControls damping. The
                idle shimmer is then paced to ~30fps by FrameThrottle (half the
                cost), and a settled reduced-motion field renders zero frames. */}
            <Canvas
              dpr={[1, 1.75]}
              frameloop={orbiting || hover ? 'always' : 'demand'}
              camera={{ position: [7.5, 6.5, 9], fov: 38 }}
            >
              <FrameThrottle active={motionOk && !orbiting && !hover} fps={30} />
              <Scene
                palette={palette}
                mode={mode}
                plot={plot}
                autoRotate={orbiting}
                cells={plotCells}
                hover={hover}
                setHover={setHover}
                motion={motionOk}
              />
            </Canvas>

            {/* tool rail — viewport controls live on the stage, editor-style */}
            <div className="spa-rail">
              <div className="spa-rail-label">data</div>
              {MODES.map((m) => (
                <button
                  key={m}
                  className={`spa-rail-btn ${mode === m ? 'is-active' : ''}`}
                  onClick={() => {
                    setMode(m);
                    // stacked is a terrain-only view — fall back when leaving
                    if (m !== 'terrain' && plot === 'stacked') setPlot('bars');
                    setHoverState(null);
                  }}
                >
                  {MODE_LABELS[m] ?? m}
                </button>
              ))}
              <div className="spa-rail-label">view</div>
              {PLOTS.filter((pl) => pl !== 'stacked' || mode === 'terrain').map((pl) => (
                <button
                  key={pl}
                  className={`spa-rail-btn ${plot === pl ? 'is-active' : ''}`}
                  onClick={() => {
                    setPlot(pl);
                    setHoverState(null);
                  }}
                >
                  {pl}
                </button>
              ))}
              <button
                className="spa-rail-btn spa-rail-orbit"
                onClick={() => setOrbiting((o) => !o)}
                title="toggle the automatic camera orbit"
              >
                <i className={`spa-orbit-dot ${orbiting ? 'is-on' : ''}`} aria-hidden />
                orbit {orbiting ? 'on' : 'off'}
              </button>
            </div>

            <div className={`spa-hud ${hover ? 'is-on' : ''}`}>
              {hover ? (
                <>
                  <div className="spa-hud-title">{hover.cell.title}</div>
                  {hover.cell.lines.map(([k, v]) => (
                    <div className="spa-hud-row" key={k}>
                      <span>{k}</span>
                      <b>{v}</b>
                    </div>
                  ))}
                </>
              ) : (
                <div className="spa-hud-hint">hover the field</div>
              )}
            </div>
          </div>
          <div className="spa-legend">
            <span>
              {LEGENDS[mode]}
              {plot === 'contour' ? ' · contour: value = color bands, not height' : ''}
              {plot === 'trail' && mode === 'terrain' ? ' · trail: height = cumulative spend' : ''}
              {plot === 'stacked' ? ' · stacked: segments = model split per day' : ''}
            </span>
            <span className="spa-hint">drag to orbit · scroll to zoom</span>
          </div>
        </Panel>
      </div>
    </div>
  );
}
