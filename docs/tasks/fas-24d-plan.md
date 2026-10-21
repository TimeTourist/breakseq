# Fas 24d – teknisk plan

## Var Scratch hör hemma i renderingen

Fas 24c renderar i tre led: S0 (det som hörs, med stegeffekter, reverb och delay), S1 (S0 med tapes) och ut (ljudmoddarnas skarvar, som läser S1).

Specen säger att Scratch spelar in det som hörs *utan Tape och Scratch*, och att ljudmoddarna räknar in Scratch *som Tape*. Det stämmer med 24c utan ändring om Scratch ligger i led 2 bredvid Tape:

- Scratch läser **S0** (som Tape: utan Tape och Scratch).
- Det Scratch spelar ersätter det som hörs under klippet i **S1** (som Tape), så ljudmoddarna hör Scratch men aldrig tvärtom.
- Där Tape och Scratch verkar samtidigt hörs Scratch (Claudes val, som ordningen bland ljudmoddarna: en gest på ett steg före det som spelar hela klippet). Har A och B båda Scratch vinner B.

## Modell (`src/model`)

```ts
export const SCRATCH_RECORDS = [4, 8, 16, 32] as const;   // 1 beat, 2 beats, 1 bar, 2 bars (i 1/16)
export type FaderCell = readonly [boolean] | readonly [boolean, boolean];
export interface ScratchEffect {
  target: 'scratch';
  record: (typeof SCRATCH_RECORDS)[number];
  step: StepSize;
  points: readonly number[];      // 2–16, nålens läge 0–1 där steget börjar, i steg om 1/(2·record)
  fader: readonly FaderCell[];     // en ruta per steg: hel eller två halvor, öppen (true) eller stängd
}
```

`'scratch'` läggs sist i `MOD_TARGETS` (så tärningarnas nummer står kvar). `scratch.ts` (ren): `snapPoint`, `scratchEnd` (sista steget fortsätter i sin fart), `scratchSpeeds`, `scratchMotion` (held under 0,05×), `scratchCurve` (Catmull-Rom per steg som ett tredjegradspolynom), förvalen Baby/Chirp/Transformer/Tear som skissen, `newScratch` (Baby på 1 bar), `clearScratch`, `rampScratch` + `scratchRampsUp` (räknas ur punkterna, som stegraderna), `randomizeScratch(rng)` (skissens slumpvandring), `setScratchLength`, `toggleFader` (klick, Alt-klick delar/slår ihop), `scratchProblem` (för kommandona).

**Kurvans ändar** *(Claudes val)*: Catmull-Rom behöver en punkt före första och efter sista. Skissen upprepar ändpunkten, vilket gör att kurvan börjar och slutar i halv fart. I stället förlängs kurvan rakt (spegling), så en rak linje är rak hela vägen. Annars vore Clear inte 1× i första och sista steget, och klarkravet ”Clear låter som utan Scratch” kunde inte hålla. Kortet ritar samma kurva som ljudet spelar.

## Generatorn (`src/engine/scratch.ts`, ren)

`scratchSplices(project, runs): Splice[]` med samma `Splice` som ljudmoddarna:

- fönster per steg: B:s klipp om dess mod har Scratch, annars A:s
- inspelningen börjar där klippet börjar på tidslinjen (som Tape), och är `record` steg lång
- nålraden räknas från klippets innehåll (som stegraderna: `clip.start − offset`) och loopar på sin längd
- varje steg blir en skarv vars `source` är kurvans polynom gånger inspelningens längd plus dess start; med två faderhalvor blir det två skarvar (`clipSplice`)
- gain 0 där steget står still (under 0,05×) eller fadern är stängd
- loopens hopp är bara att nästa skarv börjar på första punkten: skarvar bredvid varandra tonas över 3 ms, så hoppet och faderkanterna klickar inte

`Take` får `scratches?: readonly Splice[]`. Triggers under Scratch ligger kvar i `take.triggers` (spelhuvudet följer huvudklockan, som för ljudmoddarna); MIDI-exportens TODO(spec) gäller också Scratch.

## Renderingen

- `applySplices(base, splices, sampleRate, source = base)`: läser ur `source` och tonar ut `base`.
- `finishHeard`: S0 → tapes → `applySplices(out, scratches, sr, S0)` → ljudmoddarna. Gäller varje mix (dry + space = all håller, eftersom allt är linjärt).
- Cachenyckeln i `render-chunks` får med `scratches`.

## Fliken Mods (`src/ui`)

- `ScratchCard.tsx`: som skissen: namnet, needle + fader, Remove, meningen, Records the first … under the clip, Step, Length (2–16), Start from (Baby, Chirp, Transformer, Tear), 🎲 Randomize, Ramp ↗/↘, Clear, färgförklaringen, linjalen, nålraden (SVG med kurvan i framåt/bakåt/stilla, spöken efter ↻, hoppet streckat, punkter, bubbla under draget), farten under varje steg, faderraden (klick, Alt-klick) och förklaringen under.
- Dra på nålraden: närmaste punkt, måla över stegen man drar över, värdet fäst vid 1/(2·R); ett drag är ett ångra-steg.
- `scratchSentence` i `audioText.ts`. `ADD_ORDER` och `TARGET_LABELS` får Scratch efter Tape. Förhandsvisningen får en rad för Scratch (▸ ◂ –, fadern som skugga). Song-klippets text: ”scratch”.

## Tester

- model: förvalen exakt, Clear, Ramp åt båda håll, Randomize fäst och inom 0–1, längd 2–16, fader-klick och Alt-klick, kontroller i kommandon, kurvan (rak linje är rak, går genom punkterna).
- engine: skarvar för Baby (baklänges varannat steg), Chirp (gain 0 där fadern är stängd), held tyst, loopens hopp, B vinner, Scratch läser inspelningen från klippets start.
- render: Clear ger samma ljud som utan Scratch (inom avrundning); Chirp tyst där fadern är stängd; Scratch spelar in utan Tape, och en ljudmodd hör Scratch.
- UI: kortet, meningen, förvalen, Clear, Ramp, Alt-klick, längd, Add effect, förhandsvisningens rad.
