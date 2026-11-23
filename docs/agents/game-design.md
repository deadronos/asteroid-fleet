# Game design

Source of truth: `asteroid-fleet-game-concept.md` (original concept), `asteroid-fleet-game-concept-followup.md` (review, late-game scaling, multiple carriers), and the README feature table.

## The game in one paragraph

A browser idle game with an autobattler setup, in 3D. The player is the admiral, not the pilot. They outfit a mining carrier's hangars (the "board"), set stances and condition/action rule cards, and warp outward into richer, more dangerous systems while the fleet works on its own. Ore flows drone → barge → hauler → carrier refinery. Pirates scale with distance and cargo heat. Prestige pays RP into a research tree, and a second reset layer (Admiralty) pays Marks.

## Decided behaviour worth knowing before changing code

- When energy hits zero, shields stop regenerating and refining stops, but solar keeps trickling in, so the carrier is never stranded. Shield hits deplete shield strength only; carrier energy is spent only on shield regeneration (#229).
- H2 is fusion fuel only, never direct warp fuel.
- Reserves keep rebuilding on their cooldown while offline.
- Offline time is settled at 50 % of recent mining income (salvage excluded). Offline, no new pirate waves roll; a wave already on the map at departure is resolved with events. Offline credits do not count toward RP and offline H2 tanks are not burned for Fusion, while live off-screen carriers (Tier B) count credits toward RP and challenge progress and burn stored H2 for Fusion (#230).
- RP = ⌊√(ore value delivered ÷ 10,000)⌋ × furthest tier × (1 + 15 % per Admiralty Mark ever earned).
- Solar grows with the square root of the energy pool's capacity (hull and capacity upgrades, not challenge modifiers). Refining runs on solar once the pool settles, so this is what makes capacity upgrades raise income.
- Each refinery level cuts energy per ore refined by 7 % (`REFINE_ENERGY_STEP`). Refining is usually energy-bound, so this is what makes refinery levels pay off.
- Prospecting Charter (Admiralty, id `admYield`) raises the ore value of new asteroids, not mining yield: mining is rarely the limit, ore value always counts.
- Stance resolution is most specific first: card > hangar > ship type > fleet.
- Multiple carriers share credits and RP. Per-carrier resources (ore, H2, energy) move only through supply routes.
- Pre-Fusion solar is the refinery budget: raising it lets refinery levels turn a larger fleet into income instead of pinning energy at the reserve floor (#242). RP uses a divisor of 500,000, so the first RP arrives around twenty minutes in rather than five (#242).
- Cargo heat adds at most +1.5 to wave size, so a rich cargo train in Deep space is dangerous without wiping a fresh fleet (#242).
- Cover is a threat response, not a mining requirement: Starter systems have no raids, so safe drones mine there regardless of cover, and a following carrier parks inside a rich cluster so its ore stays covered (#243).
- Hangar-board bonuses have one definition in `sim/hangar.ts`, read by both the tick and the Fleet panel (#244, #250). The original dock-repair rules are repair drone adjacent to a fighter or barge (3× repair), a barge next to a docked drone with Barge drone bay (2×), and the reciprocal repair-drone hint. Positional boosts are gated behind Board mastery research: a ship starting in slot 0 flies faster, a ship next to a scout mines faster (drones/harvesters) or hits harder (fighters), and a hauler next to a barge is faster and roomier (#244). Each level amplifies the factor.
- Class loadout templates are run-wide, shared by every carrier and kept through both prestige layers (#244). Buying or rebuilding a ship fits any unlocked, affordable template modules; automated purchases and rebuilds respect `automation.creditFloor`.
- Admiralty has three finite, transformative unlocks alongside the repeatable shops (#245): Doctrine Expansion (+2 card slots per level), Forward Charter (Frontier systems discovered and Tier 2 unlocked from launch) and Fleet Logistics (faster supply routes and roomier starting hangars). Finite upgrades scale linearly to their cap and show a maxed state.
- The research tree's late nodes include Doctrine slots, Board mastery, Emergency shields, Self-healing plating and Deep scan (#245). Card capacity comes from the base grid plus Doctrine slots research and Doctrine Expansion.
- The first-run checklist has six auto-advancing phases derived entirely from state (#245): First Fleet, Barge Chain, First Prestige, Fusion & Deep Space, Challenges & Admiralty, Multi-Carrier Fleet. No progress is saved for it.
- Combat fidelity (#161): the carrier has a bounded turn rate and faces its travel target, or the toughest nearby pirate when holding position. PD mounts cover all bearings; heavy batteries cover a cone around the hull's forward axis, so hull choice and facing decide what can be fired on. Damage is scaled by weapon tracking minus target evasion, clamped to 0.15..1, rather than rolled per tick, which keeps the sim deterministic. PD reliably hits interceptors; heavy batteries and pirate guns struggle against them but hit bombers hard. Fighters evade heavier pirate fire while tracking interceptors well.
- Pirates come in three kinds (#161): fast, fragile interceptors that hunt miners and fighters; baseline gunships; and slow, tough bombers that prefer loaded barges and the carrier. Frontier waves mix interceptors and gunships, while distance 4+ and Deep space add bombers. Kind is a save field with a scale cue in 3D, not a separate render layer.

## Reading the concept docs

In the follow-up doc, only items marked **Lars' decision** are decided. Anything marked _suggestion_ or _brainstorm_ is a proposal, not a spec. Don't implement brainstorm items unless asked, and don't treat them as drift when the code differs.
