// Headless balance harness (#59): runs one operation of the deterministic sim
// for N game hours under a scripted policy and reports pacing. No rendering, no
// worker; `pnpm run balance` drives it through scripts/balance.mjs.
//
//   pnpm run balance                               # 4 h, seed 42, RP_DIVISOR
//   pnpm run balance --hours 8 --rp-divisor 1e4,1e5,1e6
//   pnpm run balance --sample 1 --hours 0.5        # minute-by-minute opening
//   pnpm run balance --research autoRebuild=1,slots=2   # a run after prestige
//   pnpm run balance --json > run.json             # for plotting or diffing
//
// Same seed and flags give the same numbers. The table samples credits,
// earnings, ore value delivered (the prestige input), the RP a prestige would
// pay under each divisor, ship counts per class (key in the header), hangar
// slots, refinery level, carrier energy and ships lost. Below it: when each
// tier was reached, every jump, when a prestige first paid at least 1 RP, and
// what it would pay at the end.
//
// To extend: add a policy to POLICIES in policy.ts (it issues commands through
// `apply`, like the UI), or a field to `Sample` and a column to `formatReport`.

import { RP_DIVISOR, TICK_HZ, TIER_NAMES } from '../config';
import { researchMult } from '../costs';
import { focused, newGame } from '../state';
import { stepSim } from '../tick';
import { SHIP_CLASSES, type Sim, type ShipClass } from '../types';
import { ACT_INTERVAL_TICKS, POLICIES, shipCounts, type Counts, type Policy } from './policy';

export interface BalanceOptions {
  hours: number;
  seed: number;
  /** Divisors to compare; the first is the headline. Payout is computed per divisor. */
  rpDivisors: number[];
  sampleMinutes: number;
  policy: Policy;
  /** Research levels to start with, e.g. to model a run after a prestige. */
  research: Record<string, number>;
}

export const DEFAULT_OPTIONS: Omit<BalanceOptions, 'policy'> = {
  hours: 4,
  seed: 42,
  rpDivisors: [RP_DIVISOR],
  sampleMinutes: 10,
  research: {},
};

export interface Sample {
  /** Game seconds. */
  t: number;
  systemId: number;
  tier: number;
  credits: number;
  creditsEarned: number;
  incomeAvg: number;
  oreValueDelivered: number;
  /** Prestige payout per divisor, same order as `rpDivisors`. */
  rp: number[];
  ships: Counts;
  slots: number;
  refinery: number;
  energy: number;
  shipsLost: number;
}

export interface Jump {
  t: number;
  to: number;
  kind: 'warp' | 'emergency';
}

export interface BalanceResult {
  options: BalanceOptions;
  samples: Sample[];
  jumps: Jump[];
  /** Game seconds when each tier was first reached. */
  tierReached: Record<number, number>;
  /** Game seconds when a prestige first paid at least 1 RP, per divisor (null: never). */
  firstPrestige: (number | null)[];
  end: Sample;
  wallMs: number;
}

/** `researchPayout` with the divisor as a parameter, so divisors can be compared in one run. */
export function payout(s: Sim, divisor: number): number {
  const base = Math.floor(Math.sqrt(s.stats.oreValueDelivered / divisor)) * s.stats.furthestTier;
  return Math.floor(base * researchMult(s));
}

function sample(s: Sim, o: BalanceOptions): Sample {
  return {
    t: Math.round(s.time),
    systemId: s.systemId,
    tier: s.systems[s.systemId].tier,
    credits: s.credits,
    creditsEarned: s.stats.creditsEarned,
    incomeAvg: s.incomeAvg,
    oreValueDelivered: s.stats.oreValueDelivered,
    rp: o.rpDivisors.map((d) => payout(s, d)),
    ships: shipCounts(s),
    slots: s.hangars.reduce((n, h) => n + h.slots, 0),
    refinery: s.carrier.refinery,
    energy: s.carrier.energy,
    shipsLost: s.stats.shipsLost,
  };
}

export function runBalance(o: BalanceOptions): BalanceResult {
  const t0 = performance.now();
  const s = focused(newGame(o.seed));
  Object.assign(s.researchLevels, o.research);
  o.policy.setup?.(s);

  const ticks = Math.round(o.hours * 3600 * TICK_HZ);
  const every = Math.max(1, Math.round(o.sampleMinutes * 60 * TICK_HZ));
  const samples: Sample[] = [];
  const jumps: Jump[] = [];
  const tierReached: Record<number, number> = { [s.systems[s.systemId].tier]: 0 };
  const firstPrestige: (number | null)[] = o.rpDivisors.map(() => null);

  for (let t = 1; t <= ticks; t++) {
    const from = s.systemId;
    const warpTo = s.warp?.targetSystem;
    stepSim(s);
    if (s.systemId !== from) {
      jumps.push({ t: s.time, to: s.systemId, kind: s.systemId === warpTo ? 'warp' : 'emergency' });
      const tier = s.systems[s.systemId].tier;
      tierReached[tier] ??= s.time;
    }
    if (t % ACT_INTERVAL_TICKS === 0) {
      o.policy.act(s);
      o.rpDivisors.forEach((d, i) => {
        if (firstPrestige[i] === null && payout(s, d) > 0) firstPrestige[i] = s.time;
      });
    }
    if (t % every === 0) samples.push(sample(s, o));
  }

  return {
    options: o,
    samples,
    jumps,
    tierReached,
    firstPrestige,
    end: sample(s, o),
    wallMs: performance.now() - t0,
  };
}

// ---------- report ----------

/** 1234 → 1.2k, 5_600_000 → 5.6M. Keeps the table narrow. */
export function compact(n: number): string {
  const a = Math.abs(n);
  if (a < 1000) return String(Math.round(n));
  for (const [div, unit] of [
    [1e12, 'T'],
    [1e9, 'G'],
    [1e6, 'M'],
    [1e3, 'k'],
  ] as const)
    if (a >= div) return `${(n / div).toFixed(a >= div * 100 ? 0 : 1).replace(/\.0$/, '')}${unit}`;
  return String(n);
}

/** Game seconds as h:mm. */
export function clock(t: number | null | undefined): string {
  if (t === null || t === undefined) return '—';
  const m = Math.floor(t / 60);
  return `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}`;
}

const CLASS_LETTER: Record<ShipClass, string> = {
  drone: 'd',
  barge: 'b',
  hauler: 'h',
  fighter: 'f',
  scout: 's',
  repair: 'r',
  harvester: 'g',
};
const CLASS_KEY = SHIP_CLASSES.map((c) => CLASS_LETTER[c]).join('/');

function table(rows: string[][]): string {
  const w = rows[0].map((_, i) => Math.max(...rows.map((r) => r[i].length)));
  return rows.map((r) => r.map((c, i) => c.padStart(w[i])).join('  ')).join('\n');
}

export function formatReport(r: BalanceResult): string {
  const o = r.options;
  const rpHead = o.rpDivisors.map((d) => `RP@${compact(d)}`);
  const head = [
    'time',
    'sys',
    'tier',
    'credits',
    'earned',
    'inc/s',
    'ore',
    ...rpHead,
    'ships',
    CLASS_KEY,
    'slots',
    'ref',
    'energy',
    'lost',
  ];
  const row = (x: Sample) => [
    clock(x.t),
    String(x.systemId),
    String(x.tier),
    compact(x.credits),
    compact(x.creditsEarned),
    x.incomeAvg.toFixed(1),
    compact(x.oreValueDelivered),
    ...x.rp.map(String),
    String(Object.values(x.ships).reduce((a, b) => a + b, 0)),
    SHIP_CLASSES.map((c) => x.ships[c]).join('/'),
    String(x.slots),
    String(x.refinery),
    String(Math.round(x.energy)),
    String(x.shipsLost),
  ];
  const research = Object.entries(o.research)
    .map(([k, v]) => `${k}=${v}`)
    .join(',');
  const tiers = Object.entries(r.tierReached)
    .map(([t, at]) => `${TIER_NAMES[Number(t) as 1 | 2 | 3]} ${clock(at)}`)
    .join(' · ');
  const jumps = r.jumps.length
    ? r.jumps
        .map((j) => `${clock(j.t)} → ${j.to}${j.kind === 'emergency' ? ' (emergency)' : ''}`)
        .join(' · ')
    : 'none';
  const ticksPerS = (o.hours * 3600 * TICK_HZ) / (r.wallMs / 1000);
  const end = r.end;

  return [
    `Asteroid Fleet balance · seed ${o.seed} · ${o.hours} h game time · policy ${o.policy.name}${research ? ` · research ${research}` : ''}`,
    `  ${o.policy.describe}`,
    '',
    table([head, ...r.samples.map(row)]),
    '',
    `Tiers reached     ${tiers}`,
    `Jumps             ${jumps}`,
    `First prestige    ${o.rpDivisors.map((d, i) => `D=${compact(d)} ${clock(r.firstPrestige[i])}`).join(' · ')}  (payout ≥ 1 RP)`,
    `Prestige at end   ${o.rpDivisors.map((d, i) => `D=${compact(d)} +${end.rp[i]} RP`).join(' · ')}`,
    `End state         furthest tier ${Math.max(...Object.keys(r.tierReached).map(Number))}, ${compact(end.credits)} credits, ${compact(end.oreValueDelivered)} ore value delivered, ships ${CLASS_KEY} ${SHIP_CLASSES.map((c) => end.ships[c]).join('/')}, ${end.shipsLost} lost`,
    `Wall time         ${(r.wallMs / 1000).toFixed(1)} s (${compact(ticksPerS)} ticks/s)`,
  ].join('\n');
}

// ---------- CLI ----------

export const USAGE = `Usage: pnpm run balance [options]
  --hours <n>          game hours to simulate (default ${DEFAULT_OPTIONS.hours})
  --seed <n>           newGame seed (default ${DEFAULT_OPTIONS.seed})
  --rp-divisor <list>  comma-separated divisors to compare, e.g. 1e4,1e5,1e6 (default RP_DIVISOR = ${RP_DIVISOR})
  --sample <min>       minutes between table rows (default ${DEFAULT_OPTIONS.sampleMinutes})
  --policy <name>      scripted player: ${Object.keys(POLICIES).join(', ')} (default steady)
  --research <list>    starting research levels, e.g. autoRebuild=1,slots=2
  --json               print the result as JSON instead of a table`;

export interface Cli {
  options: BalanceOptions;
  json: boolean;
}

function num(flag: string, v: string | undefined): number {
  const n = Number(v);
  if (v === undefined || !Number.isFinite(n) || n <= 0)
    throw new Error(`${flag} needs a positive number`);
  return n;
}

/** Parse argv (without node and script). Throws with a message on bad input. */
export function parseArgs(argv: string[]): Cli {
  const o: BalanceOptions = { ...DEFAULT_OPTIONS, research: {}, policy: POLICIES.steady() };
  let json = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const v = argv[i + 1];
    switch (a) {
      case '--hours':
        o.hours = num(a, v);
        i++;
        break;
      case '--seed':
        o.seed = Math.floor(num(a, v));
        i++;
        break;
      case '--sample':
        o.sampleMinutes = num(a, v);
        i++;
        break;
      case '--rp-divisor':
      case '--rp-divisors':
        o.rpDivisors = (v ?? '').split(',').map((x) => num(a, x));
        i++;
        break;
      case '--policy': {
        const make = v ? POLICIES[v] : undefined;
        if (!make)
          throw new Error(`Unknown policy "${v}"; try ${Object.keys(POLICIES).join(', ')}`);
        o.policy = make();
        i++;
        break;
      }
      case '--research':
        for (const kv of (v ?? '').split(',')) {
          const [k, lv] = kv.split('=');
          if (!k) throw new Error('--research needs id=level pairs');
          o.research[k] = Math.floor(num(a, lv ?? '1'));
        }
        i++;
        break;
      case '--json':
        json = true;
        break;
      case '--help':
      case '-h':
        throw new Error(USAGE);
      default:
        throw new Error(`Unknown option ${a}\n\n${USAGE}`);
    }
  }
  return { options: o, json };
}

/** Entry point for scripts/balance.mjs; returns the text to print. */
export function main(argv: string[]): string {
  const { options, json } = parseArgs(argv);
  const r = runBalance(options);
  if (!json) return formatReport(r);
  return JSON.stringify({ ...r, options: { ...options, policy: options.policy.name } }, null, 2);
}
