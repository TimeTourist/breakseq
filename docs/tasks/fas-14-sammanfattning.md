# Fas 14 – sammanfattning

## Gjort

- **Modell:** `Pad.choice: 'top' | 'roundRobin' | 'random' | 'noRepeat'` (`PAD_CHOICES`). Nya pads och pads i gamla projekt får `top`, så allt låter som förut. Kommandot `setPadChoice` går att ångra.
- **Generatorn** (`src/engine/pad-choice.ts`, `padPicker`): när varken step lock eller mod har valt medlem väljer paden.
  - Round robin räknar per pad i tidsordning över hela låten, oavsett loop.
  - Random och No repeat tar slump ur den injicerade `Rng`, och bara för pads som spelar slumpvis. Därför ändras inga befintliga tagningar.
  - No repeat drar bland alla utom den senast spelade.
  - Ratchet upprepar samma medlem.
- **Ordningen:** step lock, sedan mod (Pad member, eller Swap Stack som väljer en viss hit), sedan paden. Ignore mods stänger bara av mods, så paden väljer fortfarande.
- **Hits:** raden "Pad plays" med Top, Round robin, Random och No repeat. Ordet "default" på medlem 1 visas bara för Top.
- **Loops:** "Member on this step" börjar med "The pad picks", som är förvalt. Att klicka på en medlem låser den, även medlem 1. Tidigare betydde medlem 1 samma sak som ingen lås.
- **Tester:** `src/engine/pad-choice.test.ts` (8) och `src/ui/pad-choice.test.tsx` (2). Totalt 224, alla gröna. Typecheck och lint är gröna.
- **Verifierat i Chrome** på "Pad 1" (snare_01–04): valet och stegpanelen. Ändringen är ångrad.

## Att granska

- **Låsta steg tar ingen tur:** ett steg med lås eller mod räknas inte i padens round robin, och inte heller som "senast spelad" i No repeat.
- **Längdlinjen i Loops** räknas på medlem 1 (eller den låsta) även när paden väljer. Medlemmarna kan vara olika långa.
- **Steg som låter paden välja** visar inte vilken medlem som kommer att spela, eftersom det avgörs först i låten.

## TODO(spec)

Inga.
