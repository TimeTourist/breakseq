import { createEvent, fireEvent, screen } from '@testing-library/react';
import { STEP_PX } from '../ui/SongView';

/** A Song lane by name: "Main", "Fill", "Mod A", "Mod B". */
export const lane = (name: string) => screen.getByLabelText(`${name} lane`);

/** A pointer x over a step of a lane. In happy-dom lanes sit at x = 0. */
export const atStep = (step: number) => step * STEP_PX + STEP_PX / 2;

/**
 * Drops dragged data on a lane at a step. happy-dom leaves altKey off drag
 * events, so it is set on the event itself.
 */
export function dropOn(name: string, step: number, type: string, data: string, altKey = false) {
  const target = lane(name);
  const event = createEvent.drop(target, {
    clientX: atStep(step),
    dataTransfer: { types: [type], getData: (t: string) => (t === type ? data : '') },
  });
  Object.defineProperty(event, 'altKey', { value: altKey });
  Object.defineProperty(event, 'clientX', { value: atStep(step) });
  fireEvent(target, event);
}

/** Clicks a lane at a step, as when placing a selected library chip. */
export function clickLane(name: string, step: number) {
  fireEvent.click(lane(name), { clientX: atStep(step) });
}

/** A clip on the timeline, by the start of its label: "M1, 2.1.1". */
export const clip = (label: RegExp) => screen.getByRole('button', { name: label });
