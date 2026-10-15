# Fas 5 – Förfining

## Mål

Snabbare väg från import till bra slices och taggar: transientdetektering, autotaggning, egna taggar, WAV-cue-markörer och smidigare drag and drop.

**Klart när:** Amen kan slicas på transienter, slicesen får gissade taggar som kan bekräftas, en WAV med cue-markörer behåller sina slices vid import, och placeringar i Song och Loops kan flyttas genom att dra dem. Testerna nedan går igenom, typecheck och lint är gröna, och det finns en sammanfattning i `docs/tasks/fas-5-sammanfattning.md`.

## Ingår

### Engine

1. **`detectTransients(audio, offset, duration, sensitivity)`:**
   - Ger slagens starttider i sekunder från samplets början. Känsligheten är 0–100.
   - Metod: energin i högpassfiltrerad mono i fönster om cirka 3 ms, och ökningen jämfört med fönstret innan. Toppar plockas över en tröskel som känsligheten styr, med minst 30 ms mellan dem. Varje topp flyttas sedan bakåt till där ökningen börjar, så att markören ligger precis före slaget.
   - Ren funktion.
2. **`classifyHit(audio, offset, duration, loudest)`:**
   - Gissar K, S, H, R eller G utifrån energin i tre band (låg under ~150 Hz, mellan och hög över ~5 kHz), hur länge ljudet klingar, och toppnivån jämfört med det starkaste slaget i breaket.
   - Ett slag mer än 15 dB under det starkaste blir G (ghost).
   - Ren funktion. Den gissar, och kan ha fel.
3. **Cue-markörer:** `decodeAudioFile` läser `cue `-chunken i en WAV och ger cue-positionerna i sekunder bredvid ljudet.

### Model

1. **`Sample.tagGuessed`:** sant när huvudtaggen är gissad.
   - `guessTags(sampleIds, guess)` sätter gissningar på otaggade samples. `guess` är en funktion som skickas in, så att model inte beror på engine.
   - `confirmTags(sampleIds)` bekräftar gissningarna.
   - En tagg man sätter själv är alltid bekräftad.
2. **Markörer som behålls:**
   - `setBreak` (ändrat antal takter) och `trimSample` behåller egna markörer. Vid trimning flyttas de med och kapas till fönstret.
   - Markörer som ligger på ett jämnt grid räknas om till det nya gridet, som förut.
3. **Import med cues:** en WAV med cues blir ett break på 4 takter med markörer på cue-positionerna.
4. **Egna taggar:** `addTag` finns. `removeTag` tar bara bort egna taggar, inte de fem förvalda, och nekas om taggen används.

### UI

1. **Slice:**
   - Läget "Transients" med ett reglage för känslighet. Markörerna följer reglaget live tills man ändrar en markör för hand.
   - "Equal grid" finns kvar.
2. **Tag:**
   - Status för varje kort: "auto" (streckad) eller "tagged".
   - Filtren All, Untagged och Auto.
   - "Guess tags" gissar på otaggade samples, och "Confirm all auto" bekräftar.
   - "+ Add tag" och × på egna taggar.
   - Efter "Apply slices" gissas taggar automatiskt för de nya slicesen.
3. **Drag and drop:**
   - Målet markeras medan man drar över det.
   - I Song kan en placerad loop eller mod dras till en annan takt (flytta). Med Alt/Option kopieras den.
   - I Loops kan ett steg dras till ett annat steg (flytta), och med Alt kopieras det.

## Tester som krävs

- [ ] `detectTransients` hittar syntetiska slag inom ±2 ms, inga i tystnad, och färre med lägre känslighet.
- [ ] `classifyHit` klassar syntetisk kick (låg sinus), hi-hat (högpassat brus), snare (brus och ton) och ghost (svag snare) rätt.
- [ ] WAV med `cue `-chunk ger cue-positionerna, och import blir ett break med markörerna.
- [ ] `guessTags` och `confirmTags`, och att en tagg satt för hand är bekräftad.
- [ ] `setBreak` och `trimSample` behåller egna markörer.
- [ ] `removeTag` nekas för förvalda och använda taggar.
- [ ] UI: Transients-läget sätter markörer. Att dra en loop i Song flyttar den, och med Alt kopieras den.
