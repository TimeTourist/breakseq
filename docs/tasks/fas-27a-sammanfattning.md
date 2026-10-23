# Fas 27a – Mod-förval: sammanfattning

## Gjort

- **Modellen** (`src/model/presets.ts`):
  - Förvalen ligger nu i model, inte i ui. `START_FROM_PRESETS` har de 21 under Start from. `AUDIO_PRESETS` har en per ljudmodd: Stutter Roll, Scratch Baby, Freeze, Reverse, Rewind, Halftime, Scramble och Trance gate Straight. `MOD_PRESETS` har alla 29.
  - Varje förval har `strength: 'extreme' | 'subtle'` enligt specens listor, så att 27b kan välja bland dem.
  - `effects(project)` räknas när förvalet skapas i ett projekt.
  - `src/ui/modPresets.ts` är borttagen. `DEFAULT_TAPE` och Stutters Roll (`STUTTER_ROLL`) ligger i model.
- **`Mod.isPreset?: true`** (`types.ts`). En egen mod har ingen flagga.
- **Nytt projekt:** `newProject(ctx)` (`project.ts`) är ett tomt projekt med alla förval, med fasta id:n och seeds. Det används när appen startar (`main.tsx`) och vid Start empty / Open i Project. `createProject()` är fortfarande helt tomt, för testerna.
- **Load:** `upgradeProject` lägger till de förval som saknas (`addMissingPresets`). Ingenting spelar dem, så låten låter likadant (`src/engine/presets-load.test.ts` jämför hela tagningen före och efter).
- **En ändring av ett förval:**
  - Det gäller `addEffect`, `replaceEffect`, `removeEffect` och `rerollMod`.
  - Ändringen gör en egen mod med samma namn och en siffra ("Gate 2"). Den nya moden får ändringen, och förvalets klipp i Mod A/B flyttas till den.
  - Allt är ett enda kommando, och förvalet är oförändrat.
  - `renameMod` och Delete (`remove`, `removeAnyway`) vägrar på ett förval.
  - `cloneMod` och `startFromPreset` gör egna mods utan flagga.
  - `rerollAll` rör inte förvalen.
- **Mods:**
  - Egna mods står först. Sist kommer gruppen Presets, där varje rad har markeringen ◇ (aria-label "preset").
  - Ett valt förval har ordet preset i rubriken och en rad som förklarar att det aldrig ändras. Det har Clone och 🎲, men inte Rename eller Delete.
  - En ändring eller 🎲 på förvalet väljer den nya moden.
  - Kortens React-nycklar och sammanslagningsnycklar följer med från förvalet till den nya moden. En drag som börjar på förvalet fortsätter därför i den nya moden och blir ett enda steg i historiken.
  - Start from listar samma 21 som förut och gör en egen mod från projektets förval.
  - + New mod numreras efter de egna modsen.
  - Utan vald mod visas den första i listan.
- **Song:**
  - Listan visar bara egna mods.
  - Hyllan har gruppen Presets sist, alltid synlig och utan nålar (`shelfGroups` i `SongList.tsx`).
  - "Pin a loop or mod" visas när inget fäst finns kvar.
  - `TODO(spec)` i `SongView.tsx` är borttagen.
- **Specen:** valen står under Mod-förval som *Byggt i fas 27a (Claudes val)*. Raden om Listan och hyllan säger att gruppen är byggd.

## Klart när

- **Modellen** (`src/model/presets.test.ts`, 22 tester):
  - listan och klassningen
  - nytt projekt och Load (saknade läggs till efter namn, befintliga behålls)
  - varje sorts ändring och 🎲 (ny mod, klippen flyttas, förvalet orört, namn med nästa lediga siffra)
  - Undo i ett steg och en ändring som inte ändrar något
  - Rename och Delete vägras; Clone, Start from och Reroll everything
- **UI** (`src/ui/presets.test.tsx`, 9 tester): gruppen och markeringen i Mods, knapparna på ett förval, en ändring och Undo, 🎲, Start from, New mod, Songs lista och hylla.
- **Gamla tester:** de som sparar och laddar om ett projekt (`project-file`, `project-folder`, `persist`) börjar nu med `newProject`, så att Load inte lägger till något. `seeds` och `lanes` jämför de egna modsen.
- **Provat i Chromium (Playwright)** på en egen dev-server, localhost:5287 (inte 5199):
  - 120FourBeats.rx2 importerades. Mods öppnade Tape rock och visade 29 förval.
  - En drag över Gates Volume-rad gjorde Gate 2 och målade båda stegen. En Undo tog bort allt.
  - Tape stop drogs från hyllan till Mod A. Dubbelklick öppnade den i Mods, och 🎲 gjorde Tape stop 2, som klippet nu spelar.
  - I 375–390 px bredd finns ingen sidledes rullning, och listan och hyllan ser hela ut.
  - Inga fel i konsolen.
- **Testerna går igenom:** 96 filer och 1005 tester. Typecheck och lint är gröna.

## TODO(spec)

- `src/model/presets.ts`: specen namnger Freeze, Reverse och Rewind som förval men säger inte hur deras rader ser ut. En ny effekt av dem är helt av och hörs inte. De är ritade på sista slaget i varje takt: 4 steg av beat, det fjärde på.

## Borde granskas

- Valen ovan, som står i specen som Claudes val:
  - förval läggs till efter namn vid Load
  - seeden behålls vid en ändring
  - Start from numrerar namnet
  - Reroll everything hoppar över förvalen
  - markeringen ◇
- Undo-texten för en ändring av ett förval är "Undo: add mod Gate 2". Den är sann men kunde säga mer.
- Efter Undo av en ändring är den nya moden borta, och Mods visar den första i listan i stället för förvalet.
