// Progressive first-run goals (#222, #245). Every phase is derived from state, so goals
// advance on their own across resets with no saved progress and no extra save fields.

import { tierHint } from './config';
import { RESEARCH_BY_ID } from './research';
import { stateOf } from './state';
import type { Sim } from './types';

export interface Goal {
  id: string;
  label: string;
  hint: string;
  done: boolean;
  /** Current phase number and label, for the panel header. */
  phase: number;
  phaseLabel: string;
}

interface Phase {
  label: string;
  goals: Omit<Goal, 'phase' | 'phaseLabel'>[];
}

const goal = (
  id: string,
  label: string,
  hint: string,
  done: boolean,
): Omit<Goal, 'phase' | 'phaseLabel'> => ({
  id,
  label,
  hint,
  done,
});

/** All six phases, evaluated against the current state. */
export function goalPhases(s: Sim): Phase[] {
  const g = stateOf(s);
  const drones = s.ships.filter((x) => x.cls === 'drone').length;
  const has = (cls: (typeof s.ships)[number]['cls']) => s.ships.some((x) => x.cls === cls);
  const tier2 = s.stats.furthestTier >= 2;
  const tier3 = s.stats.furthestTier >= 3;
  const spentRp = Object.entries(s.researchLevels).some(
    ([id, level]) => level > 0 && RESEARCH_BY_ID[id]?.branch !== 'Automation',
  );
  return [
    {
      label: 'First Fleet',
      goals: [
        goal(
          'drones',
          'Grow the mining fleet to 8 drones',
          'Hangars tab: buy drones into free slots.',
          drones >= 8 || tier2,
        ),
        goal(
          'credits',
          'Earn 5,000 credits',
          'The Carrier table shows the slowest link: fix that one.',
          s.stats.creditsEarned >= 5000 || tier2,
        ),
        goal(
          'frontier',
          'Reach the Frontier',
          `${tierHint(2)}. Unlocks fighters and repair ships.`,
          tier2,
        ),
      ],
    },
    {
      label: 'Barge Chain',
      goals: [
        goal(
          'barge',
          'Build a mining barge',
          'Barges compress ore close to the rocks.',
          has('barge'),
        ),
        goal(
          'hauler',
          'Add a hauler',
          'Haulers shuttle barge cargo back to the carrier.',
          has('hauler'),
        ),
        goal(
          'scout',
          'Launch a scout',
          'Scouts reveal rich veins and warn of raids.',
          has('scout'),
        ),
        goal(
          'frontierIncome',
          'Deliver 20,000 ore value',
          'Push the Frontier chain until credits flow.',
          s.stats.oreValueDelivered >= 20_000,
        ),
      ],
    },
    {
      label: 'First Prestige',
      goals: [
        goal(
          'earnRp',
          'Earn research points',
          'The Research tab shows what a prestige pays.',
          s.lifetime.researchEarned > 0 || s.research > 0 || tier3,
        ),
        goal(
          'prestige',
          'Prestige once',
          'Bank this run for permanent research.',
          s.lifetime.prestiges >= 1,
        ),
        goal(
          'spendRp',
          'Spend research points',
          'Buy a research node, not just an automation toggle.',
          spentRp,
        ),
      ],
    },
    {
      label: 'Fusion & Deep Space',
      goals: [
        goal(
          'fusion',
          'Research the fusion reactor',
          'Fusion unlocks gas harvesters.',
          (s.researchLevels.fusion ?? 0) > 0,
        ),
        goal(
          'h2',
          'Harvest H2',
          'Send a harvester to a gas giant.',
          s.carrier.h2 > 0 || has('harvester'),
        ),
        goal('deep', 'Reach Deep space', `${tierHint(3)}. Richer ore, tougher pirates.`, tier3),
      ],
    },
    {
      label: 'Challenges & Admiralty',
      goals: [
        goal(
          'challenge',
          'Complete a challenge',
          'Challenge runs pay Marks and a permanent ore bonus.',
          g.challengesDone.length > 0,
        ),
        goal(
          'admiralty',
          'Reset through Admiralty',
          'The second prestige layer banks Marks.',
          s.lifetime.admiralties >= 1,
        ),
        goal(
          'marks',
          'Spend Admiralty Marks',
          'Buy a finite unlock in the Admiralty shop.',
          Object.values(s.admiralty).some((n) => n > 0),
        ),
      ],
    },
    {
      label: 'Multi-Carrier Fleet',
      goals: [
        goal(
          'secondCarrier',
          'Buy a second carrier',
          'More hangars, more reach, shared credits.',
          g.ops.length >= 2,
        ),
        goal(
          'route',
          'Set up a supply route',
          'Move ore, H2 or energy between carriers.',
          g.routes.length >= 1,
        ),
      ],
    },
  ];
}

/** Goals for the phase the player is on; once every phase is done, the last stays visible. */
export function goals(s: Sim): Goal[] {
  const phases = goalPhases(s);
  const current = phases.find((p) => p.goals.some((x) => !x.done)) ?? phases[phases.length - 1];
  const n = phases.indexOf(current) + 1;
  return current.goals.map((g) => Object.assign(g, { phase: n, phaseLabel: current.label }));
}
