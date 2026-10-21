# Fas 24a – Seeds och Reroll: sammanfattning

## Gjort

- **Seeds i modellen.** `Mod`, `Matrix`, `Pad` och `Clip` har `seed` (heltal 0 ≤ seed < 2³²). Nya objekt får sin seed ur `CommandContext.newSeed`, som i appen är `crypto.getRandomValues` och i testerna 1, 2, 3 … (`sequentialIds`).
  - Ett kopierat eller inklistrat klipp behåller sin seed. Det gör också båda halvorna när ett klipp delas av ett annat.
  - En klonad matrix, en kopierad pad och en ny mod får nya seeds.
  - `upgradeProject` ger objekt utan seed en seed räknad ur id:t (`seedOf`, FNV-1a). Samma fil får alltså samma seeds varje gång den laddas. Det gäller autosparen, säkerhetskopior, snapshots och .zip.
- **Reroll-kommandon** (`src/model/reroll.ts`): `rerollAll`, `rerollMod`, `rerollMatrix` (matrisen och dess pads), `rerollPad` och `rerollClip`. Vart och ett är ett Undo-steg, och Undo säger vad det slog om (`describeChange`: "reroll everything", "reroll clip M1" …).
- **Slump ur seed och plats** (`src/engine/random.ts`). Generatorn tar inte längre en `Rng`. Varje slumpval får en egen Rng ur `placeRng(val, seeds …, plats)`:
  - Random och No repeat på pads: matrisens, padens och klippets seeds och steget i klippet.
  - Random i mods: modens och klippets seeds, målet och intervallet.
  - Stack: modens och klippets seeds och intervallet.
  - Shuffle: modens och klippets seeds.
  - Wow och flutter på Tape: modens och klippets seeds och var fönstret börjar i klippet.

  `generateTake(project, { from?, dice? })`. `dice` finns bara för tester som vill styra slumpvärdena (`withRng` i `src/test/fixtures.ts`).
- **Round robin och No repeat** (`pad-choice.ts`) har ett läge (`PickState`) som ett pass kan börja från och lämna efter sig (`take.end`).
- **Varv** (`preview.ts`, `src/ui/varv.ts`, `Player.queue`):
  - Matrices, Loops och Mods spelar i block av varv. Varje varv är ett eget klipp med seed ur varvets nummer (`passSeed`).
  - Medan ett block spelar renderas nästa. Det köas och tar vid exakt när blocket når sitt slut, och då renderas blocket efter. Round robin räknar vidare över blocken (`blockStart`).
  - En ändring under block b renderar om block b och tar vid som förut, och köar om b+1.
  - Med Loop av spelas första blocket en gång. Song har inga block och låter likadant varje varv.
- **New take** är borta, och med den `replayable` i App. En ändring slår inte om slumpen, eftersom valen kommer ur seeds.
- **🎲-knapparna** (`RerollButton.tsx`) sitter på dessa ställen:
  - I headern mellan Redo och Load (Reroll everything).
  - I Mods bredvid modens namn (Reroll this mod).
  - I Matrices i matrisens rad bredvid Clone (Reroll this matrix) och i padens reglage bredvid namnet (Reroll this pad).
  - I Song på det markerade klippets högra kant (Reroll this clip).

  Muspekaren säger vad knappen slår om och att Undo tar tillbaka det.
- **Specen:** TODO(spec) under Varv i loop är löst och inskriven som Claudes val. Under Slump och seeds står nu hur slumpen räknas, seeds för kloner och gamla projekt, och var 🎲 sitter.

## Klart när

1. **Samma projekt ger samma triggers två gånger, efter Save och Load, och i Export WAV.**
   - `gives the same triggers and tapes every time it is generated` och `after Save and Load (a project file)` (`src/engine/seeds.test.ts`).
   - `in Export WAV: the rendered audio is the same, also after Save and Load` (`src/engine/render.seeds.test.ts`).
   - Projektet i testerna har Random- och No repeat-pads, en mod med Random pitch och Stack, och en Tape med wow och flutter.
2. **Play i Mods på en mod med Random låter olika i varv 1 och 2, och samma serie varv varje gång.**
   - `a mod with Random sounds different in pass 1 and 2, and the same series of passes every time` (`modBlock`, `seeds.test.ts`).
   - Kedjan i appen: `Play in Loops with Loop on renders the next pass …` (`play-what-shows.test.tsx`) och `varv.test.ts`.
3. **🎲 på ett klipp ändrar bara det klippets slump, och Undo tar tillbaka den.**
   - `🎲 on a clip changes only that clip’s randomness, and Undo brings it back` (`seeds.test.ts`).
   - `in Song, on the selected clip …` (`reroll.test.tsx`).
4. **Testerna, typecheck och lint är gröna.** Det är 78 filer och 738 tester, mot 73 filer och 700 tester förut.
   - I Chromium provades alla fem 🎲. Undo/Redo sade "reroll everything", "reroll clip Amen-break 1", "reroll matrix …", "reroll pad 07" och "reroll mod Stutter", och Ctrl+Z ångrade.
   - Play i Matrices spelade i 9 s utan fel i konsolen.
   - Den gamla autosparen utan seeds laddades utan problem.

## Claudes val (inskrivna i specen)

- Hur varven renderas löpande: block, köning vid blockets slut, minst en takt per block, och omrendering av blocket som spelar vid en ändring.
- Hur slumpen räknas ur seeds och plats (listan ovan). Matrisens seed räknas in i padens val.
- No repeat minns sin senaste hit över hela låten, som förut. En kopierad klipps första val kan därför skilja sig från originalets.
- Kloner och kopior av matrix och pad får nya seeds. Ett delat klipp behåller sin seed. Reroll på en matrix byter också matrisens egen seed.
- Gamla projekt får seeds ur id:t.
- Var 🎲 sitter i Matrices och Song, och att Undo namnger rerollen.

## TODO(spec)

Inga nya.

## Att granska och lyssna på

- **Matrices och Loops med en Random-pad.** Lyssna på att varven verkligen slår om, och på att övergången mellan block är sömlös.
  - Bufferten som loopar har svansen från sitt eget slut i början, så reverb och delay över blockgränsen kommer från det nya blocket, inte från det som just spelade. Det borde inte höras.
  - Är maskinen långsam och nästa block inte klart, loopar blocket som spelar en gång till.
- **Mods** spelar nu minst en takt per block. En loop på 1/16 ger alltså 16 varv per block, och med Loop av hörs en takt i stället för ett varv.
- **New example och graferna i Mods** finns kvar (fas 24b tar bort dem). De visar fortfarande ett exempel, inte modens seed.
- **🎲 på klippet i Song** sitter i klippets högra hörn. Det är litet på korta klipp.
- **`blockStart`** genererar alla tidigare block igen när något ändras under ett sent block. Det är billigt (bara triggers) men växer med hur länge man spelat.
