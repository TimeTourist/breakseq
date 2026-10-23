# Fas 27b – Crazy madness: sammanfattning

## Gjort

- **Modellen:**
  - `Project.mode` (`'total' | 'crazy'`) och `Project.recipeSeed` (`types.ts`).
  - `newProject` är i Crazy madness och har en egen `recipeSeed`.
  - `upgradeProject` öppnar ett projekt utan läge i Total control. Ett projekt utan recept får en `recipeSeed` räknad ur samplens id:n (`recipeSeedOf`), så den blir densamma vid varje Load.
  - `setMode` byter läge och går att ångra.
- **Receptet** (`src/model/crazy.ts`): rena funktioner, ingen DOM och ingen `Math.random`. Slumpen kommer ur `recipeRng(seed, …nycklar)`.
  - `rollRecipe(seed)` väljer en variant per regel ur seeden och regelns namn (`RECIPE_RULES`).
  - `styleAt` ger Fill-loopen och Hit-varianter, med Egen stil per plats.
  - `roleAt` räknar Roll, och ett break är alltid main när det inte finns någon main än.
  - `fillBars` räknar Form, `fillSteps` Fill-loopen, `variantCounts` Hit-varianter, `makeVariant` de tre sorterna och `modPlan` Mods.
- **Att foga in ett break** (`build`):
  - Breaket får hit-varianter, och pads med varianter väljer Random.
  - Det får en fill-loop när det behövs.
  - Låten får ett avsnitt om 16 takter sist, med main enligt Form (offset så att main håller takten), fill-loopen på fill-takterna, Slut och Mods.
  - Mods läggs i Mod A, och i Mod B där Mod A är upptagen.
  - Allt görs med de vanliga kommandona: `addVariant`, `updateHit`, `setHitSource`, `setPadChoice`, `addClip`, `pasteClip` och `setSongBars`.
- **`crazyChain(command)`:** i Crazy madness bygger den varje trim som kommandot slicade första gången, alltså när trimmens egna matris fick sin loop, i samma kommando. Store kör varje kommando genom den (`reduce`, `run`), så en Undo tar bort allt. Total control gör som förut.
- **`goCrazy()`:**
  - Matriser, loopar, pads, hits, förval och hela låten tas bort.
  - Förvalen görs på nytt, och varje sample får sin egen matris igen (`remakeOwnMatrix` i `chain.ts`).
  - Varje slicad trim byggs i samplens ordning med en ny `recipeSeed`.
  - Samples och egna mods blir kvar. Allt är ett kommando.
- **Headern** (`Header.tsx`, `icons.tsx`):
  - Lägesknappen sitter först till höger, före tempot. Den visar den glada eller den galna acid-smileyn från skissen.
  - Muspekartexten är "Crazy madness. Click for Total control" eller "Total control. Click for Crazy madness".
  - Direkt efter den kommer Go crazy, med den galna smileyn och muspekartexten från specen.
  - Smileysens färger ligger som `--face` och `--ink` i `styles.css`.
- **Undo-texter:** "go crazy", "switch to Crazy madness" och "switch to Total control". Ett bygge heter som slicingen, till exempel "slice amen 1".
- **Specen:** headerns ordning är uppdaterad, och valen står under Crazy madness som *Byggt i fas 27b (Claudes val)*.

## Klart när

- **`src/model/crazy.test.ts`, 47 tester:**
  - läget: förval, gamla projekt, byte och Undo
  - receptet: deterministiskt, och varje variant av varje regel förekommer
  - Roll, Form och Fill-loopen, med varje variant
  - Hit-varianter: Få, Många och Vilda, och sorterna Ändrad, Annan och Baklänges
  - Mods: Extrem och subtila, Många små och En stor
  - Slut: Mod på slutet, Tape stop och Inget särskilt
  - Mod B när Mod A är upptagen
  - Nya breaks: Samma stil och Egen stil
  - en låt på 16 takter, en Undo, samma projekt ger samma låt, Total control, bara första slicingen, REX-import och one-shot
  - ett andra break: ett nytt avsnitt, som fill, och sedan som main med fill-breakets loop
  - Go crazy: vad som tas bort och blir kvar, samma seed ger samma låt, båda lägena, Undo, inget dubbelt bygge
- **`src/ui/crazy.test.tsx`, 7 tester:** store-vägen i båda lägena, knapparna med texter och plats, Go crazy med Undo, och Undo-texterna.
- **`src/engine/crazy-render.test.ts`, lyssningsproxy:** en låt som Crazy byggt, och samma låt efter Go crazy, renderas utan en enda tyst takt.
- **`phase3b.test.tsx`:** headerns ordning har nu lägesknappen och Go crazy först.
- **Provat i Chromium (Playwright)** på en egen dev-server, localhost:5293 (inte 5199). Autosparen för den porten tömdes så att appen startade med ett nytt projekt.
  - Nytt projekt i Crazy madness. test_break.wav importerades och slicades på 1/16.
  - Det gav en låt på 16 takter: Tre fills (F1 på takt 8, 12 och 16), main däremellan, Filter rise, Pitch stair, Thin out och Slip 1/3, och Tape stop på takt 16.
  - 120FourBeats.rx2 importerades som andra break. Det blev en fill och ett nytt avsnitt på takt 17–32, med test_break som main, F2 på fill-takterna och egna mods.
  - Go crazy gav nya mods, och en gång till Korta mains med nya mods. Undo två gånger gav tillbaka den första låten. Undo-texten var "Undo: go crazy".
  - Play renderade och spelade, utan fel i konsolen.
  - Lägesknappen bytte till den glada smileyn, med "Undo: switch to Total control".
  - I 375–390 px bredd finns ingen sidledes rullning.
- **Testerna går igenom:** 99 filer och 1061 tester. Typecheck och lint är gröna.

## TODO(spec)

- Inga nya.
- Den gamla om Freeze, Reverse och Rewind (`src/model/presets.ts`) gäller fortfarande. Crazy väljer nu de förvalen, så de hörs i låtar.

## Borde granskas

- Valen under *Byggt i fas 27b* i specen, särskilt:
  - att main får en offset efter sin plats i avsnittet, så att den håller takten
  - vad 40 % är i Ändrad
  - att Annan först väljer en sample med lika chans
  - att den extrema moden får ligga på en fill-takt
- Tabellen ger Nya breaks två varianter, fast texten säger att varje regel har tre.
- Ett break som slicas utan att följa samplens ordning får sin plats efter de andra. Go crazy räknar i samplens ordning, så rollerna kan bli olika.
- Med de två nya knapparna bryts headerns transportrad till en egen rad redan vid omkring 1500 px bredd. Förut rymdes den.
- **Lyssna på:**
  - en låt efter första slicingen: fills, hit-varianter (Random) och mods
  - Go crazy några gånger i rad
  - ett andra break som fill
  - Halftime, Scramble och Scratch Baby som extrema mods
  - Tape stop i slutet av avsnitten
