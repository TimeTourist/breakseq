/** Input types that take typed text or numbers; checkboxes, radio buttons, sliders and the like do not. */
const TEXT_INPUTS = new Set(['text', 'search', 'number', 'email', 'password', 'url', 'tel', '']);

/** Whether the keyboard goes to a field being typed in (a select too: Space opens it, letters pick), so the app's keys stay out of the way. */
export const isTyping = (target: EventTarget | null): boolean =>
  target instanceof HTMLElement &&
  (target.isContentEditable ||
    target.tagName === 'TEXTAREA' ||
    target.tagName === 'SELECT' ||
    (target.tagName === 'INPUT' && TEXT_INPUTS.has((target as HTMLInputElement).type)));
