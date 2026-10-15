# Fas 2 – Första iterationen

## Mål

Första versionen man kan lyssna på: ladda ett break, slica det, lägg M1 i låten, hör den loopa och exportera WAV. GUI:t följer mockupen (mörkt tema, IBM Plex, amber-accent), men bara vyerna Import, Slice och Song är byggda.

**Klart när:** man kan ladda Amen, slica, dra M1 till Song och exportera. Testerna nedan går igenom, `npm run typecheck` och `npm run lint` är gröna, och det finns en kort sammanfattning i `docs/tasks/fas-2-sammanfattning.md`.

## Ingår

### Model

1. `Sample` får `sliceOf: Id | null`. Slices pekar på breaket de kommer från; importerade filer har `null`.
2. `BreakInfo` får `sliced: boolean`. `setBreak(sampleId, bars | null)` gör ett sample till break (BPM räknas fram) eller till one-shot. `sliceBreak` kräver ett break som inte är slicat, och sätter `sliced`. Ett break slicas en gång; att slica om ingår inte i v1.
3. Låtens längd ändras med `setSongBars`, som redan finns.

### Engine

1. `decodeAudioFile(bytes): AudioData`: läser WAV (PCM 16/24/32 bit, float 32) och AIFF/AIFC (16/24 bit, `NONE` och `sowt`). Andra format ger ett tydligt fel. Ren funktion, ingen Web Audio, så att import fungerar likadant i alla webbläsare.
2. `encodeWav(buffer): Uint8Array`: 44,1 kHz, 24 bit, stereo, normaliserad.
3. Export använder exakt den buffer som spelas, ingen ny rendering.

### UI (`src/ui`)

1. **Skal:**
   - Header med flikarna 1–8 (tangenterna 1–8 byter vy).
   - Play och Stop, BPM-fält och Export WAV.
   - Vyer som inte är byggda än visar en rad om vilken fas de kommer i.
   - Ångra och gör om med Ctrl/Cmd+Z och Ctrl/Cmd+Shift+Z.
2. **Import:**
   - Släpp filer eller bläddra fram dem.
   - Varje fil blir ett sample via `addSample`.
   - Tabellen med källor visar fil, Break/One-shot, längd (och takter och BPM för ett break), vad som skapats och en länk vidare.
   - För ett break anges antal takter, och 4 är förvalt.
3. **Slice:**
   - Välj ett break som inte är slicat. Vyn visar vågformen med markörer på ett equal grid (1/4, 1/8 eller 1/16, där 1/16 är förvalt) och antal slices.
   - Klick på en slice spelar den direkt.
   - "Apply slices" kör `sliceBreak`.
4. **Song:**
   - Takt-linjal och Main-raden. Raderna Fill, Mod A och Mod B visas avstängda tills fas 3 och 4.
   - En biblioteksrad med Main-loopar. Man drar en loop till en cell, eller väljer loopen och klickar på cellen så att det går med tangentbordet.
   - En vald cell töms med Delete eller Backspace.
   - Låtens längd i takter går att ändra.
5. **Rendering och uppspelning:**
   - Låten renderas automatiskt 300 ms efter varje ändring, och en knapp ger en ny slumptagning.
   - Uppspelningen loopar den renderade buffern.
   - En ny rendering under uppspelning börjar exakt när den gamla loopen tar slut.
   - Spelhuvudet följer triggerlistan: takten med den senast passerade triggern tänds i Song.
6. **Export WAV:** sparar den spelade buffern som `breakseq-<datum>.wav`.
7. **Autospar:**
   - Projektet sparas i IndexedDB 1 s efter varje ändring och laddas när appen startar.
   - Undo-historiken sparas inte.
   - Om lagringen misslyckas syns ett diskret fel, men appen fortsätter fungera.

## Tester som krävs

Engine:

- [ ] WAV 16, 24 och 32 bit samt float avkodas till rätt värden och samplingsfrekvens. Mono och stereo.
- [ ] AIFF 16 och 24 bit, och AIFC `sowt`, avkodas rätt.
- [ ] Trasiga och okända filer ger ett fel, inte en krasch.
- [ ] `encodeWav` ger en korrekt header (44,1 kHz, 24 bit, 2 kanaler) och en normaliserad topp. Det går att avkoda den igen med `decodeAudioFile`.

Model:

- [ ] `setBreak` räknar fram BPM. `null` gör samplet till one-shot igen.
- [ ] `sliceBreak` sätter `sliceOf` på varje slice och `sliced` på breaket, och vägrar slica ett break två gånger.

UI (Testing Library, utan riktig ljudmotor):

- [ ] Tangenterna 1–8 byter vy.
- [ ] Att släppa en loop på en Main-cell lägger den där, och Delete tömmer cellen.
- [ ] Ångra återställer en placering.
- [ ] Spelhuvudet väljer takten för den senast passerade triggern (ren funktion).
- [ ] Bytet av rendering under uppspelning schemaläggs vid loopens slut (ren funktion).
- [ ] Autospar sparar och laddar ett projekt med ljud (fake IndexedDB).

## Ingår inte

Tag, Hits, Pads, Loops, Mods (vyerna), Fill-raden, transientdetektering, projektfil (zip), uppspelning av en enskild loop i Loops-vyn.
