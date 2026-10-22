# Fas 25a – Songs lista, nålar och hylla: sammanfattning

## Gjort

1. **Nålarna i Song i store** (`src/ui/store.ts`).
   - `Focus` har fått `songUnpins`. Där står de loopar och mods som är **lossade** i Song, på samma sätt som `loopUnpins` i Loops. Allt annat är fäst, så en ny loop eller mod är fäst direkt. `songPinned(focus, id)` säger om något är fäst, och åtgärden `songPin` fäster eller lossar.
   - En loop eller mod som tas bort (eller försvinner med Undo) rensas bort i `settleFocus`. Load tömmer listan, så efter Load är allt fäst igen.
   - Nålarna ligger utanför historiken och projektfilen. De har inget med nålarna i Loops eller nålen i Matrices att göra.
   - Fältet är valfritt (`songUnpins?`). Saknas det är inget lossat, och de gamla testerna som bygger en `Focus` behövde inte ändras.
   - Tester i `src/ui/store.test.ts`: allt är fäst från början, också något nytt; lossa och fäst, var och en en gång; inget samband med Loops och Matrices; borttagna rensas bort; inget i historiken, Undo/Redo rör inte nålarna, och efter Load är allt fäst.
2. **Sidan Song som Loops** (`src/ui/SongView.tsx`, ny `src/ui/SongList.tsx`, `src/ui/styles.css`).
   - Sidan har ingen rubrik längre. Listan står till vänster (`samples-layout`, som i Loops) och Song-rutan till höger. Bars, Loop-knappen och läget står i en rad överst i rutan. Songs Loop-knapp är kvar (q4 a).
   - **Listan** har grupperna Main, Fill och Mods i Loops- och Mods-listornas ordning. Varje rad har nålen, namnet (kortat med `middleEllipsis`) i loopens eller modens färg, längden (`musicalLength`: 1 bar, 2 beats) eller antalet effekter (2 effects), och ♪ när den hörs i låten.
   - Raderna går inte att dra. Ett klick spelar loopen en gång (`loopSong`), eller moden en gång på loopen under Plays on (`modPreviewSong` med `previewLoopId`), och väljer ingenting. `playOnce` exporteras nu från `LoopsView.tsx`.
   - **Hyllan Loops and mods** står under Song-rutan och visar bara det som är fäst, i grupperna Main, Fill och Mods (en grupp utan något fäst syns inte). Chipsen dras och placeras som förut. Är inget fäst står det "Pin a loop or mod in the list to use it here." Utan loopar eller mods står No loops yet ← Loops och No mods yet ← Mods som förut.
   - Hjälptexten om tidslinjen står sist i Song-rutan. Hyllan har bara sin egen korta rad.
   - Tester i den nya `src/ui/song-list.test.tsx`, 13 stycken: ingen rubrik och grupperna; radens innehåll och ♪; raderna dras inte; ett klick på en loop spelar den en gång och väljer inget; ett klick på en mod spelar den på loopen under Plays on; hyllan har allt från början i grupper; en nål som tas bort tar bort chipset och tvärtom; något nytt syns direkt; nålar ångras inte; hyllan ber om en nål; tomma lägen länkar till Loops och Mods; chipsen dras och placeras med klick; ett valt chip som lossas placerar inget.
   - `App.test.tsx`: testet med siffertangenterna kollar nu fliken Song i stället för rubriken "Song".

## Klart när

- **Song har en lista med en nål per rad. Allt är fäst från början, något nytt syns direkt på hyllan, och en nål som tas bort tar bort det från hyllan.** Ja.
- **Hyllan visar bara det fästa, och klipp dras därifrån som förut.** Ja.
- **Nålarna sparas inte, går inte att ångra, och efter Load är allt fäst igen. De har inget med nålarna i Loops eller Matrices att göra.** Ja.
- **Testerna går igenom:** 91 filer och 927 tester, mot 90 och 909 förut. Typecheck och lint är gröna.
- **Provat i en riktig webbläsare** (Chromium via Playwright).
  - Servern gick på en egen port, localhost:5291, så Magnus autosparning på 5199 rördes inte.
  - Jag importerade `rex-golden.rx2`, gjorde en ny loop M1 och taggade den Fill, och gjorde en mod Mod 1. Allt var fäst i Songs lista och låg på hyllan i Main, Fill och Mods.
  - Jag drog rex-golden 1 från hyllan till Main och Mod 1 till Mod A med `browser_drag`, och båda blev klipp.
  - När jag lossade M1 försvann gruppen Fill från hyllan.
  - Ett klick på raden rex-golden 1 startade exakt en ljudkälla (jag räknade `AudioBufferSourceNode.start`). Inget klipp eller chip blev valt. Ett klick på Mod 1 gav inget fel.
  - Efter omladdning var allt fäst igen.
  - I telefonbredd (390 px) står listan över Song-rutan och hyllan under, och sidan scrollar inte i sidled.

## TODO(spec)

- **Mod-förvalens egen grupp på hyllan** (Crazy, Rnd). Det står en `TODO(spec)` i `SongView.tsx` där grupperna byggs. Sådana förval finns inte som objekt än (Crazy ligger i `docs/rnd`), och fasen lämnar dem utanför.

Saker jag valde där specen inte säger något:

- **Listans rubrik** är "Loops and mods · pin to use in the shelf", som "Matrices · pin to use in the shelf" i Loops. Hyllan heter också Loops and mods, som specen säger. Två rutor med samma namn kan vara förvirrande. Ett annat namn på listan är lätt att byta.
- **En grupp utan fästa chips** syns inte på hyllan. I listan syns alla tre grupperna alltid.
- **Ett valt chip som lossas** placerar inget med klick på ett spår.
- **En mod utan loop att spela på** (inga loopar) spelas inte vid klick. Inget meddelande visas.
- **Listan går inte att fälla ihop** (det har Loops-listan). Specen nämner det inte för Song.

## Att granska

- Modens färg är appens rosa (`.mod-name`), inte skissens lila. Specen säger "modens färg", och jag använde den befintliga.
- Klippen ser ut som förut. Färgerna, seeden och rutan för det markerade klippet hör till 25b.
- Hjälptexten i Song-rutan är den gamla texten om tidslinjen. Den nya texten om seeds (Song-v2, punkt 5) hör till 25b.
