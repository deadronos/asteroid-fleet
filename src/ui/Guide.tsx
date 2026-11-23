import { tierHint } from '../sim/config';
import { Modal } from './Modal';

/** The full How-to-play and glossary, opened from Settings or the shortcut help. */
export function Guide({ onClose }: { onClose: () => void }) {
  return (
    <Modal title="How to play" onClose={onClose}>
      <p>Your mining carrier's fleet works on its own. You shape how it behaves:</p>
      <ul>
        <li>
          <b>Hangars</b> are the board: buy ships into slots (drone 1, fighter 2, barge 4).
          Neighbours can trigger synergies, and each hangar has a launch order.
        </li>
        <li>
          <b>Doctrine</b>: stances for the whole fleet, per ship type and per hangar, plus rule
          cards: when these conditions hold, do that.
        </li>
        <li>
          <b>Logistics</b>: drones mine, barges park at rich clusters as depots, haulers shuttle ore
          home, the refinery turns ore into credits with energy. The slowest link sets your income.
        </li>
        <li>
          <b>Carrier</b>: warp outward for richer ore and tougher pirates, or back to safety. Ships
          outside at jump time are lost for good.
        </li>
        <li>
          <b>Research</b>: prestige resets the operation for research points that persist.
        </li>
      </ul>
      <h3>Glossary</h3>
      <dl className="glossary">
        <dt>Tiers</dt>
        <dd>
          Starter, Frontier and Deep space systems. {tierHint(2)} to unlock fighters, repair ships
          and more; Deep space is further out still.
        </dd>
        <dt>RP</dt>
        <dd>Research points. Only a Prestige pays them; they buy research and persist.</dd>
        <dt>Prestige</dt>
        <dd>Resets credits, ships and position for RP. Research and discoveries stay.</dd>
        <dt>Admiralty Marks</dt>
        <dd>Paid by an Admiralty reset, spent in the Admiralty shop (Research tab).</dd>
        <dt>Admiralty reset</dt>
        <dd>
          The bigger reset: also clears research and discovered systems. Marks and milestones stay.
        </dd>
      </dl>
      <p className="hint">
        Drag to orbit, scroll to zoom, right-drag to pan. Zoom far out (or press Tactical) for the
        sensor view. The game saves itself and keeps working at reduced rate while you are away.
      </p>
      <button onClick={onClose}>Close guide</button>
    </Modal>
  );
}
