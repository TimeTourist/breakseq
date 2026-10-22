# Fas 24g – Nålar i Loops och små rättelser: sammanfattning

## Gjort

1. **Loops: alla matriser är fästa från början, också en ny** (`src/ui/store.ts`, `src/ui/LoopsView.tsx`).
   - Vyns tillstånd sparar nu de matriser som är **lossade** (`Focus.loopUnpins`) i stället för de fästa. Allt annat är fäst, så en ny matrix är fäst direkt. `loopPinned(focus, id)` säger om en matrix är fäst.
   - Load tömmer listan, så efter Load är allt fäst igen. Det sparas fortfarande inte och går inte att ångra.
   - En matrix som tas bort försvinner ur listan. Kommer den tillbaka med Undo är den fäst igen.
   - Tester: `store.test.ts` (allt fäst från början, också en ny matrix; lossa och fäst; Load; inte i historiken) och `shelf-choice.test.tsx`. Där syns en ny matrix direkt på hyllan Pads to use, och en nål som tas bort tar bort den från hyllan.
   - Tester som förut fäste en viss matrix lossar nu de andra med hjälparen `unpinAllBut` (`src/test/focus.ts`).
2. **Gamla projekt: en tom Cycle räknar 1, 2, 3 …** (`upgradeStepEffect` i `src/model/upgrade-mods.ts`).
   - Stegraden räknar 1, 2, 3 … över lika många steg som Ramp får: lika många steg av ratens storlek som modens längsta klipp har, högst 16, och 16 när moden inte ligger i Song. Värden utanför radens omfång begränsas, som för alla gamla värden.
   - En tom Cycle på Pad member blir In turn som förut. En tom List tas fortfarande bort.
   - Den gyllene fixturen har en takt till (takt 8, moden Counting), med tom Cycle på Volume (beat) och Pitch (1/16). Jag gjorde den med den gamla motorn, i en tillfällig worktree på f48fa3b som nu är borttagen. Takt 0–7 blev exakt som förut, och takt 8 låter nu exakt som förut.
   - Tester i `src/engine/lanes.test.ts`.
3. **Pad member: B off släpper igenom A:s medlem** (`applyMods` i `src/engine/mods.ts`).
   - Ett mål kan ha ett värde som inte gör något (`off`), så att den andra radens värde går igenom. Bara Pad member har det: off (0).
   - Test i `src/engine/lanes.test.ts`. A medlem 2 och B off ger medlem 2. A off och B off ger padens eget val (Round robin), samma som utan mod.

## Klart när

- **Testerna går igenom:** 90 filer och 909 tester, mot 90 och 903 förut. Typecheck och lint är gröna.
- **Punkt 1 provad i en riktig webbläsare** (Chromium via Playwright).
  - **Magnus autosparning är orörd.** Servern gick på en egen port, localhost:5289, med en egen tom IndexedDB. Projektet på localhost:5199 rördes inte.
  - Jag importerade kick.wav och gjorde en loop. kick 1 var fäst (Unpin kick 1, gul) och låg på hyllan.
  - Sedan importerade jag hat.wav, som gav en ny matrix. I Loops var hat 1 fäst direkt, och hyllan visade kick 1 och hat 1.
  - När jag lossade hat 1 försvann den från hyllan, och när jag fäste den igen kom den tillbaka.
  - Jag lossade hat 1 och laddade om sidan, så att projektet kom tillbaka från autosparningen. Båda matriserna var fästa igen.
- **Det här och raden Aktuell fas i `CLAUDE.md`.**

## TODO(spec)

Inga nya `TODO(spec)` i koden. Två saker jag valde där specen inte säger något:

- **Hur lång en gammal tom Cycle blir:** lika lång som en Ramp (stegen i modens längsta klipp, högst 16). Den gamla räknaren slutade aldrig, så efter 16 intervall börjar stegraden om på 1, där den gamla gick vidare till 17, 18 …
- **En matrix som kommer tillbaka med Undo** är fäst i Loops, också om den var lossad innan den togs bort.

## Att granska

- **En gammal tom Cycle utanför omfånget låter inte exakt som förut.** Det gäller till exempel Volume per 1/16, där +7 dB och uppåt begränsas till +6. Ett annat exempel är Direction: den gamla gav baklänges bara på 1 och tvingade fram på 2, 3 … Nu begränsas allt till på, alltså baklänges hela tiden. Det följer regeln att värden begränsas till radens omfång.
- **`Focus.loopUnpins` ersätter `loopPins`.** Allt som läste nålarna går via `loopPinned`.

## Att lyssna på

- **Ett gammalt projekt med en tom Cycle på Volume per beat** ska låta som förut: +1, +2, +3, +4 dB.
- **Pad member i både Mod A och Mod B, där B står på off:** A:s medlem ska höras.
