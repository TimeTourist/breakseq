# Fas 25b – Seeden syns i Song: sammanfattning

## Gjort

1. **Reroll everything behåller kopior** (`src/model/reroll.ts`).
   - `rerollAll` ger klippen nya seeds via `reseedClips`. Klipp som hade samma seed får samma nya seed, så kopior förblir kopior. Alla andra klipp får var sin egen. Mods, matriser och pads får nya seeds som förut.
   - Det är fortfarande ett enda kommando, så Undo tar tillbaka allt i ett steg.
   - Test i `src/model/seeds.test.ts`: ett klipp och dess kopia får samma nya seed, och modklippet får en egen.
2. **Regeln "låter likadant"** (`src/model/clips.ts`).
   - `soundsSame(a, b)`: samma loop eller mod, samma seed och längd, och samma start i loopen.
   - `sameSeed(a, b)`: bara samma seed.
   - Ett klipp är aldrig sin egen tvilling.
   - Tester i den nya filen `src/model/clips.test.ts`, 5 stycken.
3. **Texterna** (ny `src/ui/clipSeed.ts`).
   - `seedCode` ger tre hexsiffror (◆ 7f3).
   - `placeText` säger var klippet ligger, som start och längd: "at 4.3 · 1 bar" (se Efter 25b nedan).
   - `twinsText` ger meningen i rutan: "Same seed as the clip at 2.1: they sound the same.", "Shares its seed with the clip at 2.1." eller "Its own roll.". Är det flera klipp blir det "the clips at 2.1 and 4.1".
   - `clipSeedTitle` ger muspekartexten på klippet: "amen 1 · at 1.1 · 1 bar · seed ◆ 7f3 (sounds the same as the clip at 3.1)", följd av den gamla texten om att dra.
4. **Song** (`src/ui/SongView.tsx`, `src/ui/RerollButton.tsx`, `src/ui/styles.css`).
   - Varje klipp visar ◆ och seedkoden i nedre högra hörnet (först vänstra, se Efter 25b).
   - **Rutan Selected clip** ligger under tidslinjen när ett klipp är markerat. Den har namnet i klippets färg (main, fill eller modens rosa), raden och var det ligger (Main · at 1.1 · 1 bar), seeden, meningen och två knappar:
     - **Copy after it** gör samma sak som Ctrl+D. Båda använder `copyAfter`. Kopian blir markerad, och vid låtens slut står "No room after it: the song ends there".
     - **🎲 Reroll this clip** är en vanlig `RerollButton` med text (nytt valfritt fält `text`).
   - 🎲 på klippets kant finns kvar. Båda tärningarna har skissens muspekartext: "Reroll this clip: new random here only. A copied clip keeps its seed, so it sounds the same until you reroll it. Undo brings it back."
   - **Hjälptexten** sist i Song-rutan börjar nu med seeds: varje klipp har en egen seed (◆), en kopia behåller den och låter likadant, 🎲 slår bara om det markerade klippet, och låten låter likadant varje varv, som Export WAV skriver den. Sedan kommer den gamla texten om tangenter och linjal.
   - Tester i den nya filen `src/ui/song-seed.test.tsx`, 14 stycken:
     - seedkoden, starten och längden
     - ◆ på klippen och samma ◆ på en kopia
     - muspekartexten
     - de tre meningarna och flera klipp
     - att rutan saknas utan markerat klipp, och vad den innehåller för en loop och för en mod
     - Copy after it och Ctrl+D
     - en kortad kopia, som bara delar seed
     - att det inte finns plats vid slutet
     - 🎲 i rutan och Undo
     - 🎲 på kanten
     - att Reroll everything behåller kopior i appen
     - hjälptexten
   - `reroll.test.tsx` kollar den nya muspekartexten på 🎲 på klippet.
5. **Spec och CLAUDE.md:** "inte byggt än" är borttaget för 25b-punkterna under Song-v2, och mina val står vid regeln (se nedan). TODO:n om mod-förvalens grupp ligger kvar. CLAUDE.md säger att 25b är klar och att fas 25 är klar.

## Klart när

- **Varje klipp visar sin seed. En kopia visar samma, 🎲 ger en ny, och Undo tar tillbaka den gamla.** Ja.
- **Ett markerat klipp har en ruta med namn, rad och takter, seed, mening, kopieringsknapp och 🎲 Reroll this clip.** Ja.
- **Reroll everything låter kopior förbli kopior.** Ja.
- **Testerna går igenom:** 93 filer och 948 tester (förut 91 och 927). Typecheck och lint är gröna.
- **Provat i en riktig webbläsare** (Chromium via Playwright).
  - Servern gick på en egen port, localhost:5292, så Magnus autosparning rördes inte.
  - Jag importerade `rex-golden.rx2` och drog rex-golden 1 från hyllan till Main. Klippet fick ◆ 4db.
  - Ctrl+D gav en kopia med ◆ 4db och "Same seed as the clip at bars 4–5: they sound the same."
  - Copy after it gav en tredje kopia med samma ◆, och meningen nämnde båda de andra.
  - 🎲 Reroll this clip gav ◆ f88 och "Its own roll.", och Undo ("Undo: reroll clip rex-golden 1") gav tillbaka ◆ 4db.
  - Reroll everything gav alla tre ◆ 355. De förblev kopior.
  - I telefonbredd (390 px) radbryts rutan, och sidan scrollar inte i sidled.

## Efter 25b (Magnus beslut 2026-10-22)

Magnus godkände två ändringar efter första rundan. De står i specen under Song-v2.

1. **Var ett klipp ligger sägs som start och längd**, starten som takt.slag som i linjalen: "at 4.3 · 1 bar". Det gäller i rutan (Main · at 4.3 · 1 bar), i meningen (the clip at 4.3) och i muspekaren. Förut stod det "bar 4" eller "bars 4–5".
   - Längden kommer ur `clipLength`, som bygger på appens `musicalLength`: 2 beats, 1 bar, 1 bar 2 beats, 2 bars 3/16.
   - En start mellan slagen får sin 1/16 också: 4.3.2. Det är Claudes val.
2. **◆-taggen sitter i klippets nedre högra hörn.**

Testerna i `song-seed.test.tsx` är ändrade till de nya texterna. Det finns ett nytt test för längderna (15 tester i filen). Provat i en riktig webbläsare på localhost:5293.

## TODO(spec)

- **Mod-förvalens egen grupp på hyllan** (Crazy, Rnd). Den finns kvar från 25a, i `SongView.tsx`.

Saker jag valde där specen inte säger något (de står nu i specen som Claudes val):

- **"Börjar på samma ställe i loopen"** betyder samma `offset` som den är, utan att räkna runt. Slumpvalen följer offset utan att räkna runt (`clipPlace`), så ett klipp som börjar en hel loop längre in väljer annorlunda. Med den här tolkningen säger rutan aldrig "they sound the same" om klipp som inte gör det.
- **Ett loopklipp i Main och ett i Fill** räknas som samma loop, och likaså en mod i Mod A och i Mod B.
- **Seedkoden** är seedens tre sista hexsiffror. "Samma seed" jämför alltid hela seeden.
- **Låter några klipp likadant medan andra bara delar seed** nämner meningen bara de som låter likadant.
- **Copy after it** är alltid klickbar. Vid låtens slut visar den samma fel som Ctrl+D.

## Att granska

- **Klippens färger** är som förut: mörka med färgad ram. Förslaget i `fas-25.md` om fyllda klipp med mörk text står inte i specens Song-v2-punkter, så jag lät dem vara.
- **Länkraden** visar inte klippets takter och seed efter Song (bar 4 · ◆ 7f3). Det var också ett förslag i `fas-25.md` som inte står i specen.
- **◆-taggen** i nedre högra hörnet kan täcka de sista stegens markeringar och, i ett mycket kort klipp, namnet. Den har en halvgenomskinlig bakgrund.
