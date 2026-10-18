# Fas 23 – Gränssnitt för matriser: implementationsplan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ersätt Import, Slice och Hits med Samples och en Pads-sida med tidslinje, fokus och Take from, rätta modellbuggarna från sorteringen, och låt Loops dela fokus.

**Architecture:** Modellbuggar och två nya kommandon först (Task 1–2), sedan appens skal med fokus i store (Task 3), sedan vyerna en i taget (Task 4–8), till sist städning, checklistan och spec (Task 9–10). Befintliga delar återanvänds: vågform, slicelinjer, RegionHandle, reglagen (`configPanels` i HitsView), RenumberDialog, DeleteButton, dnd-hjälparna.

**Tech Stack:** TypeScript strict, React, Vitest, Vite, Playwright för webbläsarkollen.

**Spec:** `docs/tasks/fas-23.md` (beslut 1–16 och förslagen). Sorteringen `docs/tasks/fas-23-sortering.md` (M1–M5, U1–U20) är en del av kraven. `docs/spec.md` och `CLAUDE.md` gäller i övrigt.

## Global Constraints

- Arbeta på grenen `fas-23-gui`. Från Task 3 och framåt ska `npm run typecheck`, `npm run lint` och `npm test` vara gröna efter varje task.
- Lagren: `src/ui` → `src/engine` → `src/model`. Varje ändring av projektet är ett `Command` som går att ångra; fokus och Take from är vyns state i store, inte projektet (beslut 16).
- Gränssnittets text är engelska. Domänord: `Sample`, `Hit`, `Pad`, `Matrix`, `Loop`, `Mod`, `Song`, `Trigger`. "break" och "one-shot" bara som klassificering (ikon/etikett), aldrig som namn på ett objekt eller en knapp.
- Flikarna heter exakt `Samples`, `Pads`, `Loops`, `Mods`, `Song`, `Project`, med tangenterna 1–6.
- Drag och släpp verifieras i en riktig webbläsare (Playwright `browser_drag`), inte bara i happy-dom.
- Vite/Vitest körs aldrig med `--root`.

## Review Focus

1. **Ersätta första hitten i en pad** ändrar padens längd: padsen efter flyttas i tidslinjen och i matrisens utläggning, och låsta steg följer kopian (beslut 12). → test i Task 2.
2. **64 pads i Fit-zoom** på en smal skärm (400 px): sidan scrollar inte i sidled, tidslinjen scrollar i sin egen ruta, och numren går att läsa. → test i Task 5.
3. **Drag till ett mål utanför synfältet** (U4): tidslinjen och hyllan scrollar under draget. → test i Task 6 (logiken) och webbläsarkollen i Task 9.
4. **Fokus på en matrix som tas bort** (U15): fokus flyttar till ingen eller nästa matrix, och Pads visar ett tomt läge med en länk till Samples, utan att öppna en pad i en annan matrix. → test i Task 3.
5. **Tangenter när en kryssruta eller ett reglage har fokus** (U2): 1–6, mellanslag och Ctrl+Z fungerar; bara textfält och nummerfält räknas som skrivande. → test i Task 3.

---

### Task 1: Modellbuggar från sorteringen (M1–M5)

**Files:** `src/model/chain.ts`, `src/model/commands.ts`, `src/model/sound.ts`, `src/engine/midi.ts`, deras tester.

Rulings (beslutade av controllern, bygger på fas 22:s beslut 12 och 17 och specens MIDI-text):
- **M1:** matrisens automatiska loop följer *alla* ändringar av matrisen (pads tillagda, kopierade, flyttade, borttagna, ersatta hits) så länge loopen är exakt som matrisen lade ut den före ändringen; när man ändrat i loopen själv rörs den aldrig. Gör följandet till en del av varje kommando som ändrar en matrix med en `loop` (en hjälpare `followMatrix(before, after, matrixId)`).
- **M2:** en pads rad är dess plats i matrisen. Nya pads (`addPad`, `copyPad`, `copyMatrix` till matrix, kopior från `createMatrixFrom`) får namnet `<matrix> NN` efter sin rad. Flyttas eller tas en pad bort döps padsen i matrisen om till sina nya rader **om** de har ett sådant automatiskt namn (namn man skrivit själv rörs inte). Hits behåller sina namn.
- **M3:** `baseName` tar bort `.rx2` också.
- **M4:** en bit i MIDI/REX-exporten är ett unikt ljud: nyckeln är samplet, slicen, regionen och de spelade inställningarna (det `effectiveHit`/`hitStretch`/`hitColour` ger, plus mods), inte hit-id. Två kopior med samma ljud blir en bit och en not.
- **M5:** `setHitSource` till ett annat sample nollställer `variantOf`; när en hit tas bort nollställs `variantOf` på hits som pekade på den.

- [ ] **Step 1: Fallerande tester:** `the automatic loop follows a copied pad while untouched` (M1, sorteringens fall), `a hand-edited loop stays after a matrix change`, `pads are named after their row and renamed when a row moves, unless named by hand` (M2), `an .rx2 file's matrix is named without the extension` (M3), `two copies with the same sound are one bit` och `copies with different pitch are two bits` (M4), `a hit replaced to another sample is no longer a variant` och `removing the original clears its variants` (M5).
- [ ] **Step 2:** `npx vitest run src/model src/engine/midi` → FAIL.
- [ ] **Step 3: Implementera.**
- [ ] **Step 4:** → PASS, och `npm test` grönt.
- [ ] **Step 5: Commit** `Fas 23: model fixes from the sorting (M1–M5)`.

### Task 2: Kommandon för Pads (ersätt, ny matrix av hits)

**Files:** `src/model/commands.ts`, `src/model/matrix.test.ts` (eller ny `src/model/pads.test.ts`).

**Interfaces — Produces:**
```ts
/** Beslut 12: a copy of `sourceHitId` takes `targetHitId`'s place in its pad; steps locked to the target lock the copy; the target goes. One undo step. */
export const replaceHit: (targetHitId: Id, sourceHitId: Id) => Command;
/** Beslut 15: a new matrix with one pad holding copies of the given hits (each with its own settings), choice Round robin when more than one. */
export const createMatrixFrom: (name: string, hitIds: readonly Id[]) => Command;
```
Ersätta en hit med sig själv är ett fel (`invalid`). `movePadMember` finns och används för att flytta inom en pad (beslut 13).

- [ ] **Step 1: Fallerande tester:** `replacing a hit puts the copy in its place and keeps step locks on it`, `replacing the first hit changes the pad's length and moves the pads after it` (Review Focus 1), `replacing is one undo step`, `a hit cannot replace itself`, `a new matrix from four hits is one pad of four copies on Round robin`, `a new matrix from one hit is a one-shot on Top`.
- [ ] **Step 2–4:** FAIL → implementera → PASS.
- [ ] **Step 5: Commit** `Fas 23: replaceHit and createMatrixFrom`.

### Task 3: Appens skal: flikar, fokus, tangenter

**Files:** `src/ui/App.tsx`, `src/ui/Header.tsx`, `src/ui/store.ts`, `src/ui/subject.ts`, `src/ui/browserHistory.ts`, `src/ui/context.ts` och tester.

- Flikarna `Samples`, `Pads`, `Loops`, `Mods`, `Song`, `Project` (1–6). Tills Task 4–5 är klara får `Samples` och `Pads` visa de gamla vyerna (Import ovanför Slice i Samples; Hits i Pads), så att appen alltid fungerar.
- Store: `focus: { matrix: Id | null; takeFrom: readonly Id[] }`, med åtgärderna `focus` och `takeFrom` (lägg till/ta bort). Saknas fokusmatrisen i projektet (borttagen, ångrad) blir fokus `null` (Review Focus 4, U15). Take from rensas på borttagna matriser.
- `isTyping` räknar bara textfält, sökfält och nummerfält (och textarea, contentEditable), inte kryssrutor, radioknappar eller reglage (U2, Review Focus 5).
- Back/Forward mellan flikar fungerar med de nya namnen.

- [ ] **Step 1: Fallerande tester:** `the tabs are Samples, Pads, Loops, Mods, Song, Project on keys 1–6`, `keys work when a checkbox or slider has focus`, `focus on a removed matrix becomes none`, `take from drops removed matrices`.
- [ ] **Step 2–4:** FAIL → implementera → PASS; gate grön.
- [ ] **Step 5: Commit** `Fas 23: tabs Samples and Pads, focus in the store`.

### Task 4: Samples

**Files:** Create `src/ui/SamplesView.tsx` (och delkomponenter), återanvänd ur `ImportView.tsx`, `SliceView.tsx`, `TrimEditor.tsx`, `RenumberDialog.tsx`; tester.

Beteende (beslut 2, 14): filtabellen överst (som Import), den valda trimmens vågform med slicing under (som Slice), på samma sida. Trimmens vågform med numrerade slicelinjer finns här (flyttad från Hits förälder). WAV, AIFF och REX2 dras in här. Länken till Pads öppnar trimmens matrix i fokus.
Checklista som ska klaras: **U1** (Enter i Bars visar dialogen; dialogen tar inte fokus så att en efterföljande blur gör något), **U5** (alla trims listas, osliced med "not sliced"), **U6** (valt sätt att slica följer markörerna och ångra; Transients visar inte "own markers"), **U7** (trimmens ▶ och Play i headern är samma uppspelning: den ena stoppar den andra), **U12** (Creates räknar matrisens pads och hits), **U13** för Samples (knappen "Make one-shot" heter "New matrix from slice"), **U19** (Delete trim på filens sista trim säger att filen går med).

- [ ] **Step 1: Tester** för varje U-punkt ovan, och `importing and slicing Amen happens in one tab`.
- [ ] **Step 2–4:** FAIL → implementera → PASS; gate grön.
- [ ] **Step 5: Commit** `Fas 23: Samples`.

### Task 5: Pads: fokus, tidslinje och reglage

**Files:** Create `src/ui/PadsView.tsx` och delkomponenter (t.ex. `FocusBar.tsx`, `Timeline.tsx`, `ControlsPanel.tsx`); återanvänd reglagen ur `HitsView.tsx`; tester.

Beteende (beslut 3, 7, 14 och förslagen):
- **Fokusrad:** väljare för matrisen i fokus (med ikon break/one-shot), knappar för Take from, Play-knappen.
- **Matrisens rad:** namn (går att döpa om), ikon, `← Samples`, Clone, Delete, + Pad; väljs den visas matrisens reglage.
- **Tidslinjen:** padsen efter varandra, varje pad lika bred som `padSteps` (en tom pad smal och tydlig), stegraster med slag; varje pads hits nedåt, första hitten markerad; padens val (Top/RR/Random/No repeat) på paden. Zoom `Fit` och `1 bar`. 64 pads i Fit: smala kolumner med nummer och första hittens vågform; tidslinjen scrollar i sin egen ruta (Review Focus 2).
- **Reglagen** under tidslinjen för det valda: hit (Replace…, region med handtag, Variant, Direction och alla reglage), pad (padens val, Pad sound, Delete pad) eller matrix (dess config). Delete av en hit frågar alltid (U3).
- **Play i headern** spelar det valda: hit en gång, pad som den väljer, matrix i loop. Ett klick på en hit spelar den.
- Etiketter: `15→07` och `→think 07` som i specen (U10); namn kortas med … i mitten med hela namnet i title (U9); nya matriser numreras från 1 (U8); ♪ Song vid det som hörs.
- Tomt läge utan fokus: välj en matrix, eller `← Samples` om projektet saknar matriser.

- [ ] **Step 1: Tester:** `pads lay out by their length with their hits downwards`, `fit zoom fits 64 pads without page scroll` (Review Focus 2, med bredden satt), `selecting a hit, a pad or the matrix shows its controls`, `deleting a hit asks first`, `a new matrix is Matrix 1`, `the header plays the selection`, `labels show 15→07 and →think 07`.
- [ ] **Step 2–4:** FAIL → implementera → PASS; gate grön.
- [ ] **Step 5: Commit** `Fas 23: Pads timeline and controls`.

### Task 6: Pads: drag, tryck och tangentbord

**Files:** `src/ui/PadsView.tsx` och delkomponenter, `src/ui/dnd.ts`; tester.

Beteende (beslut 4, 8, 13, förslaget om tangenter):
- **Take from-hyllan** under tidslinjen: varje matrix med sina hits och "all hits".
- **Släpp på en pad** (tom yta) lägger kopior sist; en pad på Top med fler än en hit byter till Round robin (fas 22-förslaget). **Släpp på en hit** ersätter (`replaceHit`). **Släpp mellan två hits i samma pad** flyttar (`movePadMember`), också till första plats. Drag från en annan pad ger alltid kopior. Under draget syns vilket som händer (målet markeras som "replace", "add" eller en insättningslinje).
- **Autoscroll** av tidslinjen och hyllan när man drar nära kanten (U4).
- **Mobil:** tryck på en hit eller "all hits" i hyllan, sedan på en pad (lägg till) eller en hit (ersätt); Escape eller ett nytt tryck avbryter.
- **Tangenter:** ←/→ byter pad, ↑/↓ byter hit, varje steg spelar det valda; Enter väljer matrisen; Delete frågar som Delete-knappen.

- [ ] **Step 1: Tester (händelsenivå):** `dropping on a pad adds copies last`, `dropping on a hit replaces it`, `dropping between hits moves within the pad, also to first`, `dragging from another pad copies`, `tap a hit then a pad adds it`, `arrow keys move the selection and play`, `drag near the edge scrolls` (logiken).
- [ ] **Step 2–4:** FAIL → implementera → PASS; gate grön.
- [ ] **Step 5: Commit** `Fas 23: Pads drag, tap and keys`.

### Task 7: + New matrix

**Files:** `src/ui/PadsView.tsx` (eller `NewMatrixDialog.tsx`); tester.

Beteende (beslut 6, 15): `+ New matrix` öppnar en dialog med namnfält och en lista över laddade one-shots (matriser med en pad, deras hits), med kryssruta och ▶ per rad (ett klick spelar). Create kör `createMatrixFrom` och sätter den nya matrisen i fokus. Utan kryss skapas en tom matrix med en tom pad.

- [ ] **Step 1: Tester:** `new matrix from ticked one-shots`, `a click plays a one-shot in the list`, `the new matrix gets focus`, `no ticks makes an empty matrix`.
- [ ] **Step 2–4; Step 5: Commit** `Fas 23: New matrix from one-shots`.

### Task 8: Loops delar fokus

**Files:** `src/ui/LoopsView.tsx`; tester.

Beteende (beslut 5, 16): Loops visar samma fokusrad som Pads; hyllan visar matrisen i fokus och de man tar från. Listan "Show in Pads" tas bort. En tom pad visas inte med `·1` (U11); en matrix i hyllan heter efter klassificeringen bara med ikon.

- [ ] **Step 1: Tester:** `the shelf shows the focus and take from`, `changing focus in Loops changes it in Pads`, `an empty pad has no length label`.
- [ ] **Step 2–4; Step 5: Commit** `Fas 23: Loops shares the focus`.

### Task 9: Städning, resten av checklistan, webbläsarkoll

**Files:** ta bort `HitsView.tsx`, `ImportView.tsx`, `SliceView.tsx` och oanvända delar; `describeChange.ts`, `SongView.tsx`, `Header.tsx`, `subject.ts`; tester.

- **U14:** ångra-texter säger vad som hände ("slice amen 1", "move marker", "renumber amen 1", "new trim amen 2", "import 120Stereo.rx2", "copy pad 07", "replace hit", "new matrix Snares").
- **U16:** körfälten i Song har etiketter Main, Fill, Mod A, Mod B, och tidslinjen är lika bred som körfälten.
- **U17:** New snapshot ser avstängd ut när den är det.
- **U18:** Mods utan mod har inget att spela, så Play stannar (spec, Uppspelning).
- **U20:** dialogen New trim / Renumber listar pads med matris och rad (`amen 1 07`, `Snares 01`).
- **Webbläsarkoll** (Playwright, riktig drag): gå igenom "Klart när" i `fas-23.md` punkt för punkt, också på 400 px bredd; skärmbilder i `.playwright-mcp/fas23-*.png`.

- [ ] **Step 1: Tester** för U14, U16, U17, U18, U20.
- [ ] **Step 2–4:** implementera → gate grön → webbläsarkollen.
- [ ] **Step 5: Commit** `Fas 23: old views gone; checklist done`.

### Task 10: Spec och sammanfattning

**Files:** `docs/spec.md` (Pipeline och vyer: Samples, Pads, Loops; Uppspelning; fasraden 23), `CLAUDE.md` (Aktuell fas), `docs/tasks/fas-23-sammanfattning.md`.

- [ ] **Step 1:** Skriv om specens vyer efter beslut 1–16 och det som byggdes; bocka av M1–M5 och U1–U20 i `fas-23-sortering.md`.
- [ ] **Step 2:** Sammanfattningen: "Klart när" punkt för punkt med testnamn, `TODO(spec)` (grep), vad som bör granskas (controllerns beslut först).
- [ ] **Step 3:** gate grön. **Step 4: Commit** `Fas 23: spec and summary`.
