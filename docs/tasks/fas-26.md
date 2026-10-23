# Fas 26 – Trance gate

Specen: `docs/spec.md`, **Trance gate** (under Mods som samplar det som hörs; Magnus beslut 2026-10-23, med Claudes val sist). Följ hur ljudmoddarna redan är byggda (fas 24c: `src/engine/audio-mods.ts`, `render-audio-mods.ts`, `render-heard.ts`, korten i `src/ui/ModCards*`, `LaneCard`) och exporten (fas 24e: klipp med ljudmodd blir egna bitar).

## Mål

En ny ljudmodd, Trance gate, som ändrar nivån på allt som hörs i takt med en på/av-rad, med Depth, Open och Smooth och förvalen Straight, Off-beat och 3-3-2.

## Klart när

- Modellen: målet `tranceGate` med reglagen och deras omfång, validerat i kommandot som de andra ljudmoddarna; går att ångra; ny effekt som specen säger.
- Ljudet: test som mäter bufferten: stängda steg ligger på Depth (−∞ = 0), öppna steg hörs Open av sin längd, kanterna går på Smooth ms; en lång reverbsvans hackas; en Stutter under gaten hackas; Clear låter som utan gate (inom avrundning); B vinner över A; 🎲-steg slår ur seeds och låter likadant efter Load.
- Exporten: ett klipp med Trance gate blir en egen bit, och reverb/delay-WAV:en är tyst under den.
- Kortet som de andra ljudmoddarnas, med förvalen, och förhandsvisningens rad. Provat i en riktig webbläsare på egen port (inte 5199), också i mobilbredd.
- Testerna går igenom, typecheck och lint är gröna, en sammanfattning i `docs/tasks/fas-26-sammanfattning.md`, och raden Aktuell fas i `CLAUDE.md`.
