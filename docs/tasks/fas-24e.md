# Fas 24e – Rättelser efter 24d

Magnus svarade på frågorna efter 24c och 24d (2026-10-22). Besluten står redan i `docs/spec.md`, märkta *(Magnus beslut 2026-10-22)*:

1. **Under en Tape, Scratch eller ljudmodd** hörs bara det de spelar, också reverb och delay som klingade in före klippet. Så är det byggt redan: lägg bara till ett test om det saknas (Tape, Scratch och en ljudmodd var för sig).
2. **Clear i Scratch sätter Length** så att raden spelar inspelningen en gång i 1× med det valda Step (se Hur Scratch verkar). Ett test per Records the first med Step 1/16 och beat, och ett för fallet över 16 steg. Clear låter som utan Scratch (samma test som i 24d, nu också med en rad som från början var kortare).
3. **Exporten:** ett klipp med en ljudmodd eller Scratch blir en egen bit i MIDI-, bit- och REX-exporten, som en tape, klippt ur låten som det hörs. Reverb/delay-WAV:en är tyst under den. Följ hur Tape redan görs (`src/engine/midi.ts`, `render-slices.ts`, `rex.ts`).

## Klart när

- Allt ovan har tester, och bit-WAV:en för en Stutter-bit låter som låten under klippet.
- Exporten är provad i en riktig webbläsare (Export med en Stutter och en Scratch i låten).
- Testerna går igenom, typecheck och lint är gröna.
- En sammanfattning i `docs/tasks/fas-24e-sammanfattning.md`, och raden Aktuell fas i `CLAUDE.md`.
