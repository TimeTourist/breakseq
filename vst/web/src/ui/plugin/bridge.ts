/**
 * The page's line to the plugin's C++ side (JUCE's WebBrowserComponent): native
 * functions to call and events it sends. Null outside the plugin.
 */
export interface Bridge {
  /** Calls a function registered with withNativeFunction; resolves with what it completes with. */
  readonly call: (name: string, ...params: unknown[]) => Promise<unknown>;
  /** Listens to an event the C++ side emits; returns a function that stops listening. */
  readonly on: (event: string, listener: (payload: unknown) => void) => () => void;
}

/** The part of JUCE's injected `window.__JUCE__.backend` the bridge uses. */
export interface JuceBackend {
  readonly addEventListener: (event: string, listener: (payload: unknown) => void) => unknown;
  readonly removeEventListener: (token: unknown) => void;
  readonly emitEvent: (event: string, payload: unknown) => void;
}

declare global {
  interface Window {
    __JUCE__?: { readonly backend: JuceBackend };
  }
}

/** A bridge over JUCE's backend, as JUCE's own javascript does it (invoke, then a completion event). */
export function juceBridge(backend: JuceBackend | undefined = typeof window === 'undefined' ? undefined : window.__JUCE__?.backend): Bridge | null {
  if (backend === undefined) return null;
  const pending = new Map<number, (result: unknown) => void>();
  let nextId = 1;
  backend.addEventListener('__juce__complete', (payload) => {
    const { promiseId, result } = payload as { promiseId: number; result: unknown };
    pending.get(promiseId)?.(result);
    pending.delete(promiseId);
  });
  return {
    call: (name, ...params) =>
      new Promise((resolve) => {
        const resultId = nextId++;
        pending.set(resultId, resolve);
        backend.emitEvent('__juce__invoke', { name, params, resultId });
      }),
    on: (event, listener) => {
      const token = backend.addEventListener(event, listener);
      return () => backend.removeEventListener(token);
    },
  };
}

/** Base64 of the bytes of a Float32Array, as the C++ side reads it back (juce::Base64). */
export function floatsToBase64(data: Float32Array): string {
  const bytes = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  return btoa(binary);
}

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  return btoa(binary);
}

export function base64ToBytes(text: string): Uint8Array {
  const binary = atob(text);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}
