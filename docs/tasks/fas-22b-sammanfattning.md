# Fas 22b – REX2-import: sammanfattning

## Gjort

- **Läsaren** `decodeRex(bytes)` i `src/engine/rex-read.ts` är en TypeScript-version av läsdelen i VelociLoops (Unlicense): IFF-chunkarna (HEAD, GLOB, SINF, SLCE, SDAT i CAT-chunkar), slicelistan som `finalizeSlices` håller den och DWOP-dekomprimeraren, även dess block om 2^20 ramar. Den är ren (ingen DOM eller Web Audio) och ger `{ sampleRate, previewBpm, bars, audio, slices }`. `previewBpm` är tempot ReCycle provlyssnar i (GLOB), inte loopens eget tempo. Det följer av ljudets längd och takterna. `isRexFile(bytes)` känner igen en REX2-fil på huvudet. Skrivdelens `adjustJRbits`, `minAverageIndex` och `updateAverages` i `src/engine/rex.ts` används av båda. Motorns index exporterar bara `encodeRex`/`RexLoop` från `rex.ts`, så hjälpfunktionerna syns inte utåt.
  - **Ljudet** är loopens vågform från SINF:s loopstart till loopslut. Om den första synliga slicen börjar före loopstart börjar ljudet där i stället, för det är där REX-SDK:n spelar loopen från. Det gäller `120Mono.rx2`, som har loopstart 14363 men första slice 322. Ljudet är som heltal delade med 2^15 eller 2^23. En monofil läggs i båda kanalerna.
  - **Takterna** räknas från GLOB:s takter och slag i filens taktart, omräknat till fjärdedelar. De avrundas uppåt till hela 4/4-takter, och en loop som inte är hela takter fylls ut med tystnad i loopens eget tempo.
  - **Slicerna** är starterna som parter 0–1 av ljudet. De slicer som filens känslighet döljer tas bort, liksom de efter loopslut. Muted och locked behålls. En slice läggs till vid loopstart om den första börjar senare.
  - **Fel:** "Not a REX2 file" om det inte är `CAT …REX2`, "Damaged REX2 file" om en chunk går utanför filen, GLOB eller HEAD är fel, tempot är orimligt eller ljudet tar slut, och "REX2 file too new" för en HEAD-version över 3.
- **Modellen:** `addSlicedSample({ name, audio, bars, markers })` i `src/model/chain.ts` kör `addSample` och sedan `setSlicing` med filens takter och markörer, som ett enda kommando och ett ångra-steg. Markörer närmare varandra än `MIN_SLICE` tas bort, på samma sätt som för cue-markörer. Det går inte att använda `sequence` direkt, eftersom samplets id inte finns förrän `addSample` har körts.
- **Import** (`src/ui/ImportView.tsx`) tar emot `.rx2` både med Browse (`accept` har `.rx2`) och med drag. Filen känns igen på sitt huvud, så en omdöpt REX2-fil läses ändå. En fil som slutar på `.rx2` men inte är REX2 får REX-felet. Felen visas i Imports felruta som `namn: fel`. Texten i dropzonen säger nu "Drop WAV, AIFF or REX2 files here".
- **Testfilerna** finns i `src/engine/fixtures/rex/`: `120Stereo`, `120Mono`, `120FourBeats`, `120ThreeBeats` och `120Mono24Bits` som .rx2 och .wav, och `ErrorCorrupt.rx2`. En README anger källan och licensen.
- **Specen:** Import tar emot .rx2 och beskriver hur den läses, raden "REX2-import" är borttagen under Utanför v1, och fasraden 22b är tillagd.

## Klart när

1. **En .rx2 importeras i Import (Browse och drag) och blir ett sample som redan är slicat: REX-filens slicer är markörer, takterna kommer från filen, och matrisen och loopen skapas som när man slicar själv. Loopen låter som filen.**
   - `Browse: a sample already sliced at its slices, its matrix a pad per slice, and its loop, in one undo step` (`src/ui/rex-import.test.tsx`): 120Stereo.rx2 ger 1 takt, 10 markörer, 10 pads, en loop med 10 pads, "1 bar · 120.00 BPM", och ett Ctrl+Z tar bort allt.
   - `drag: a mono file plays in both channels` gäller drag.
   - `a file that is already sliced (REX)` (`src/model/chain.test.ts`) gäller kommandot.
   - Att loopen låter som filen visas i motorn (punkt 2). Det är inte provat i en riktig webbläsare.
2. **Testfilerna från VelociLoops avkodas till samma ljud som deras WAV-facit, inom avrundningen från heltal till flyttal.** Delvis, och det bör du granska. WAV-facit är inte loopens råa vågform. De är vad REX-SDK:n spelar i 120 BPM, slice för slice:
   - varje slice börjar 2 ramar in
   - filens processing gain gäller (1000 ger 0,8333)
   - slicerna läggs på sina platser i 120 BPM, och efter varje slice följer en stretch-svans
   - resultatet är skrivet som 16 bitar

   VelociLoops egna tester jämför inte heller avkodningen mot WAV:arna. Två saker prövas därför (`src/engine/rex-read.test.ts`):
   - **Exakt:** den första slicen spelas rakt ur filen tills nästa börjar. Där är avkodat ljud × 0,8333 lika med facit inom 2 steg i 16 bitar, i båda kanalerna, i 10 000 ramar. Det gäller alla fem filerna, även 24-bitarsfilen.
   - **Placering:** varje slice i varje fil hörs i facit där dess plats i loopen hamnar i 120 BPM, alltså dess del av den utfyllda loopen gånger takterna gånger 4 × 22 050 ramar. Det stämmer inom ett SDK-block på 64 ramar (i praktiken högst 31). De första 4 000 ramarna korrelerar över 0,99 med facit, och en slice som börjar tyst är tyst även i facit. Exakt likhet går inte här, eftersom föregående slices svans ligger över början. Testet visar att loopstarten för 120Mono och utfyllnaden för 120ThreeBeats stämmer med SDK:n.

   `120Mono.wav` är byte för byte samma fil som `120FourBeats.wav`, och 120Mono avkodas nu till samma loop och slicer som 120FourBeats. Hela WAV:en skulle bara gå att återskapa med SDK:ns slicespelare med stretch, och den hör inte hit.
3. **En fil som Breakseq själv exporterat som REX läses tillbaka med samma antal slicer, samma tempo och samma ljud.** `reads a file Breakseq exported with the same slices, tempo and sound` ger 3 slicer vid ramarna 0, 5000 och 12000 och `previewBpm` 132, och ljudet är lika inom 24 bitar med tystnad efter. `reads a long export the same, past the blocks its decompressor works in` gör samma sak med 1,2 miljoner ramar.
4. **En trasig eller okänd fil ger ett tydligt fel i Import, ingen krasch.**
   - `says what is wrong with bytes that are not a REX2 file, or a damaged one`: skräp och en WAV ger "Not a REX2 file", och ErrorCorrupt.rx2 och en avkortad fil ger "Damaged REX2 file".
   - `a damaged or unknown .rx2 shows an error and adds nothing` (UI): "nope.rx2: Not a REX2 file" i felrutan, och inget sample läggs till.
   - `a REX2 file renamed to something else is still read as one, by its header` (UI).
5. **Testerna går igenom, typecheck och lint är gröna, och det finns en sammanfattning.** 502 tester i 61 filer passerar, och `npm run typecheck` och `npm run lint` är gröna. Det här är sammanfattningen.

## TODO(spec)

Inga (`grep -rn "TODO(spec)" src` ger inget). Specen sa inget om några saker som jag har bestämt. De står under Vad som bör granskas.

## Vad som bör granskas

- **Loopar som inte är hela takter** fylls ut med tystnad till hela takter, i loopens eget tempo. Då blir BPM:en i Breakseq (som räknas ur längd och takter) loopens och inte en högre. Utan utfyllnad skulle en loop på tre slag få 1 takt och 160 BPM. SDK-facit för 120ThreeBeats stämmer med det.
- **Andra taktarter än 4/4.** Breakseq räknar fjärdedelar: 7/8 blir 3,5 fjärdedelar och fylls ut till en 4/4-takt. REX-SDK:n räknar `bars*num+beats` slag och bryr sig inte om nämnaren. Det är bara provat på 4/4-filer.
- **Mycket udda filer**, som 100 takter eller 500 slicer (`450OneHundredBars`, `240FiveHundredSlices` i VelociLoops), importeras men ger extrema BPM eller väldigt många pads. De är inte med bland testfilerna.
- **Processing gain** används inte. Ljudet tas som det ligger i filen, så en importerad REX låter cirka 1,6 dB starkare än i Dr. Octo Rex med gain 1000. Det följer förslaget "ljudet tas som det ligger i filen".
- **Tempot:** samplets BPM i Breakseq räknas ur loopens längd och inte ur `previewBpm`. 120FourBeats är 113 479 ramar för fyra slag, alltså cirka 93,27 BPM, fast filen säger 120. Fit to tempo sträcker slicerna efter 93,27, medan en REX-spelare spelar dem i 120 utan att sträcka.
- **Känsligheten:** slicer som ReCycle döljer vid filens känslighet tas bort, precis som i VelociLoops. 120Stereo har därför 10 slicer av sina 23 SLCE-chunkar.
- **Inte provat i en riktig webbläsare.** Browse och drag är testade i happy-dom.
