# Game design

Source of truth: `asteroid-fleet-game-concept.md` (original concept), `asteroid-fleet-game-concept-followup.md` (review, late-game scaling, multiple carriers), and the README feature table.

## The game in one paragraph

A browser idle game with an autobattler setup, in 3D. The player is the admiral, not the pilot. They outfit a mining carrier's hangars (the "board"), set stances and condition/action rule cards, and warp outward into richer, more dangerous systems while the fleet works on its own. Ore flows drone → barge → hauler → carrier refinery. Pirates scale with distance and cargo heat. Prestige pays RP into a research tree, and a second reset layer (Admiralty) pays Marks.

## Decided behaviour worth knowing before changing code

- When energy hits zero, shields stop regenerating and refining stops, but solar keeps trickling in, so the carrier is never stranded.
- H2 is fusion fuel only, never direct warp fuel.
- Reserves keep rebuilding on their cooldown while offline.
- Offline time is settled at 50 % of recent mining income (salvage excluded). Offline, the background model keeps rolling pirate waves quietly (ships can be lost with no event); a wave already on the map at departure is resolved with events. Offline credits do not count toward RP.
- RP = ⌊√(ore value delivered ÷ 10,000)⌋ × furthest tier.
- Stance resolution is most specific first: card > hangar > ship type > fleet.
- Multiple carriers share credits and RP. Per-carrier resources (ore, H2, energy) move only through supply routes.

## Reading the concept docs

In the follow-up doc, only items marked **Lars' decision** are decided. Anything marked _suggestion_ or _brainstorm_ is a proposal, not a spec. Don't implement brainstorm items unless asked, and don't treat them as drift when the code differs.
