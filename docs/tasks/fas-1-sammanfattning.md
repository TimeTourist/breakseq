# Fas 1 – sammanfattning

## Gjort

- **Uppsättning:** Vite, TypeScript (strict, `noUncheckedIndexedAccess`), Vitest, ESLint. React är installerat men används inte än.
- **Lagerregler i lint:** `src/model` får inte importera engine eller ui. `src/engine` (utom `render*`) får inte använda Web Audio, DOM eller React. `Math.random` är förbjudet i model och engine.
- **Model** (`src/model`):
  - Typer enligt specen.
  - Kommandon som rena funktioner `(project, ctx) => result`.
  - Gemensam undo/redo-historik (`history.ts`).
  - Referenskontroll som listar var något används (`references.ts`).
  - Automatisk kedja: `addSample`, `sliceBreak`, `breakBpm`.
  - `removePadMember` gör att steg faller tillbaka på medlem 1.
- **Generator** (`src/engine/generate.ts`, `mods.ts`):
  - Lagerval, där en Fill går före Main och Main räknar vidare under en Fill.
  - Medlemsval per steg.
  - Mod-ramverk med rader, omfång, rate, sammanhängande körningar, fast ordning och regler för hur A och B kombineras.
  - Målen Pitch och Ratchet, och formerna List och Random. Nya mål läggs till som en handler i `mods.ts`, och nya former i `shapeValue`.
- **Renderare** (`src/engine/render.ts`):
  - `OfflineAudioContext` med en röst och 3 ms choke-fade.
  - Region, baklänges-buffrar som cachas per sample, pitch som `playbackRate`, volym i dB och fade out.
  - Stereo, och en buffer som är exakt lika lång som låten.

Alla tester från uppdraget finns. Typecheck och lint är gröna.

## Web Audio i testerna

Renderartesterna använder `node-web-audio-api` (en Rust-implementation av Web Audio för Node). Den är snabb (ingen webbläsare), kör i samma Vitest-miljö som övriga tester och har en äkta `OfflineAudioContext`. Vitest browser mode hade gett webbläsarens exakta beteende, men kräver Playwright och en webbläsare i CI. Det kan bli aktuellt i fas 2 för UI-tester.

## TODO(spec)

1. Standardtempo och låtlängd anges inte i specen. Satt till 170 BPM och 8 takter (`src/model/project.ts`).
2. Specen säger inte hur Ratchet från A och B kombineras. Ratchet behandlas som ett lägesvärde, så B vinner (`src/engine/mods.ts`).
3. Specen säger inte om ett taggomfång läses före eller efter att andra mods ändrat hitten. Det läses från stegets egen hit (`src/engine/mods.ts`).
4. Specen säger inte om en pad får bli tom. Det är tillåtet, och en tom pad spelar inget (`src/model/commands.ts`).

## Tolkningar att granska

- **`sliceBreak` och "64 samples":** det betyder 64 *nya*. Själva breaket är också ett sample med egen hit och pad, eftersom kedjan körs vid import.
- **Grid vid slicing:** bara 1/4, 1/8 och 1/16 stöds. Finare grid skulle kräva fler än 16 steg per takt.
- **Tempo vid slicing:** slicing ändrar inte låtens BPM. Breakets BPM sparas på samplet.
- **Stegintervall i omfång:** gäller steg inom takten (0–15).
- **Random för Pitch:** ger decimaltal. Ratchet får heltal.
- **Choke-fade:** fadningen börjar när nästa trigger startar, så de två överlappar i 3 ms.

Granska särskilt `src/engine/generate.test.ts` innan fas 2.
