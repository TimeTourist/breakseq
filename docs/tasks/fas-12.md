# Fas 12 – Hits längd

## Mål

Man ska se hur länge varje hit låter. I Loops fortsätter en linje under stegets hit över de följande stegen, tills ljudet tar slut eller nästa slag klipper det. I Slice visas var varje slice hamnar på 1/16-griden när föräldern läggs i en loop.

**Klart när:** en split `+-|+-|+---` syns som 2/16, 2/16 och 4/16, både i Slice och när föräldern dras in i en loop. Testerna går igenom, typecheck och lint är gröna, och det finns en sammanfattning i `docs/tasks/fas-12-sammanfattning.md`.

## Beslut (Magnus, 2026-10-16)

1. Längden i Loops räknas i **låtens tempo** (det man hör). I Slice räknas den i breakets tempo.
2. En svans **slutar vid nästa slag**, eftersom det är där ljudet klipps.
3. Gäller **även one-shots**.
4. Svansen visar hiten **utan mods**, men med hittens och förälderns pitch.
5. Slice får en **rad med 1/16-steg** under vågformen, ritad som i Loops, och svaga 1/16-linjer över vågformen.
6. Två slices på **samma steg** markeras rött, eftersom den andra inte kommer med.
7. Trioler och mikrotiming (nudge) väntar.
