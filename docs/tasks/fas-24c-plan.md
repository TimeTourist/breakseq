# Fas 24c – teknisk plan

## Det flakiga testet (gjort först)

`render-chunks.test.ts > gives the same tape …` föll ibland. Orsaken: `renderChunk` sparade bara `getChannelData`-vyer av delens renderade `AudioBuffer` och lade ihop dem först efter att andra delar renderats. I node-web-audio-api håller en vy inte bufferten vid liv: när bufferten samlats in läser vyn frigjort minne, och ibland blev några bildrutor fel (i testet sista bildrutan i ett slag, 0 i stället för −0,31). Rättat genom att delen sparar kopior. I webbläsaren håller en vy sin buffer vid liv, så där hände det inte. Reproducerat: 1–17 fel på 300 varv före, 0 på 900 efter.

## Idé: det som hörs är en ljudbuffer som ljudmoddarna läser ur

Renderingen sker i tre led, alla på hela låtens tidslinje i sekunder:

1. **S0, det som hörs:** alla slag som hörs (Main eller Fill med stegeffekterna), med reverb och delay. Det är dagens rendering i bitar (cache, parallellt), men av *alla* slag, också de under Tape-klipp.
2. **S1, med tape:** varje Tape spelar in `S0[start, start + längd)` (alltså med reverb och delay, och det som klingar in i segmentet) och spelar den som idag (Web Audio, `scheduleTape`). Under tapens spann ersätter tapen S0 med en övertoning på 3 ms.
3. **Ut, med ljudmoddarna:** varje ljudmodd beskrivs av generatorn som *skarvar* (`Splice`) som läser ur S1. Där en skarv ligger ersätter den S1, med 3 ms övertoningar i kanterna. Ingen modd läser en annan moddens utdata (bara S1), och ingen läser sig själv.

Som en glitch-effekt på utgången: när klippet slutar hörs det som hörs på huvudklockan igen, också svansar av det som spelade under klippet. Allt i led 2 och 3 är linjärt i ljudet, så `dry` + `space` blir fortfarande `all`.

Scramble med Whole song läser bara ur S1, som redan är hela låten i minnet: bitarna i led 1 påverkas inte, och led 3 är billigt (bara bildrutorna under skarvarna räknas).

## Modell (`src/model`)

`types.ts`

```ts
export type CellSize = 0.5 | 1 | 2 | 4;              // 1/32, 1/16, 1/8, beat (i 1/16-steg)
export interface ModScramble { cell: CellSize; from: 'song' | 'around' | 'clip'; around: 1 | 2 | 4; reverse: 0 | 25 | 50 | 100 }
export interface ModStutter  { grabs: 1 | 2 | 4; pitch: -2 | -1 | 0 | 1 | 2; gate: 100 | 75 | 50 }
export interface ModFreeze   { grain: 10 | 30 | 80; spread: 0 | 25 | 50; level: -6 | -3 | 0 }
export interface ModReverse  { cell: CellSize }
export interface ModRewind   { pullBack: 4 | 8 | 16; curve: 'fast' | 'slowing' | 'spinBack' }
// LaneTarget += 'scramble' | 'stutter' | 'freeze' | 'reverse' | 'rewind'; StepEffect får de valfria fälten ovan.
export interface HalftimeEffect { target: 'halftime'; speed: 0.5 | 0.75 | 2; keepPitch: boolean }
export type ModEffect = StepEffect | TempoEffect | SwapEffect | TapeEffect | HalftimeEffect;
export const AUDIO_TARGETS = ['scramble', 'stutter', 'freeze', 'reverse', 'rewind', 'halftime'] as const;
```

`MOD_TARGETS` får ljudmoddarna sist, så målens nummer i tärningarna är desamma som förut.

`lanes.ts`: `LANES` för de fem raderna (Scramble 0–100 % steg 5, nytt värde 50; Stutter 0–3 = off, 1/16, 1/32, 1/64; Freeze, Reverse, Rewind på/av). `wholeValues` gäller Stutter. 🎲 på ett Stutter-steg ger ±1 som skissen. `newStepEffect` ger modernas förval (skissens `EXDEF`). `commands.ts` kontrollerar inställningarna och Halftime.

## Generatorn (`src/engine/audio-mods.ts`, ren, utan Web Audio)

```ts
/** En skarv: under [time, time + length) spelas S1 från positionen source(u), u = 0…1 över skarven. */
export interface Splice {
  readonly time: number;
  readonly length: number;
  /** Position i S1 i sekunder: s0 + s1·u + s2·u² + s3·u³. Tonhöjden följer farten, som en skiva. */
  readonly source: readonly [number, number, number, number];
  readonly gain: number;
  /** Spelas som korn i 1× (tonhöjden kvar) som läser där source pekar, med förskjutningar (Freeze Spread). */
  readonly grains: { readonly length: number; readonly offsets: readonly number[] } | null;
}
export function audioSplices(project: Project, runs: ModRuns, dice: Dice): Splice[];
export function scrambleCells(...): ScrambleCell[];   // också för bilden Where each cell comes from
```

- Per mål och steg: B:s klipp om B:s mod har målet, annars A:s (B vinner).
- Varje mål räknar fram *var det verkar* (intervall) och skarvar för det. Där flera mål verkar samtidigt vinner ett i fast ordning (Rewind, Stutter, Freeze, Reverse, Scramble, Halftime); de andra klipps bort där.
- Stegraderna läses med `laneValueAt` och `laneDice` som idag (🎲-steg ur modens och klippets seeds, målet och steget). Övrig slump (Scrambles rutor, Freezes Spread) ur `dice(CHOICE.audio, mod.seed, clip.seed, mål, plats)`.
- Scramble: rutor på låtens rutnät; varje ruta under klippet byts med radens chans mot en slumpad ruta ur Take from, och spelas baklänges med Reverse chance.
- Reverse: rutor där raden är på spelas baklänges (source från rutans slut till dess början).
- Stutter: på ett steg med 1/16, 1/32 eller 1/64 upprepas början av Grabs-fönstret (låtens rutnät) i den längden; varje upprepning n får n · Pitch per repeat halvtoner och hörs Gate % av sin längd (resten tyst: en skarv med gain 0).
- Freeze: ett sammanhängande spann av på-steg håller kornet där spannet börjar, som korn med Grain-längd och Spread.
- Rewind: på ett steg drar den tillbaka Pulls back över stegets längd. Fast: jämn fart; Slowing: snabbt först, stannar; Spin-back: skivan bromsar, vänder och snurrar baklänges allt fortare.
- Halftime: hela klippet, source = klippets början + farten · tiden; Keep pitch som korn på 30 ms.

`Take` får `heard` (alla slag som hörs, källan för S0; saknas den gäller `triggers`) och `splices`. `Tape.source` försvinner: inspelningen är S0. `take.triggers` är som förut (utan slagen under Tape), för spelhuvudet och MIDI.

## Renderingen

- `render-chunks.ts`: S0 av `take.heard`, i bitar som idag (inga tape-bitar längre). Sedan `finishHeard`.
- `render-heard.ts` (ny): `finishHeard(s0, take, sampleRate, cache)` – tapes (Web Audio, en kontext per tape från låtens början som idag, i cachen med nyckel av tapen och en hash av inspelningen), sedan `applySplices`.
- `render-audio-mods.ts` (ny): `applySplices(channels, splices, sampleRate)` – ren JS på Float32Array: läser S1 med linjär interpolation, korn med Hann-fönster och halv överlappning, och övertoningar på 3 ms.
- `renderTakeWhole` gör samma led på en kontext, så bitar och helt kan jämföras som förut.

## Fliken Mods (`src/ui`)

- `LaneCard` får ljudmoddarnas egna val (skissens etiketter och värden), raden Source …, förvalet Roll på Stutter, och under Scramble bilden Where each cell comes from med 🎲 Reroll. Around the clip gråas med förklaring när Take from inte är ± bars.
- `HalftimeCard` (utan stegrad): Speed och Keep pitch, meningen och Source-raden.
- `laneText`: meningarna från skissen, värden (off, 1/16 …, ❄, ◂, ⟲).
- `ADD_ORDER` och `TARGET_LABELS` med de sex (Scratch kommer i 24d). Förhandsvisningens rutnät får rader för dem.

## Tester

- `audio-mods.test.ts`: Roll på sista slaget (1/16, 1/32, 1/64), Scramble Whole song (rutor utanför klippet, samma varje gång, andra efter Reroll), Reverse, Freeze, Rewind, Halftime, B vinner, ordningen, efter klippet.
- `render-audio-mods.test.ts`: `applySplices` på en stigande ramp (baklänges, hållen, halv fart, övertoningar).
- `render.heard.test.ts`: Tape över ett reverbkast spelar in svansen; bitar = helt med tape och ljudmoddar; varje modd hörs i rätt område i en riktig rendering.
- `model`: nya effekter, kontroller, 🎲 på Stutter.
- UI: korten, meningarna, Around the clip gråad, Roll, Halftime.
