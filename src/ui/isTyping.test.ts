// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { isTyping } from './isTyping';

const input = (type: string) => Object.assign(document.createElement('input'), { type });

describe('isTyping', () => {
  it('counts text, search and number fields, textareas and editable content', () => {
    for (const type of ['text', 'search', 'number', 'email', 'password', 'url', 'tel']) expect(isTyping(input(type)), type).toBe(true);
    expect(isTyping(document.createElement('textarea'))).toBe(true);
    const editable = document.createElement('div');
    editable.contentEditable = 'true';
    Object.defineProperty(editable, 'isContentEditable', { value: true });
    expect(isTyping(editable)).toBe(true);
  });

  it('does not count checkboxes, radio buttons, sliders or buttons', () => {
    for (const type of ['checkbox', 'radio', 'range', 'button', 'color', 'file']) expect(isTyping(input(type)), type).toBe(false);
    expect(isTyping(document.createElement('button'))).toBe(false);
    expect(isTyping(null)).toBe(false);
  });
});
