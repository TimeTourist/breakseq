# Fas 24a – teknisk plan

## Model

- `types.ts`: `Mod`, `Matrix`, `Pad`, `Clip` får `readonly seed: number` (heltal 0 ≤ seed < 2³²).
- `command.ts`: `CommandContext.newSeed: () => number`. `defaultContext` tar den ur `crypto.getRandomValues`. `sequentialIds()` i testerna ger 1, 2, 3 …
- Alla ställen som skapar objekten tar en seed ur `ctx.newSeed()`: `emptyPad`, `ensureRows` (chain), `createMatrix`, `createMatrixFrom`, `cloneMatrix`, `padCopy` (kopior och kloner av pads får nya seeds, Claudes val), `createMod`, `addClip`.
  `pasteClip`/`copyClip` behåller klippets seed (specen); när `placeClip` delar ett klipp i två behåller båda halvorna seeden (samma klipp, samma ljud).
- `upgradeProject`: objekt utan seed får `seedOf(id)`, en hash av id:t (ren funktion: samma fil ger samma seeds varje gång den laddas). Claudes val.
- `seed.ts` (model): `seedOf(id: Id): number` (FNV-1a), `isSeed(n)`.
- `reroll.ts` (model), kommandon, ett Undo-steg vardera:
  - `rerollAll()`: nya seeds på alla mods, matriser, pads och klipp.
  - `rerollMod(id)`, `rerollMatrix(id)` (matrisen och dess pads), `rerollPad(id)`, `rerollClip(id)`.

## Engine

- `random.ts`: `mix(...values: number[]): number` (32-bit hash) och `placeRng(...values: number[]): Rng` (mulberry32 seedad med hashen). Ingen `Math.random`.
- Varje slumpval får en egen `placeRng` ur seed och plats, i stället för en `Rng` för hela låten:
  - Pad Random/No repeat: `(PAD, matrix.seed, pad.seed, clip.seed, steg i klippet)`, där klippet är Main- eller Fill-klippet steget spelas i och steg i klippet är `t − clip.start + clip.offset`. Ett kopierat klipp med samma seed väljer alltså samma.
  - Mods (formen Random): `(MOD, mod.seed, clip.seed, mål, intervall)`.
  - Swap Stack: `(STACK, mod.seed, clip.seed, intervall)`; Shuffle: `(SHUFFLE, mod.seed, clip.seed)`.
  - Tape wow/flutter: `(TAPE, mod.seed, clip.seed, fönstrets start i klippet)`.
- `pad-choice.ts`: `padPicker(from?: PickState)` ger `{ pick(pad, rng), state() }`. Round robin och No repeats "förra" räknas per pad som förut; `PickState = { turns, last }` (vanliga records) så att ett varv kan börja där det förra slutade.
- `generate.ts`: `generateTake(project, from?: PickState): Take` där `Take` får `end: PickState`. `generateTriggers(project, from?)`.
- Varv (`preview.ts`): ett *block* är ett antal hela varv som renderas till en buffer. Varje varv är ett eget klipp vars seed räknas ur varvets nummer (`passSeed(n)`), så varv 1, 2, 3 … låter olika och samma seeds ger samma serie.
  - `loopSong(project, loopId, passes = 1, firstPass = 0)`.
  - `blockPasses(project, steps, picks)`: som `previewPasses` för Loops och Matrices, minst så många varv att blocket är minst en takt (Claudes val), högst 32 takter.
  - `matrixBlock(project, matrixId, block)`, `loopBlock(project, loopId, block)`, `modBlock(project, modId, loopId, block)`: projektet som spelar block nummer `block`. Mods får ett modklipp per varv.
  - `blockStart(blocks: (b) => Project, block): PickState`: genererar block 0 … block−1 (bara triggers, billigt) och ger var Round robin och No repeat står när blocket börjar.

## UI

- `services.renderSong(project, options?: { signal?, from? })`: ingen rng. `Services.rng` finns kvar för klick i Matrices (ett val av en pad), som inte är låtens ljud.
- `subject.ts`: Matrices, Loops och Mods får `blocks: (block) => Project`; `project = blocks(0)`.
- `App.tsx`: `replayable` och New take bort (en ändring slår inte om slumpen: valen kommer ur seeds).
- `playback.ts`: `Player.queue(take | null, onStart?)`: tar vid när det som spelar når slutet av sin buffer (källan slutar loopa där); `null` tar bort det köade. `play`, `stop`, `seek`, `replace` och `setLoop` tar bort det köade först.
- `varv.ts`: `createVarv({ render, player })` med `start(blocks, key)`, `update(blocks)` och `stop()`: när block b börjar spela renderas block b+1 och köas. Ändras något medan block b > 0 spelar renderas block b om och tar vid (som en ändring gör idag), och b+1 köas om. Med Loop av spelas block 0 en gång, som förut.
- 🎲-knappar (`RerollButton`): headern mellan Redo och Load (aria Reroll everything), Mods bredvid modens namn, Matrices på matrisen och den valda paden, Song på det markerade klippet. `title` säger vad den slår om och att Undo tar tillbaka det.
- New take i Song tas bort.

## Tester (Vitest, bredvid koden)

- model: nya objekt får seeds ur `ctx.newSeed`; kopierat klipp behåller seed; klonad matrix/pad får nya; `upgradeProject` ger seeds åt objekt utan; varje reroll-kommando byter bara sina seeds och går att ångra.
- engine: samma projekt ger samma triggers två gånger, efter `writeProjectFile`/`readProjectFile` och i en render (export); Random på pad, mod, Stack, Shuffle och wow/flutter ändras när rätt seed ändras och bara då; 🎲 på ett klipp ändrar bara det klippets triggers; `modBlock` block 0 och 1 skiljer sig och samma block ger samma triggers; Round robin fortsätter över block (`blockStart`); en ändring i en pad behåller valen i en annan.
- ui: playback `queue`; varv-kontrollern köar nästa block och renderar om vid ändring; 🎲-knapparna gör rätt kommando och Undo tar tillbaka; New take finns inte.
