# Fas 22 – Matrix: implementationsplan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Byt Break och one-shot mot en enda modell, Sample → Hit → Pad → Matrix, med config i tre lager och drag som ger kopior, utan att appen slutar fungera.

**Architecture:** Slicingen (takter, markörer) flyttar från Break till Sample. En hit pekar på `sampleId` + `slice`. Pads ägs av exakt en Matrix, och en hit av exakt en Pad. Config-lagren hit → pad → matrix läggs ihop i model-lagret (`effectiveHit`, `hitStretch`, `hitColour`, `hitSpace` behåller sina signaturer `(project, hit)`), så motorn ändras nästan inte. Gränssnittet ändras bara så mycket att allt går att använda; det nya gränssnittet är fas 23.

**Tech Stack:** TypeScript strict, React, Vitest, Vite.

**Spec:** `docs/tasks/fas-22.md` (besluten 1–17 och förslagen där är kraven). `docs/spec.md` och `CLAUDE.md` gäller i övrigt.

## Global Constraints

- Arbeta på grenen `fas-22-matrix`. Läget före fasen finns i taggen `fas-21-fore-matrix`.
- Lagren: `src/ui` → `src/engine` → `src/model`; ett lager importerar bara nedåt. `src/engine/generate*` utan DOM, React och Web Audio.
- Slump bara via injicerad `Rng`. State immutable; varje ändring är ett `Command` som går att ångra. Nya objekt får `ctx.newId()`.
- Domänord i kod: `Sample`, `Hit`, `Pad`, `Matrix`, `Loop`, `Mod`, `Song`, `Trigger`. Ordet `Break` försvinner ur typer och funktionsnamn; "break" och "one-shot" finns bara som klassificering (`matrixKind`) och i text.
- Gränssnittets text är på engelska, som i dag.
- Tester bredvid koden (`*.test.ts`), ett test per beteende. Befintliga tester skrivs om till den nya modellen, inte raderas, om beteendet finns kvar.
- Typbytet i Task 1 gör att `npm run typecheck` är rött i filer som senare tasks äger. Varje task kör sina egna tester med sökvägsfilter (`npx vitest run src/model/…`). Från Task 7 och framåt ska `npm run typecheck`, `npm run lint` och `npm test` vara gröna.
- Gamla projekt behöver inte öppnas (beslut 10). All uppgraderingskod för äldre format tas bort.

## Review Focus

1. **Autosparat projekt från fas 21** i webbläsaren första gången efter deploy: appen öppnar ett tomt projekt i stället för att krascha, och säkerhetskopiorna lämnas orörda. → test i Task 6.
2. **Tom pad eller tom matrix** i en loop, i en utläggning eller i hyllan: den tar 0 steg i en utläggning, spelar inget och kraschar inte. → test i Task 2.
3. **En hit vars slice ligger bortom samplets sista markör** (efter Nej i dialogen eller färre markörer): tyst i generate, render, MIDI och REX, utan undantag. → test i Task 5.
4. **Att ta bort en trim** som har kopior i andra matriser: kopiorna går, deras pads blir kvar tomma, och steg som låst en borttagen hit faller tillbaka på medlem 1. → test i Task 4.
5. **Ny trim i dialogen** när filen redan har flera trimmar: den nya trimmen får nästa lediga nummer (max + 1), och namnen krockar inte. → test i Task 4.

---

### Task 1: Typerna och config-lagren

**Files:**
- Modify: `src/model/types.ts`
- Create: `src/model/owners.ts`, `src/model/owners.test.ts`
- Modify: `src/model/breaks.ts` → döp om till `src/model/sound.ts` (lagren, `hitSound`, stretch, dist/filter, reverb/delay); `src/model/breaks.test.ts` → `src/model/sound.test.ts`
- Modify: `src/model/index.ts`

**Interfaces:**
- Produces (types.ts):
  ```ts
  /** What a hit has for itself, and its pad and matrix have for all under them. */
  export interface Config {
    readonly direction: Direction; readonly pitch: number; readonly volume: number; readonly pan: number;
    readonly fadeOut: number; readonly stretch: HitStretch; readonly dist: HitDist; readonly filter: HitFilter;
    readonly reverb: HitReverb; readonly delay: HitDelay;
  }
  export const NO_CONFIG: Config; // forward, 0, 0, 0, 0, NO_STRETCH, NO_DIST, NO_FILTER, NO_REVERB, NO_DELAY

  export interface Sample { /* fälten som i dag, plus: */
    /** Length in bars, giving its tempo; null when it is not sliced. */
    readonly bars: number | null;
    /** Where slices start, parts 0–1, sorted, the first at 0. [0] when not sliced. */
    readonly markers: readonly number[];
    /** Marked to be sliced in Import but not sliced yet. */
    readonly unsliced?: true;
  }
  export interface Hit extends Config {
    readonly id: Id; readonly name: string;
    readonly sampleId: Id;
    /** The slice it plays, from 0; null for the whole sample. Past the last marker it is silent. */
    readonly slice: number | null;
    readonly region: Region;
    readonly variantOf: Id | null;
  }
  export interface Pad { readonly id: Id; readonly name: string; readonly members: readonly Id[]; readonly choice: PadChoice; readonly config: Config }
  export interface Matrix {
    readonly id: Id; readonly name: string;
    /** Its pads in order (y); each pad belongs to this matrix only. */
    readonly pads: readonly Id[];
    readonly config: Config;
    /** The sample it was made from: its rows follow that sample's slicing. null for one built by hand or copied. */
    readonly sampleId: Id | null;
    /** The loop the slicing made, or null. */
    readonly loop: Id | null;
  }
  export interface Project { audio; samples; matrices: Readonly<Record<Id, Matrix>>; hits; pads; loops; mods; song } // breaks går
  ```
  `Pad.auto`, `Break`, `Hit.breakId`, `Hit.slot` tas bort. `UsageKind` får `'matrix'` i stället för `'break'`.
- Produces (owners.ts):
  ```ts
  export function padOfHit(project: Project, hitId: Id): Pad | undefined;
  export function matrixOfPad(project: Project, padId: Id): Matrix | undefined;
  export function matrixKind(matrix: Matrix): 'break' | 'one-shot'; // > 1 pad: break
  export function sampleBpm(sample: Sample): number | null;          // ersätter bpmOf
  ```
  Uppslagen memoiseras per `project.pads` och `project.matrices` med `WeakMap`, så att ett uppslag per trigger i generate är O(1).
- Produces (sound.ts), samma signaturer som i dag: `hitSound`, `effectiveHit`, `hitStretch`, `hitColour`, `hitSpace`, `sliceWindow(sample: Sample, slice: number | null): Region | null`, `slotStep`, `slotHit(id, name, sampleId, slice): Hit`, `slotName`.

- [ ] **Step 1: Skriv de fallerande testerna** i `sound.test.ts` och `owners.test.ts`. Bygg projekt för hand med en hjälpare `project({ samples, matrices, pads, hits })` i testfilen.
  - `effectiveHit adds pitch, volume and pan from pad and matrix`: hit 1 st, pad 2 st, matrix 3 st → `pitch === 6`; samma för volume och pan.
  - `each reverse layer flips the direction`: hit reverse + pad reverse → `forward`; plus matrix reverse → `reverse`.
  - `fade, dist, filter, reverb and delay come from the nearest layer that has one`: hit fade 0, pad 0, matrix 40 → 40; hit dist off, pad crush → crush; matrix reverb amount 0.3 med hit 0 → 0.3.
  - `fit to tempo counts once`: sample 4 takter som ger 136 BPM, song 170, hit fit, pad fit, matrix factor 2 → `factor ≈ (136/170) * 2`.
  - `fit takes the tempo of the hit's sample, not the matrix's`: en hit på ett sample i 136 BPM i en matrix vars eget sample är 170 BPM → faktor 136/170.
  - `a hit follows the layers where it lives`: samma hit-fält i två olika pads/matriser ger olika `effectiveHit`.
  - `hitSound plays a slice of the sample` och `a slice past the last marker is silent` (→ `null`).
  - `matrixKind: one pad is a one-shot, more is a break`.
- [ ] **Step 2:** `npx vitest run src/model/sound.test.ts src/model/owners.test.ts` → FAIL.
- [ ] **Step 3: Implementera.** Lägg lagren som en vikning över `[hit, pad?.config, matrix?.config]` med reglerna i dag: pitch, volym och pan adderas; varje reverse vänder; fade, dist, filter, reverb och delay tas från det närmaste lagret som har något (fade > 0, läge ≠ off, amount > 0); faktorer multipliceras och Fit to tempo räknas högst en gång; grain och from från det närmaste lagret som har dem, annars `DEFAULT_GRAIN` och `'break'`. Ta bort `parentHit`, `isParentHit`, `isParentPad`, `padSlot`, `slotHeard`, `ensureSlots`, `breakSequence` (de ersätts i Task 2).
- [ ] **Step 4:** samma kommando → PASS.
- [ ] **Step 5: Commit** `Fas 22: Sample, Hit, Pad and Matrix types with config in three layers`.

### Task 2: Längder och utläggning

**Files:**
- Modify: `src/model/lengths.ts`, `src/model/lengths.test.ts`
- Move from `src/ui/labels.ts`: `hitSteps`, `padSteps` (labels importerar dem sedan från model)

**Interfaces:**
- Consumes: Task 1.
- Produces:
  ```ts
  /** Steps a hit takes when laid out: a slice from where it lands on its sample's grid to the next slice that lands later; 0 for a slice that lands on the same step as the one before it, or a silent one; anything else its sound in the song's tempo, rounded up. */
  export function hitSteps(project: Project, hit: Hit): number;
  /** Those of its first hit; 0 for an empty pad. */
  export function padSteps(project: Project, pad: Pad): number;
  /** The matrix's pads one after another (beslut 15), skipping pads of 0 steps. */
  export function matrixSequence(project: Project, matrixId: Id): { padId: Id; step: number; length: number }[];
  export function matrixSteps(project: Project, matrixId: Id): number; // summan
  ```
  Hyllan i UI visar `Math.max(1, padSteps(...))` för en enskild pad, som i dag.

- [ ] **Step 1: Fallerande tester:**
  - `lays pads out one after another by their first hit` (beslut 15): tre pads med första hits på 2, 2 och 4 steg → `[{step:0,length:2},{step:2,length:2},{step:4,length:4}]`.
  - `a sliced sample lays out as today`: Amen 4 takter, 1/16-grid → 64 pads på steg 0…63, `matrixSteps === 64`.
  - `two slices on one step: only the first comes along`: markörer som hamnar på samma steg → den andra har längd 0 och saknas i sekvensen.
  - `removing a pad moves everything after it forward`.
  - `an empty pad and an empty matrix take no steps` (Review Focus 2): `padSteps === 0`, `matrixSequence === []`.
- [ ] **Step 2:** `npx vitest run src/model/lengths.test.ts` → FAIL.
- [ ] **Step 3: Implementera** i `lengths.ts`.
- [ ] **Step 4:** → PASS.
- [ ] **Step 5: Commit** `Fas 22: a matrix lays out pad after pad`.

### Task 3: Import, slicing och den automatiska kedjan

**Files:**
- Modify: `src/model/chain.ts`, `src/model/chain.test.ts` (och de delar av `model.test.ts` som gäller kedjan)
- Delete: `src/model/upgrade-breaks.ts`

**Interfaces:**
- Consumes: Task 1, 2.
- Produces (ersätter break-kommandona; nyckeln är `sampleId` där slicingen gäller):
  ```ts
  export const addSample: (file: NewSample) => Command;          // Sample (bars null, markers [0]) + Matrix med en pad och en hit (slice 0)
  export const addTrim: (sampleId: Id, window?: {offset:number;duration:number}) => Command;
  export const markUnsliced: (sampleId: Id) => Command;          // dagens markBreak
  export const setSlicing: (sampleId: Id, bars: number | null, markers?: readonly number[]) => Command; // dagens setBreak
  export const setSampleBars: (sampleId: Id, bars: number) => Command;
  export const setMarkers: (sampleId: Id, markers: readonly number[], newTrim?: boolean) => Command;
  export const setGrid: (sampleId: Id, grid: SliceGrid, newTrim?: boolean) => Command;
  export const sliceSample: (sampleId: Id, bars: number, grid?: SliceGrid) => Command;
  export const renameMatrix: (matrixId: Id, name: string) => Command;
  export const makeOneShot: (sampleId: Id, slice: number) => Command; // dagens sliceToOneShot: ny trim över slicen + en one-shot-matrix
  export const setHitSource: (hitId: Id, sampleId: Id, slice: number | null) => Command;
  export function ownMatrix(project: Project, sampleId: Id): Matrix | undefined; // matrisen med sampleId
  export interface Renumber { readonly slices: readonly number[]; readonly pads: readonly Id[] }
  /** Beslut 14: null när ändringen inte byter numrering eller ingen berörd slice spelas av mer än en hit. */
  export function renumberConflict(project: Project, sampleId: Id, markers: readonly number[]): Renumber | null;
  ```
  Tas bort: `replaceSample`, `replaceSampleWithFile` (beslut 11), `setBreak`, `setBreakBars`, `sliceBreak`, `markBreak`, `sliceToOneShot`, `renameBreak`, `fileBreaks` → `fileSamples`.

- [ ] **Step 1: Fallerande tester:**
  - `a new file is a sample and a one-shot matrix`: ett sample med `markers [0]`, en matrix med `sampleId`, en pad, en hit med `slice 0`.
  - `slicing makes the own matrix one pad per slice and a loop the first time`: 64 pads, loopen heter som filen, `matrix.loop` satt.
  - `slicing a one-shot keeps pad 01 as the first slice row`.
  - `moving a marker changes the sound of every hit of that slice, copies too` (beslut 13): en kopia i en annan matrix får nytt `hitSound`.
  - `more slices give the own matrix new pads; fewer leave the last silent`.
  - `the automatic loop follows until edited by hand` (beslut 17) och `other loops stay as laid out`.
  - `renumberConflict` : `null` när en markör bara flyttas; `null` när markörer läggs till men varje berörd slice spelas av en hit; `{ slices:[6,8], pads:[…] }` när slice 07 och 09 har en variant eller kopia någonstans; varianter i samma matrix räknas (q4).
  - `newTrim moves the edited matrix and its hits to a new trim, copies stay on the old` (beslut 16): gamla samplet har gamla markörer, nya samplet nya; kopian i *Snares* spelar oförändrat.
  - `a new trim gets the next free number of its file` (Review Focus 5): fil med trim 1 och 3 → ny trim 4, namnet `amen trim 4`.
  - `without newTrim, slices count by number` (Nej i dialogen).
- [ ] **Step 2:** `npx vitest run src/model/chain.test.ts` → FAIL.
- [ ] **Step 3: Implementera.** Flytta `bars`, `markers`, `cues` och `unsliced` till samplet. `ensureRows(project, matrixId, count, newId)` ersätter `ensureSlots` och gäller bara `ownMatrix`. `followLoop` jämför loopen mot `matrixSequence` före ändringen. Berörda slicer i `renumberConflict`: när antalet markörer ändras, alla slicer från första index där gamla och nya markörer skiljer sig till gamla sista; en slice är använd när mer än en hit har `(sampleId, slice)`; `pads` är padsen som innehåller de hitsen.
- [ ] **Step 4:** → PASS.
- [ ] **Step 5: Commit** `Fas 22: slicing lives on the sample; a new trim when numbering would change`.

### Task 4: Pads, matriser, kopior, borttagning och loopar

**Files:**
- Modify: `src/model/commands.ts`, `src/model/references.ts`, `src/model/chain.ts` (borttagning, klon, swap) och deras tester

**Interfaces:**
- Consumes: Task 1–3.
- Produces:
  ```ts
  export const createMatrix: (name: string) => Command;              // en tom pad, sampleId null
  export const addPad: (matrixId: Id) => Command;                    // tom pad sist, namn "<matrix> NN"
  export const movePad: (matrixId: Id, padId: Id, to: number) => Command;
  export const setPadConfig: (padId: Id, patch: Partial<Config>) => Command;
  export const setMatrixConfig: (matrixId: Id, patch: Partial<Config>) => Command;
  export const copyHits: (hitIds: readonly Id[], toPadId: Id) => Command;          // beslut 8: nya hits, bara hittens egna fält, variantOf null
  export const copyPad: (padId: Id, toMatrixId: Id) => Command;                     // ny pad sist med choice och config
  export const copyMatrix: (fromId: Id, to: { matrixId: Id } | { padId: Id }) => Command; // till matrix: copyPad per pad; till pad: alla hits sist
  export const cloneMatrix: (matrixId: Id) => Command;              // "<name> copy", sampleId null, ingen loop
  export const placeMatrix: (loopId: Id, matrixId: Id, at: number) => Command;   // ersätter placeBreak; skriver över matrixSteps steg
  export const swapMatrix: (loopId: Id, fromId: Id, toId: Id) => Command;        // rad N mot rad N; saknas rad N blir steget tomt
  export function loopMatrices(project: Project, loop: Loop): Matrix[];
  export const removeSample: (sampleId: Id) => Command;  // med usages; tar hits som spelar samplet överallt och dess ownMatrix
  ```
  `addVariant` lägger varianten sist i samma pad som originalet (via `padOfHit`). `addPadMember` tas bort; allt som läggs till en pad är kopior. `remove('pad')` tar också bort paden ur sin matrix. `remove('matrix')` tar matrisens pads och hits men inte dess loop eller samples (beslut 9). `removeFile` och `removeSample` frågar via usages som i dag.

- [ ] **Step 1: Fallerande tester:**
  - `copying a matrix with five hits to pad 02 adds five new hits last` och `changing a copy leaves the original, and the other way round`.
  - `a copy takes only the hit's own config` (pad pitch +3 i källan följer inte med).
  - `copying a matrix to a matrix adds its pads last with their choice and config`.
  - `a variant goes last in the original's pad`.
  - `removing a matrix keeps its loop and samples`.
  - `removing a trim removes its hits everywhere; their pads stay empty and steps locked to them fall back to member 1` (Review Focus 4).
  - `placing a matrix lays its pads out from the step and empties the rest of its length`.
  - `swapping matrices maps row N to row N`.
- [ ] **Step 2:** `npx vitest run src/model` → de nya testerna FAIL.
- [ ] **Step 3: Implementera.**
- [ ] **Step 4:** `npx vitest run src/model` → PASS.
- [ ] **Step 5: Commit** `Fas 22: copies, pads and matrices as commands`.

### Task 5: Motorn

**Files:**
- Modify: `src/engine/generate.ts`, `render.ts`, `midi.ts`, `rex.ts`, `preview.ts`, `swap.ts`, `render-slices.ts` och deras tester

**Interfaces:**
- Consumes: Task 1–4 (`effectiveHit`, `hitStretch`, `hitColour`, `hitSpace`, `hitSound`, `matrixSequence`).
- Produces: `matrixSong(project, matrixId): Project` (ersätter `breakSong`). MIDI ordnar noter efter samplets ordning i `project.samples` och sedan `slice` (ersätter `breakId`/`slot`).

- [ ] **Step 1: Fallerande tester:**
  - `generate applies the pad's and matrix's layers` (en trigger med pad pitch + matrix volume).
  - `a hit past the last slice is silent in generate, render, MIDI and REX` (Review Focus 3).
  - `matrixSong plays a matrix as it lays out`.
- [ ] **Step 2:** `npx vitest run src/engine` → FAIL.
- [ ] **Step 3: Implementera.** Skriv om befintliga engine-tester till nya fixtures; beteendet ska vara detsamma.
- [ ] **Step 4:** `npx vitest run src/engine` → PASS.
- [ ] **Step 5: Commit** `Fas 22: the engine plays matrices`.

### Task 6: Lagring

**Files:**
- Modify: `src/model/project.ts` (`createProject`, `upgradeProject`), `src/engine/project-file.ts`, `src/engine/project-folder.ts`, `src/ui/persist.ts`, `src/ui/backups.ts` och tester

**Interfaces:**
- Produces: `upgradeProject(saved: unknown): Project | null`; `null` när `matrices` saknas. All äldre uppgraderingskod tas bort.

- [ ] **Step 1: Fallerande tester:**
  - `an autosave from before Matrix opens an empty project and leaves the backups` (Review Focus 1).
  - `a project file from before Matrix is refused with a message`: felet säger `This project was made before Matrix (phase 22). Open it in the tag fas-21-fore-matrix.`
  - `a project round-trips through the file and the folder` (befintliga tester, nya fixtures).
- [ ] **Step 2–4:** `npx vitest run src/engine/project src/ui/persist src/ui/backups src/ui/autosave` → FAIL, implementera, PASS.
- [ ] **Step 5: Commit** `Fas 22: projects from before Matrix are not opened`.

### Task 7: Gränssnittet (minimalt)

**Files:**
- Modify: `src/ui/HitsView.tsx`, `LoopsView.tsx`, `ImportView.tsx`, `SliceView.tsx`, `labels.ts`, `store.ts`, `subject.ts`, `describeChange.ts`, `BreakOrigin.tsx` → `MatrixOrigin.tsx`, `DeleteBreak.tsx` → `DeleteMatrix.tsx`, `DeleteButton.tsx`, `InSong.tsx` och UI-testerna (`phase*.test.tsx`, `pad-choice`, `shelf-choice`, `slice-lines`, `unsliced`, `stretch`, `pan`, `colour`, `lengths`, `export`, `project`)

**Interfaces:**
- Consumes: alla kommandon och frågor från Task 1–4.
- Produces: inga nya publika gränssnitt.

Beteende (förslagen i `fas-22.md`):
- **Hits:** sidomenyn grupperar per matrix med en ikon för break eller one-shot (`matrixKind`). `+ New matrix` ersätter `+ New pad`. Matrisens rad ersätter föräldern: dess editor har samma reglage som hitten utom region, och för en matrix med `sampleId` vågformen med slicelinjer och länkarna `← Trim` och `← Slice` (Plays och Replace with file tas bort). Padens panel får en hopfällbar `Pad sound` med samma reglage, samt `+ Pad` och borttagning av pad. Drag av en hit, pad eller matrix till en pad eller matrix, och `+ Hit`-listan, använder `copyHits`, `copyPad` och `copyMatrix`. `Replace…` på hitten väljer sample och slice.
- **Loops:** hyllan och Show in Pads grupperar per matrix; matriser med en pad under `One-shots`. Dra en matrix → `placeMatrix`. `Matrix: Amen → Think` → `swapMatrix`.
- **Import:** typvalet heter `Slice` / `Don't slice`; Delete på en trim använder `removeSample`.
- **Slice:** arbetar på `sampleId`. Innan `setMarkers`, `setGrid` eller `setSampleBars` körs frågar vyn `renumberConflict`; finns en konflikt visas en dialog i appens stil: `You use slice 07, 09 in: pad 2 and pad 3. Make a new trim and sample for this?` med knapparna `New trim` (kör med `newTrim: true`) och `Renumber` (kör utan), och Escape avbryter.

- [ ] **Step 1: Skriv om UI-testerna** till den nya modellen och lägg till: `the renumber dialog offers New trim and Renumber`, `dropping a matrix on a pad adds copies`, `a matrix shows a break icon with more than one pad`, `the pad's sound sliders change every hit of the pad`.
- [ ] **Step 2:** `npm test` → FAIL i UI.
- [ ] **Step 3: Implementera.**
- [ ] **Step 4:** `npm run typecheck && npm run lint && npm test` → allt grönt.
- [ ] **Step 5: Verifiera i en riktig webbläsare** (`npm run dev`, Playwright): ladda `samples/Amen-break.wav`, slica 4 takter 1/16, gör *Snares* med `+ New matrix`, dra en hit dit, dra *Snares* till pad 07 (fyra kopior), sätt Round robin, och flytta en markör så att dialogen visas. Drag och släpp verifieras med riktigt drag (`browser_drag`), inte happy-dom.
- [ ] **Step 6: Commit** `Fas 22: the GUI shows matrices`.

### Task 8: Spec, ordlista och sammanfattning

**Files:**
- Modify: `docs/spec.md` (Datamodell, Pipeline och vyer, Data, fasraden för 22), `CLAUDE.md` (Domänord: `Sample`, `Hit`, `Pad`, `Matrix`, `Loop`, `Mod`, `Song`, `Trigger`; Aktuell fas)
- Create: `docs/tasks/fas-22-sammanfattning.md`

- [ ] **Step 1:** Skriv om specens text om Break, one-shot, förälder och "en hit kan ingå i flera pads" efter besluten 1–17. Ta bort texten om Plays och Replace with file.
- [ ] **Step 2:** Gå igenom "Klart när" i `fas-22.md` punkt för punkt och skriv i sammanfattningen hur var och en är uppfylld, vilka `TODO(spec)` som finns och vad som bör granskas.
- [ ] **Step 3:** `npm run typecheck && npm run lint && npm test` → grönt.
- [ ] **Step 4: Commit** `Fas 22: spec, glossary and summary`.
