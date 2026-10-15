# Fas 1 – Motor

## Mål

Bygg `src/model` och `src/engine` så att en låt kan räknas fram till triggers och renderas till ljud. Inget GUI i den här fasen.

**Klart när:** testerna nedan går igenom, `npm run typecheck` är grönt, och det finns en kort sammanfattning av vad som är gjort och vilka `TODO(spec)` som återstår.

## Uppsättning

- Vite + TypeScript (strict) + Vitest. React installeras men används inte ännu.
- Scripts enligt `CLAUDE.md`.

## Ingår

### Model (`src/model`)

1. Typer för `Sample`, `Tag`, `Hit`, `Pad`, `Loop`, `Step`, `Mod`, `Song` och `Project` enligt specens datamodell. `Step` har fälten pad, valt medlems-id, `ignoreMods` och `nudge` (alltid 0 i v1).
2. Kommandon som skapar, ändrar och tar bort objekt, med en gemensam undo/redo-historik.
3. Referenskontroll: ett kommando som tar bort något som används misslyckas och returnerar var det används.
4. Automatisk kedja:
   - `addSample` skapar sample + default-hit + pad med hitten som enda medlem.
   - `sliceBreak(sample, bars, grid)` skapar en sample per slice (med kedjan) och loopen M1 som spelar padsen i ordning. Grid `1/16` och 4 takter ger 64 slices.
   - BPM för ett break räknas fram ur längd och antal takter.
5. Ta bort en pad-medlem: steg som valt den faller tillbaka på medlem 1.

### Engine – generator (`src/engine/generate.ts`)

`generateTriggers(project, rng): Trigger[]`, där `Trigger` = tid (s), takt, steg, hit-id, pitch, volym, riktning, region.

1. Lagerprioritet: Fill före Main, exakt ett lager per takt.
2. En Main loopar tills nästa Main börjar. En Fill täcker så många takter som den är lång. Mains interna taktposition räknas vidare under en Fill.
3. Steg spelar vald medlem, annars medlem 1.
4. Mod-ramverket: rader A och B, omfång, rate (steg/beat/bar, värdet hålls över intervallet), fast tillämpningsordning enligt specen, numeriska värden adderas, lägesvärden vinner för B, `ignoreMods` respekteras, samma mod i angränsande takter är en sammanhängande modulation.
5. I den här fasen räcker två mål och två former: **Pitch** med formen **List**, och **Ratchet** med formen **Random**. Övriga mål och former kommer i fas 4, men ramverket ska vara byggt så att de kan läggas till utan omskrivning.
6. Ratchet n ger n triggers jämnt fördelade över steget. Pitch från mods gäller varje retrigger.

### Engine – renderare (`src/engine/render.ts`)

`renderTriggers(triggers, project, sampleRate): Promise<AudioBuffer>` via `OfflineAudioContext`.

1. En röst: en ny trigger klipper den förra med en kort fade (konstant, t.ex. 3 ms).
2. Region (start/slut), riktning (baklänges-buffrar förberäknas och cachas), pitch som `playbackRate`, volym i dB, fade out.
3. Stereo behålls.
4. Buffern är exakt lika lång som låten.

Testa generatorn noggrant. Renderaren behöver färre tester men ska testas på riktigt ljud: välj en lösning för Web Audio i testmiljön (en Node-implementation av Web Audio eller Vitest browser mode) och motivera valet kort i sammanfattningen.

## Tester som krävs

Generatorn (alla med fast `rng`):

- [ ] Song `M: 1--- 1---`, `F: ---1 ----`: takt 4 spelar F1, takt 5–8 spelar M1 från dess takt 1.
- [ ] En Main på 4 takter följd av fyra tomma Main-celler och sedan M2: M1 loopar tills M2 börjar.
- [ ] En Fill på 2 takter täcker två takter.
- [ ] Steg utan val spelar medlem 1; steg med val spelar vald medlem; borttagen medlem ger medlem 1.
- [ ] Pitch-mod (List, per beat) håller samma värde över fyra steg.
- [ ] Pitch från A och B adderas.
- [ ] Ratchet 4 ger fyra triggers med lika avstånd inom steget, alla med modens pitch.
- [ ] `ignoreMods` stänger av alla mods för steget.
- [ ] Samma `rng` ger samma triggers; olika `rng` kan ge olika.

Model:

- [ ] `sliceBreak` med 4 takter och 1/16 ger 64 samples, 64 hits, 64 pads och M1 med padsen i ordning.
- [ ] Att ta bort en hit som används i en pad misslyckas och listar paden.
- [ ] Undo och redo återställer exakt tidigare state.

Renderaren:

- [ ] Längden stämmer med låtens längd.
- [ ] En trigger börjar på rätt sampel (±1).
- [ ] När en ny trigger startar har den förra tonat ut inom fade-tiden.

## Ingår inte

GUI, filimport och avkodning (använd syntetiska testbuffrar), Tag-logik utöver typen, slip-tempo, Borrow, övriga mod-mål och former, lagring i IndexedDB, projektfil, export.
