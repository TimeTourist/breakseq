# Fas 24b – teknisk plan

## Modell (`src/model`)

`types.ts`

```ts
export type StepSize = '1/16' | 'beat' | 'bar';
export const STEP_SIZES: Record<StepSize, number> = { '1/16': 1, beat: 4, bar: 16 };
export type Chance = 100 | 75 | 50 | 25;
/** Fixed: a value. Dice: a band and a chance. */
export type LaneStep = { readonly v: number } | { readonly lo: number; readonly hi: number; readonly chance: Chance };
export const MAX_LANE_STEPS = 16;

/** Targets with a lane: all step targets but Tempo. */
export type LaneTarget = 'padMember' | 'ratchet' | 'pitch' | 'volume' | 'pan' | 'direction' | 'stretch' | 'dist' | 'filter' | 'reverb' | 'delay';
export interface StepEffect {
  readonly target: LaneTarget;
  readonly step: StepSize;
  readonly lane: readonly LaneStep[];   // 1–16
  readonly pitch?: ModPitch;            // Values: Semitones | Free
  readonly stretch?, dist?, filter?, reverb?, delay?   // as before
}
/** Tempo (slip) is unchanged: its rate and its shape (List, Cycle, Ramp, Random) stay. */
export interface TempoEffect { readonly target: 'tempo'; readonly rate: ModRate; readonly shape: TempoShape }
export type ModEffect = StepEffect | TempoEffect | SwapEffect | TapeEffect;
```

`ModShape` heter `TempoShape` och finns bara för Tempo. Dist-radens värden är procent (0–100); motorn delar med 100.

`lanes.ts` (rena funktioner, slump injiceras):

- `LANES: Record<LaneTarget, LaneRange>` – omfång, nollvärde, steg, log, bipolär, på/av, enhet.
- `norm/denorm/quantize(target, x, effect?)`, `zeroOf(target)`.
- `newLane(target)` – 4 steg av beat med nollvärdet (Reverb 100, Delay 80).
- Redigering: `paintSteps(lane, from, to, value)`, `moveEdge(step, edge, value)`, `toggleDice(effect, i)`, `cycleChance(step)`, `randomizeLane(effect, rng, dice)`, `rampLane(effect)`, `nextRampUp(effect)`, `clearLane(effect)`, `inTurn(count)`, `setLength(effect, n)`.
- `upgradeEffect(old, members)` – omräkning av gamla former (List/Cycle exakt, Ramp 16 steg, Random 16 🎲-steg, närmaste chans, begränsat till omfånget). Anropas från `upgradeProject`.

`commands.ts`: `cloneMod(id)` (namn "<namn> copy", nytt id och ny seed); `effectProblem` kontrollerar stegrader (1–16 steg, chans 100/75/50/25, lo ≤ hi).

## Motor (`src/engine/mods.ts`)

- `modValues(dice)`: för en stegeffekt `pos = t − clip.start + clip.offset`, `n = floor(pos / STEP_SIZES[step])`, steget `lane[n mod len]`. Fast → `v`. 🎲 → `rng = dice(CHOICE.mod, mod.seed, clip.seed, targetIndex, n)`; `rng()·100 ≥ chance` → `null` (ingenting); annars värde ur bandet (hela tal för Ratchet, Pad member och Pitch i halvtoner; på/av-rader: på). Samma plats som Random hade, så omräknad Random slår samma tal.
- Tempo: den gamla formkoden, flyttad till `tempoValue` och bara för Tempo.
- Pad member: medlem som paden saknar spelar medlem 1. Direction: på = baklänges, av = hittens egen.
- `laneValueAt(...)` exporteras för förhandsvisningen. `modPassRows(project, modId, loopId, pass)` i `preview.ts` ger per effekt och steg vad den gör i varvet (värde, 🎲-band, Swap: hitten som spelas och om den byttes, Tempo: faktorn, Tape: hastigheten).

## GUI (`src/ui`)

- `ModsView.tsx` – listan (namn, antal effekter, ♪), + New mod, Start from; rubriken (namn, Rename, Clone, Delete, 🎲, antal); korten; + Add effect; `ModPreview`.
- `LaneCard.tsx` – rubrik, enhet, Remove, mening, Step, Length, Randomize, Shift: dice, Ramp ↗/↘, Clear, förval (In turn), egna val; linjal; `LaneEditor`.
- `LaneEditor.tsx` – pekardrag: måla, flytta 🎲-kant, på/av; 🎲 vid hovring; chans-knapp; spöksteg efter ↻; bubbla.
- `laneText.ts` – meningen och värdetexter (rena, testade).
- `SwapCard`, `TempoCard`, `TapeCard` i `ModCards.tsx` – dagens reglage utan målväljaren.
- `ModPreview.tsx` – Plays on, varvets nummer (från spelhuvudet och blocket), rutnätet.
- `Unheard.tsx` – gråat reglage med förklaring (title och synlig text): Ramp på på/av-rad, Multiply/Replace när ingen hit i Plays on har egen stretch, hittens Grain i Matrices när den bara hörs under Stretch-mods i Song.
- Bort: `ModGraph.tsx`, `ModSentence.tsx` (StepSentence), `modText.ts` (parse/format/randomMod; etiketterna flyttar till `modLabels.ts`), New example.

## Tester

- `model/lanes.test.ts`: omfång, nollvärden, redigering (måla, 🎲, chans, Randomize, Ramp, Clear, Length, In turn), omräkning.
- `engine/lanes.test.ts`: Volume 3 steg av 1/16 faller olika på varje slag; 🎲 på Pitch olika i varv 1 och 2, samma i Song varje gång; misslyckad chans; på/av; Pad member utanför paden; List/Cycle/Ramp/Random-projekt ger samma triggers som före omräkningen (gamla triggers räknade med en kopia av den gamla formkoden i testet).
- GUI: kort, Add effect, Clone, Remove, Ramp-text, gråade reglage, Plays on.
- Befintliga tester skrivs om till stegrader.
