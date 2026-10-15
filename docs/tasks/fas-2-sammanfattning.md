# Fas 2 – sammanfattning

## Gjort

- **Model:**
  - `Sample.sliceOf`, `BreakInfo.sliced` och `setBreak(sampleId, bars | null)`.
  - `sliceBreak` vägrar slica ett break två gånger.
- **Engine (`src/engine/codec.ts`):**
  - `decodeAudioFile` läser WAV (PCM 8/16/24/32 bit, float 32/64, även WAVE_FORMAT_EXTENSIBLE) och AIFF/AIFC (`NONE`, `sowt`).
  - Trasiga och okända filer ger `AudioFileError`.
  - `encodeWav` skriver 24 bit stereo och normaliserar.
- **UI (`src/ui`):**
  - Header med flikarna 1–8, Play/Stop, BPM och Export WAV.
  - Vyerna Import, Slice och Song, plus en platshållare för vyer som kommer i senare faser.
  - Ångra och gör om med Ctrl/Cmd+Z och Ctrl/Cmd+Shift+Z (även Ctrl+Y).
  - All IO går via `Services` (lagring, uppspelning, rendering, export), så att UI-testerna kan köras med fakes.
- **Rendering:**
  - Sker 300 ms efter varje ändring, och "New take" ger en ny slumptagning.
  - En ny tagning under uppspelning börjar vid loopens slut (`nextLoopBoundary`).
- **Spelhuvudet:** takten med den senast passerade triggern tänds (`playheadBar`).
- **Export:** sparar exakt den tagning som spelas, utan ny rendering.
- **Autospar:** sparar i IndexedDB 1 s efter varje ändring och laddar vid start.

Alla tester från uppdraget finns (55 totalt). Typecheck och lint är gröna. ESLint kontrollerar nu också React-hooks i `src/ui`.

## Verifierat i webbläsaren

Hela flödet är kört i Chromium med ett syntetiskt break (4 takter, 136 BPM, 16 bit stereo):

1. **Import och Slice:** importen räknade fram 136,0 BPM, och Slice visade 64 slices på 1/16 med markörer som stämmer med vågformen.
2. **Song:** "Apply slices" gav M1, och M1 drogs till takt 1 med riktig drag-and-drop.
3. **Uppspelning:** spelhuvudet gick i rätt tempo. Vid byte från 170 till 140 BPM under uppspelning spelade den gamla tagningen klart loopen innan den nya tog över.
4. **Export:** 44,1 kHz, 24 bit, 2 kanaler, exakt låtens längd (13,714 s vid 140 BPM, 8 takter) och toppen på full skala.
5. **Omladdning:** M1, BPM och samples fanns kvar.

Inga fel i konsolen.

## Beslut efter fas 2

1. Exporten normaliseras till −0,3 dBFS.
2. Play och Export spelar och exporterar låten i vyer utan egen uppspelning (Import, Slice).

## Tolkningar att granska

- **Import:** filer avkodas med egen kod istället för `decodeAudioData`, eftersom Chrome och Firefox inte avkodar AIFF.
- **Tom cell:** töms med Delete eller Backspace på en fokuserad cell. Det finns ingen högerklicksmeny.
- **Takter i Import:** varje ändring av antal takter blir ett eget ångra-steg.

## Öppet efter fas 2

- Uppspelningen låter "ok, inte bra" enligt Magnus (2026-10-15), med det syntetiska testbreaket. Renderaren är verifierad bitexakt i breakets eget tempo efter rättningen (round-trip-testet). Vi tar upp det igen med ett riktigt break när hits och pads går att justera i fas 3.
