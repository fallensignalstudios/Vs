/**
 * Flat hologram displays (read from the front): forecast clock, threat-track streams, casualty log,
 * contamination record. Panel space: x to the viewer's right, y up, origin at the panel centre (1.7 × 1.0 m).
 */
import { PALETTE } from '@/core/api/materials';
import { clamp01, mulberry32, smoothstep } from '@/core/mathx';
import { HoloCanvas, glyphMask, type Range, type TextField } from './canvas';

/** what a display kind provides */
export interface Content {
  /** advance the display: `p` = eased progress 0…1 */
  update(p: number, time: number): void;
  setText(text: string): void;
}

export const AMBER = PALETTE.domAmber, BLUE = PALETTE.refBlue, GOLD = PALETTE.goldLight, PALE = 0xf2f6ff, CINDER = PALETTE.cinder;
/** contamination marker: violet pulled toward white so it stays a data colour, not a glow */
export const VIOLET = 0xb9a2ff;

const W = 1.7, H = 1.0;

/** corner brackets and a header rule shared by the flat panels */
function frame(c: HoloCanvas, color: number): void {
  for (const sx of [-1, 1]) for (const sy of [-1, 1]) {
    c.rect(sx * (W / 2 - 0.07), sy * (H / 2), 0.14, 0.008, color, 0.9);
    c.rect(sx * (W / 2), sy * (H / 2 - 0.06), 0.008, 0.12, color, 0.9);
  }
  c.rect(0, H / 2 - 0.115, W - 0.06, 0.004, color, 0.45);
  for (let i = 0; i < 24; i++) c.rect(-W / 2 + 0.05 + i * 0.07, -H / 2 + 0.035, 0.004, i % 4 === 0 ? 0.03 : 0.016, color, 0.4);
}

// ------------------------------------------------------------------------------------------------ forecast

/** A clock face of segmented numerals: HH:MM:SS across a ring of sixty ticks that drains with progress. */
export function forecast(c: HoloCanvas): Content {
  frame(c, GOLD);
  const header = c.text('FORECAST', -W / 2 + 0.04, H / 2 - 0.06, 0.011, GOLD, 0.85, 0, 1, 26);
  c.text('CONTAINMENT MARGIN', -W / 2 + 0.04, -H / 2 + 0.085, 0.008, GOLD, 0.55);
  // the face is wider than the panel: only its left and right arcs show, bracketing the numerals
  const TICKS = 120, R = 0.76, CUT = 0.36;
  const ticks: number[] = [];
  for (let i = 0; i < TICKS; i++) {
    // clockwise from twelve o'clock
    const a = Math.PI / 2 - (i / TICKS) * Math.PI * 2, long = i % 5 === 0;
    if (Math.abs(Math.sin(a) * R) > CUT) { ticks.push(-1); continue; }
    const r0 = R - (long ? 0.05 : 0.028);
    ticks.push(c.line(Math.cos(a) * r0, Math.sin(a) * r0 - 0.02, 0, Math.cos(a) * R, Math.sin(a) * R - 0.02, 0, long ? 0.012 : 0.007, GOLD, 1));
  }
  const arc = Math.asin(CUT / R);
  for (const mid of [0, Math.PI]) {
    c.circle(0, -0.02, 0, R + 0.022, 0.004, GOLD, 0.5, false, 20, mid - arc, mid + arc);
    c.circle(0, -0.02, 0, R - 0.075, 0.003, GOLD, 0.25, false, 20, mid - arc, mid + arc);
  }
  // six digits and two colons
  const DW = 0.14, DH = 0.26, PITCH = 0.18, COLON = 0.09;
  const digits: number[] = [];
  const colons: number[] = [];
  let x = -(6 * PITCH + 2 * COLON) / 2;
  for (let g = 0; g < 3; g++) {
    for (let d = 0; d < 2; d++) {
      digits.push(c.segments(x + PITCH / 2, -0.02, DW, DH, 0.026, PALE, 1));
      x += PITCH;
    }
    if (g < 2) {
      for (const sy of [-1, 1]) colons.push(c.rect(x + COLON / 2 + sy * 0.008, -0.02 + sy * 0.06, 0.028, 0.028, PALE, 1));
      x += COLON;
    }
  }
  let shown = '';
  const show = (text: string): void => {
    if (text === shown) return;
    shown = text;
    const chars = text.replace(/[^0-9\- ]/g, '').padStart(6, ' ').slice(-6);
    for (let i = 0; i < 6; i++) c.setSegments(digits[i], chars[i], 0.018);
  };
  show('021143');
  return {
    update(p, time) {
      for (let i = 0; i < TICKS; i++) c.setAlpha(ticks[i], i / TICKS >= p ? 1 : 0.1);
      const blink = Math.sin(time * Math.PI * 2) > -0.2 ? 1 : 0.25;
      for (const id of colons) c.setAlpha(id, blink);
    },
    setText(text) {
      // digits fill the clock; anything else (a label) goes to the header line
      if (/[0-9]/.test(text)) show(text); else header.set(text.slice(0, 26));
    },
  };
}

// ------------------------------------------------------------------------------------------------ threat streams

/**
 * Two narrow information streams — amber blocks above, blue-white bars below — that acquire a common target
 * vocabulary: matching glyphs appear in both, fall into step and are bridged by pale ticks. Two lanes, two
 * colours, two glyph styles throughout: they interleave, they never merge.
 */
export function threatStreams(c: HoloCanvas): Content {
  frame(c, PALE);
  const header = c.text('THREAT TRACK EXCHANGE', -W / 2 + 0.04, H / 2 - 0.06, 0.011, PALE, 0.85, 0, 1, 26);
  c.text('DOMINION TRACK', -W / 2 + 0.04, 0.325, 0.008, AMBER, 0.8);
  c.text('REFORMATION TRACK', -W / 2 + 0.04, -0.105, 0.008, BLUE, 0.8);
  const status = c.text('COMMON TARGETS 0/4', W / 2 - 0.04 - 18 * 0.036, -H / 2 + 0.085, 0.009, PALE, 0.8, 0, 1, 18);
  const N = 12, SW = 0.132, CELL = 0.024, SPAN = N * SW;
  const LANES = [{ y: 0.2, color: AMBER }, { y: -0.23, color: BLUE }] as const;
  for (const l of LANES) for (const sy of [-1, 1]) c.rect(0, l.y + sy * 0.085, SPAN, 0.003, l.color, 0.4);
  const rnd = mulberry32(90210);
  // lane vocabularies: chunky blocks vs. column bars; four shared target glyphs
  const own: number[][] = [[], []];
  for (let k = 0; k < N; k++) {
    let a = 0;
    for (let b = 0; b < 15; b++) if (rnd() < 0.72) a |= 1 << b;
    own[0].push(a);
    let m = 0;
    for (let col = 0; col < 3; col++) {
      const top = Math.floor(rnd() * 3), len = 2 + Math.floor(rnd() * 3);
      if (rnd() < 0.8) for (let r = top; r < Math.min(5, top + len); r++) m |= 1 << (14 - (r * 3 + col));
    }
    own[1].push(m);
  }
  const SHARED = [glyphMask('X'), 0b010111010111010, 0b111101101101111, 0b010101010101010];
  const slots: Range[][] = [[], []];
  const marks: Range[][] = [[], []];
  const x0 = (k: number): number => k * SW - SPAN / 2 + SW / 2;
  LANES.forEach((l, li) => {
    for (let k = 0; k < N; k++) {
      const first = c.count;
      for (let r = 0; r < 5; r++) for (let col = 0; col < 3; col++) c.rect(x0(k) + (col - 1) * CELL, l.y + (2 - r) * CELL, CELL * 0.84, CELL * 0.84, l.color, 1);
      slots[li].push([first, 15]);
      // target brackets around a matched glyph
      const mf = c.count;
      for (const sx of [-1, 1]) for (const sy of [-1, 1]) {
        c.rect(x0(k) + sx * 0.05, l.y + sy * 0.073, 0.022, 0.004, PALE, 0.9);
        c.rect(x0(k) + sx * 0.059, l.y + sy * 0.064, 0.004, 0.022, PALE, 0.9);
      }
      marks[li].push([mf, 8]);
    }
  });
  // bridges in the gap between the lanes: a tick from each lane and a small diamond where they meet
  const bridges: Range[] = [];
  const mid = (LANES[0].y + LANES[1].y) / 2;
  for (let k = 0; k < N; k++) {
    const first = c.count;
    c.rect(x0(k), mid + 0.062, 0.005, 0.07, AMBER, 0.9);
    c.rect(x0(k), mid - 0.062, 0.005, 0.07, BLUE, 0.9);
    c.diamond(x0(k), mid, 0, 0.018, PALE, 1);
    bridges.push([first, 3]);
  }
  const thr = (k: number): number => (k % 3 === 0 ? 0.14 + (k / 3) * 0.2 : 2);
  let lastCount = -1;
  const wrap = (v: number): number => ((v % SPAN) + SPAN) % SPAN;
  const xs = [0, 0], phase = [0, 0];
  return {
    update(p, time) {
      const lock = smoothstep(0.5, 0.98, p);
      const pa = time * 0.085;
      // the second stream runs at its own pace until the vocabularies agree, then falls into step
      let d = wrap(pa - time * 0.052);
      if (d > SPAN / 2) d -= SPAN;
      phase[0] = pa;
      phase[1] = time * 0.052 + d * lock;
      let count = 0;
      for (let k = 0; k < N; k++) {
        const matched = p > thr(k);
        if (matched) count++;
        for (let li = 0; li < 2; li++) {
          const x = wrap(k * SW + phase[li]) - SPAN / 2 + SW / 2;
          xs[li] = x;
          const edge = clamp01((SPAN / 2 - Math.abs(x)) / (SW * 0.9));
          const blinkIn = matched ? clamp01((p - thr(k)) / 0.05) : 0;
          const mask = matched && blinkIn > 0.5 ? SHARED[(k / 3) % 4] : own[li][k];
          const [first] = slots[li][k];
          for (let b = 0; b < 15; b++) c.setAlpha(first + b, ((mask >> (14 - b)) & 1) * edge);
          c.offset(slots[li][k], x - x0(k), 0, 0);
          c.fade(marks[li][k], matched ? edge * blinkIn : 0);
          c.offset(marks[li][k], x - x0(k), 0, 0);
        }
        const near = clamp01(1 - Math.abs(xs[0] - xs[1]) / (SW * 0.4));
        const edge = clamp01((SPAN / 2 - Math.abs(xs[0])) / (SW * 0.9));
        c.fade(bridges[k], matched ? near * edge * lock : 0);
        c.offset(bridges[k], xs[0] - x0(k), 0, 0);
      }
      if (count !== lastCount) {
        lastCount = count;
        status.set(`COMMON TARGETS ${count}/4`);
      }
    },
    setText(text) {
      header.set(text.slice(0, 26));
    },
  };
}

// ------------------------------------------------------------------------------------------------ casualty log

const STATUS = ['LOST', 'MISSING', 'ALIVE'] as const;

/** Rows of unit identifiers with a status mark and word; rows reveal top-down under a cursor, a tally fills. */
export function casualtyLog(c: HoloCanvas): Content {
  frame(c, AMBER);
  const header = c.text('CASUALTY LOG', -W / 2 + 0.04, H / 2 - 0.06, 0.011, AMBER, 0.9, 0, 1, 26);
  const rnd = mulberry32(2291);
  const ROWS = 9, PITCH = 0.078, TOP = 0.3, CELL = 0.011;
  const rows: Array<{ range: Range; status: number; tally: number }> = [];
  const cursor = c.rect(0, TOP, W - 0.08, PITCH * 0.86, AMBER, 0.14);
  const cursorRange: Range = [cursor, 1];
  for (let i = 0; i < ROWS; i++) {
    const y = TOP - i * PITCH;
    const st = rnd() < 0.5 ? 0 : rnd() < 0.6 ? 1 : 2;
    const first = c.count;
    c.rect(-W / 2 + 0.05, y, 0.012, 0.04, AMBER, 0.9);
    const id = `${String(10 + Math.floor(rnd() * 89))}-${String(1000 + Math.floor(rnd() * 8999))} ${'ABCDEFGHKLMNPRST'[Math.floor(rnd() * 16)]}${'AEIOU'[Math.floor(rnd() * 5)]}`;
    c.text(id, -W / 2 + 0.085, y, CELL, AMBER, st === 0 ? 0.55 : 0.95);
    // status mark: solid block = lost, hollow frame = missing, small pip = alive — shape before colour
    const mx = -0.2;
    if (st === 0) c.rect(mx, y, 0.04, 0.04, AMBER, 0.95);
    else if (st === 1) {
      for (const s of [-1, 1]) { c.rect(mx, y + s * 0.018, 0.04, 0.005, AMBER, 0.95); c.rect(mx + s * 0.018, y, 0.005, 0.04, AMBER, 0.95); }
    } else c.diamond(mx, y, 0, 0.014, PALE, 1);
    c.text(STATUS[st], -0.14, y, CELL, st === 2 ? PALE : AMBER, st === 0 ? 0.6 : 0.95);
    if (st === 0) c.rect(-W / 2 + 0.085 + 0.24, y, 0.5, 0.003, AMBER, 0.5);
    // a short service bar: how long the record has been open
    c.rect(0.28 + rnd() * 0.12, y, 0.1 + rnd() * 0.2, 0.012, AMBER, 0.35);
    const tally = c.rect(W / 2 - 0.09, TOP - i * PITCH, 0.05, PITCH * 0.6, st === 2 ? PALE : AMBER, st === 0 ? 0.95 : st === 1 ? 0.45 : 0.9);
    rows.push({ range: [first, c.count - first - 1], status: st, tally });
  }
  return {
    update(p, time) {
      const head = p * (ROWS + 0.5);
      for (let i = 0; i < ROWS; i++) {
        const a = clamp01(head - i);
        // a row writes itself in with a short flicker
        const flick = a > 0 && a < 1 ? 0.6 + 0.4 * Math.sin(time * 40 + i) : 1;
        c.fade(rows[i].range, a * flick);
        c.setAlpha(rows[i].tally, a);
      }
      const at = Math.min(ROWS - 1, Math.floor(head));
      c.offset(cursorRange, 0, -at * PITCH, 0);
      c.setAlpha(cursor, p > 0.001 && p < 0.999 ? 0.7 + 0.3 * Math.sin(time * 6) : 0);
    },
    setText(text) {
      header.set(text.slice(0, 26));
    },
  };
}

// ------------------------------------------------------------------------------------------------ contamination record

/**
 * A conduit network (7 × 3 junctions). Contamination spreads from one source junction along the links as
 * progress rises: clean links are thin solid lines, contaminated ones turn into heavier dashes and their
 * junctions gain a cross — the change reads by shape as well as by the violet tint.
 */
export function contaminationRecord(c: HoloCanvas): Content {
  frame(c, BLUE);
  const header = c.text('CONTAMINATION RECORD', -W / 2 + 0.04, H / 2 - 0.06, 0.011, BLUE, 0.9, 0, 1, 26);
  const count = c.text('JUNCTIONS 00/21', W / 2 - 0.04 - 15 * 0.036, -H / 2 + 0.085, 0.009, PALE, 0.8, 0, 1, 15);
  const COLS = 7, ROWS = 3, DX = 0.22, DY = 0.19, CY = 0.03;
  const px = (col: number): number => (col - (COLS - 1) / 2) * DX;
  const py = (row: number): number => CY + (1 - row) * DY;
  const id = (col: number, row: number): number => row * COLS + col;
  // links: every horizontal neighbour, a staggered set of verticals
  const links: Array<[number, number]> = [];
  for (let r = 0; r < ROWS; r++) for (let col = 0; col + 1 < COLS; col++) if (!(r === 1 && col === 3)) links.push([id(col, r), id(col + 1, r)]);
  for (let col = 0; col < COLS; col++) for (let r = 0; r + 1 < ROWS; r++) if ((col + r) % 2 === 0) links.push([id(col, r), id(col, r + 1)]);
  // breadth-first distance from the source junction (bottom-left)
  const SOURCE = id(0, 2);
  const dist = new Array<number>(COLS * ROWS).fill(99);
  dist[SOURCE] = 0;
  for (let pass = 0; pass < 24; pass++) for (const [a, b] of links) {
    if (dist[a] + 1 < dist[b]) dist[b] = dist[a] + 1;
    if (dist[b] + 1 < dist[a]) dist[a] = dist[b] + 1;
  }
  const far = Math.max(...dist.filter((d) => d < 99));
  const linkQuads = links.map(([a, b]) => {
    const ax = px(a % COLS), ay = py(Math.floor(a / COLS)), bx = px(b % COLS), by = py(Math.floor(b / COLS));
    const clean = c.line(ax, ay, 0, bx, by, 0, 0.005, BLUE, 0.7);
    const first = c.count;
    for (let k = 0; k < 4; k++) {
      const t0 = 0.1 + k * 0.215, t1 = t0 + 0.13;
      c.line(ax + (bx - ax) * t0, ay + (by - ay) * t0, 0, ax + (bx - ax) * t1, ay + (by - ay) * t1, 0, 0.014, VIOLET, 1);
    }
    return { clean, dashes: [first, 4] as Range, at: Math.max(dist[a], dist[b]) };
  });
  const nodes = dist.map((d, n) => {
    const x = px(n % COLS), y = py(Math.floor(n / COLS));
    const clean = c.diamond(x, y, 0, 0.016, BLUE, 0.95);
    const first = c.count;
    c.diamond(x, y, 0, 0.03, VIOLET, 0.55);
    c.line(x - 0.03, y - 0.03, 0, x + 0.03, y + 0.03, 0, 0.007, PALE, 1);
    c.line(x - 0.03, y + 0.03, 0, x + 0.03, y - 0.03, 0, 0.007, PALE, 1);
    return { clean, hit: [first, 3] as Range, at: d };
  });
  const ring = c.circle(px(0), py(2), 0, 0.055, 0.005, PALE, 1, false, 20);
  c.text('SOURCE', px(0) - 0.07, py(2) - 0.09, 0.007, PALE, 0.8);
  // timeline
  const TY = -H / 2 + 0.17;
  c.rect(0, TY, W - 0.3, 0.003, BLUE, 0.5);
  const cursor = c.rect(-(W - 0.3) / 2, TY, 0.01, 0.05, PALE, 1);
  const cursorRange: Range = [cursor, 1];
  let lastHit = -1;
  return {
    update(p, time) {
      const head = p * (far + 1.2) - 0.2;
      let hit = 0;
      for (const n of nodes) {
        const a = clamp01(head - n.at + 1);
        if (a > 0.5) hit++;
        c.setAlpha(n.clean, 1 - a);
        c.fade(n.hit, a);
      }
      for (const l of linkQuads) {
        const a = clamp01(head - l.at + 1);
        c.setAlpha(l.clean, 1 - a * 0.85);
        c.fade(l.dashes, a * (0.75 + 0.25 * Math.sin(time * 3 + l.at)));
      }
      c.fade(ring, 0.55 + 0.45 * Math.sin(time * 4));
      c.offset(cursorRange, p * (W - 0.3), 0, 0);
      if (hit !== lastHit) {
        lastHit = hit;
        count.set(`JUNCTIONS ${String(hit).padStart(2, '0')}/21`);
      }
    },
    setText(text) {
      header.set(text.slice(0, 26));
    },
  };
}
