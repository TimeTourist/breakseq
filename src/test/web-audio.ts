// Web Audio in Node: node-web-audio-api puts OfflineAudioContext and friends on globalThis.
import 'node-web-audio-api/polyfill.js';

/**
 * In node-web-audio-api a Float32Array from getChannelData is a view of memory
 * the AudioBuffer owns, but it does not keep the buffer alive (in a browser it
 * does): once the buffer is collected, the view reads freed memory, and now and
 * then a test saw frames that were never rendered. Each view keeps its buffer
 * alive here, as in a browser.
 */
const owners = new WeakMap<Float32Array, AudioBuffer>();
const getChannelData = AudioBuffer.prototype.getChannelData;
AudioBuffer.prototype.getChannelData = function (this: AudioBuffer, channel: number) {
  const data = getChannelData.call(this, channel);
  owners.set(data, this);
  return data;
};
