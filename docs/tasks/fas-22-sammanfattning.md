# Fas 22 – Matrix: sammanfattning

## Gjort

- **Modellen** är en kedja: fil → trim → sample → hit → pad → matrix. Typerna i `src/model/types.ts` är `Sample`, `Hit`, `Pad` och `Matrix`; `Break`, föräldern och `breaks` finns inte längre. En hit sitter i exakt en pad och en pad i exakt en matrix (`src/model/owners.ts`). `matrixKind` ger `'break'` för flera pads och `'one-shot'` för en; det visas som en ikon (`MatrixKindIcon`).
- **Config i tre lager** (`effectiveHit` i `src/model/sound.ts`): pitch, volym och pan adderas, varje baklänges lager vänder riktningen, stretch multipliceras och Fit to tempo räknas en gång. Resten tas från närmaste lager som har ett eget. Tempot för Fit kommer från hittens sample.
- **Slicingen ligger på trimmen.** I koden är `Sample` trimmen, med `bars` och `markers`, och en slice är trimmen plus ett nummer (`hit.slice`). Varje trim får en egen matrix. Slicas trimmen blir den matrisen den slicade, med en pad per slice och första gången en loop (`src/model/chain.ts`).
- **Numreringen frågar först.** `renumberConflict` tar reda på om en ändring byter nummer på en slice som mer än en hit spelar. Då frågar `RenumberDialog` med knapparna New trim och Renumber. New trim (`newTrim: true`) gör en ny trim av filen med ändringen och flyttar dit matrisen man slicar; kopior på andra ställen ligger kvar på den gamla trimmen.
- **Drag ger kopior.** Det sköts av `copyHits`, `copyPad`, `copyMatrix` och `cloneMatrix` (`src/model/commands.ts`). Nya pads och matriser görs med `addPad`, `movePad` och `createMatrix`, och config ställs med `setPadConfig` och `setMatrixConfig`. Loopar får matriser med `placeMatrix` och byter med `swapMatrix`.
- **Längder:** `matrixSequence` och `matrixSteps` i `src/model/lengths.ts` lägger ut pad efter pad, och varje pad är så lång som sin första hit.
- **Motorn** spelar matriser. `matrixSong` i `src/engine/preview.ts` gör hela takter. MIDI-bitarna ligger i trim- och sliceordning.
- **Lagring:** projekt från före Matrix öppnas inte, och de får meddelandet `OLD_PROJECT_MESSAGE`. En autospar från före Matrix sparas först som en säkerhetskopia. All gammal uppgraderingskod är borttagen.
- **Gränssnittet:**
  - Hits visar matriser, med matrisens config, padens Pad sound, + New matrix, + Pad, Clone matrix och Delete matrix.
  - Plays och Replace with file är borta.
  - Import har Slice och Don't slice, och Delete trim.
  - Slice listar trims och har dialogen för omnumrering.
  - Loops har hyllan ordnad efter matrix. Matriser kan läggas ut och bytas, och ett klick spelar en matrix en gång.
- **Specen och CLAUDE.md** följer modellen. Det gäller ordlistan, Datamodell, Pipeline och vyer, den automatiska kedjan, Byten och omräkning, Data och fasraden.

## Klart när

1. **Amen slicas och blir en matrix med 64 pads som spelar som i dag i sin loop.**
   - `slicing makes the own matrix one pad per slice and a loop the first time` (`src/model/chain.test.ts`) visar 64 markörer, 64 pads och en loop på 64 steg med paddarna i ordning.
   - `a sliced sample lays out as today` (`src/model/lengths.test.ts`) visar paddarna på steg 0…63.
   - `the automatic loop follows until edited by hand` och `nothing is made until both bars and how are chosen, then all of it in one undo step` (`src/ui/unsliced.test.tsx`) täcker resten.
   - I Chrome blev Amen-break.wav på 4 takter och 1/16 64 slices.
2. **En ny matrix *Snares* kan fyllas med fyra snares från olika filer, ställas på Round robin och spela en ny snare varje gång på ett steg i Loops.**
   - `Klart när: four snares become a pad, placed in a loop and heard in Song` (`src/ui/phase3.test.tsx`): + New matrix, döpt till Snares, fyra snares från fyra filer i paden, paden på två steg i en loop och loopen i Song.
   - Round robin: `Round robin plays the next member each time, on over the whole song` och `Round robin counts per pad in time order, whatever loop the pad is in` (`src/engine/pad-choice.test.ts`).
   - I Chrome drogs en snare fyra gånger till Snares och pad 07 ställdes på Round robin.
3. ***Snares* kopieras till Amens rad 07 och ger fyra nya hits där. Pitchas en av kopiorna ändras inte snaren i *Snares*, och tvärtom.**
   - `copying a matrix with five hits to pad 02 adds five new hits last` och `changing a copy leaves the original, and the other way round` (`src/model/matrix.test.ts`).
   - `dropping a matrix on a pad adds copies` (`src/ui/phase3.test.tsx`).
   - I Chrome gav Snares dragen till Amens pad 07 fyra kopior (Undo: add 4 hits).
4. **Sänks volymen på Amens pad 07 sänks alla dess hits; sänks Amens matrix sänks allt i Amen, även kopiorna.**
   - `a pad's and a matrix's config are layers over their hits` (`src/model/matrix.test.ts`).
   - `effectiveHit adds pitch, volume and pan from pad and matrix` och `a hit follows the layers where it lives` (`src/model/sound.test.ts`).
   - `generate applies the pad's and matrix's layers` (`src/engine/generate.test.ts`).
   - `the pad's sound sliders change every hit of the pad` (`src/ui/phase3.test.tsx`): padens volym −6 dB ger −6 dB på både sliceträffen och kopian, och hitsens egna volymer är orörda.
5. **Ingen kod, typ eller text i gränssnittet använder Break eller One-shot som objekt; de finns bara som klassificering (ikon).** Uppfyllt för typer och objekt: inga typer eller funktionsnamn heter `Break`, och `matrixKind` med ikonen är klassificeringen. Text i gränssnittet som fortfarande använder one-shot eller break som namn lämnas till dig att avgöra (se första punkten under "Vad som bör granskas").
6. **Testerna går igenom, typecheck och lint är gröna, och det finns en sammanfattning.** 475 tester i 59 filer passerar, och `npm run typecheck` och `npm run lint` är gröna. Det här är sammanfattningen.

## TODO(spec)

Inga (`grep -rn "TODO(spec)" src` ger inget).

## Vad som bör granskas

### Där det byggda går utöver eller skiljer sig från designen

- **Text som fortfarande använder break eller one-shot som namn** (Klart när punkt 5). Typerna och objekten är klara, men du får avgöra om de här ska bytas:
  - knappen Make one-shot i Slice (kommandot `makeOneShot`), som gör en ny trim med en matrix med en pad
  - gruppen One-shots i Show in Pads och hyllan i Loops
  - "en one-shot" i texter i Hits och Delete, till exempel "(one-shot)" i listan Replace… och "1 pad, 1 hit" för en one-shot
  - testnamn i motorn, till exempel `noiseBreak`
- **Don't slice på en slicad trim** gör som Make one-shot gjorde förut (beslut av controllern, designen säger inget om det). Pad 01 blir kvar och spelar hela trimmen, och de andra raderna med sina hits och loopen går. Var de användes blir det tyst. Det kan behöva ses över i fas 23.
- **Delete matrix tar inte matrisens loop.** Loopen blir kvar, och dess steg med matrisens pads töms. Det är en tolkning av beslut 9.
- **Clone matrix ger ingen egen loop och ingen länk till trimmen.** Clone break gav förut en egen utlagd loop.
- **Regeln "Tagg = `Tag`" är borttagen ur ordlistan i CLAUDE.md**, eftersom det inte finns någon `Tag`-typ i koden (bara etiketten "Tag as" i Loops och en kommentar). Specen säger fortfarande "Tagg Main/Fill" om loopar.
- **Sample i koden är trimmen.** Designen säger att en slicad trim ger ett sample per slice. I koden är `Sample` trimmen, med takter och markörer, och en slice är trimmen plus ett nummer. Ordet Sample täcker alltså båda, och specen säger det så.
- **Loopen heter som matrisen** (amen 1), inte som filen (amen) som förut.
- **Delete trim tar varje hit som spelar trimmen,** även kopior i andra matriser. Paddar som blir tomma ligger kvar. Delete frågar först och listar var den används.
- **Dialogen är på engelska**, som resten av gränssnittet: "You use slice 07, 09 in: pad amen 1 07 and pad Snares 01. Make a new trim and sample for this?". Knapparna heter New trim och Renumber, och Escape avbryter.
  - Den frågar också när grid, takter eller transienter byter numrering, inte bara när en markör läggs till eller tas bort.
  - Takterna frågar när fältet lämnas eller med Enter, och Sensitivity när reglaget släpps, inte mitt i en ändring (beslut av controllern). Om du vill att fältet ska fråga direkt kostar det ett extra klick ut ur fältet.
- **En rad man själv tagit bort kommer inte tillbaka** när markörerna ändras (beslut av controllern, enligt beslut 12). Nya rader görs bara för slices som är nya. Om du väntar dig att en borttagen rad kommer tillbaka när man slicar om, är det inte så.
- **Pads man lagt till själv är inga rader.** Får trimmen fler slices hamnar de nya raderna efter dem.
- **Byte i en loop till en kortare matrix** tömmer steg vars rad den nya saknar, i stället för att lägga till rader där (beslut av controllern).
- **En autospar från före Matrix sparas som säkerhetskopia** innan den skrivs över (beslut av controllern). Beslut 10 säger att gamla projekt inte behöver öppnas, inte att de får förstöras. Kopian går inte att återställa här, men den finns kvar för taggen `fas-21-fore-matrix`. Säkerhetskopiorna räknar nu samples i stället för breaks.
- **Gamla uppgraderingstester är borttagna**, inte omskrivna, eftersom beslut 10 tar bort beteendet.
- **Små val i Hits:**
  - Nya matriser heter Matrix 1, Matrix 2 …
  - En hit som släpps på en matrix blir en ny pad sist.
  - Reglagen visar vad som kommer ovanifrån ("pad: …", "matrix: …").
  - Grains from har Inherit på en hit som har lager ovanför, och lägena heter Sample och Hit.
  - Fit to tempo går att välja på en pad eller matrix när någon hit under den har ett tempo.
- **× i en pads lista tar bort hitten** (Delete och hittens namn), eftersom en hit bara finns i en pad. En pad eller matrix räknas inte som användning av sina egna hits och pads.
- **+ Hit döljer hits som redan finns i paden.** Med kopior skulle samma hit kunna läggas till två gånger. Det kan vara en fråga för specen.
- **Bytet i Loops** ("swap for…") visar inte längre "(one-shot)", eftersom klassificeringen bara är en ikon.
- **Uppspelning:**
  - En matrix spelas i hela takter, så en one-shot spelas som en takt.
  - Ett dubbelklick på en matrix i hyllan räknas också som två klick: den spelas två gånger och valet slås av igen. Det var likadant med föräldern förut.

### Kända luckor (uppskjutna)

- **Ny trim utan matris:** att flytta markörer med New trim på en trim som saknar egen matrix (borttagen) gör en ny trim som ingen använder.
- **Namn vid ny trim:** den nya trimmen behåller matrisens och paddarnas namn; bara trimmen får ett nytt nummer.
- **Delete-listan för en trim** missar loopar som spelar tömda pads utanför trimmens egen matrix. Creates i Import missar loopar för en trim utan egen matrix.
- **Variant av en hit utan pad:** `addVariant` kan göra en hit utan pad när originalet inte sitter i någon pad.
- **Don't slice utan slice 01:** på en matrix där ingen rad spelar slice 01 behålls första raden, och dess hits kan försvinna.
- **Misslyckad återställning:** en Restore av en gammal säkerhetskopia misslyckas, men sparar ändå en kopia av det nuvarande arbetet.
- **Tooltip och namn i Hits:** tooltipen för Fit to tempo på en pad eller matrix är missvisande. `padLabel` bryr sig inte om namn man gett själv.
- **Saknade tester:**
  - Sensitivity som frågar när reglaget släpps.
  - Att samma projekt inte sparas två gånger vid omladdning.
  - Att det fungerar när det inte går att skriva en säkerhetskopia (och `audioIds` kastar ett fel på en autospar utan samples).
  - En slice-hit på en trim utan takter.
- **Tester som inte testar allt:** copyMatrix testas bara med förvalt val. Borttagningstestet kollar inte att loopen blir kvar, och ett påstående i swap-testet kan inte misslyckas. Ett testfixture för nästa lediga trimnummer är inkonsekvent.
- **Inget test för hela Klart när:** inget enskilt test går igenom hela Snares → Amen 07 → volym. Det är täckt i delar (se ovan) och kontrollerat i Chrome.
- **Kod att städa:**
  - `owners.ts` räknar tempot en gång till.
  - `effectiveHit` ger stretch, dist, filter, reverb och delay råa, utan lagren, vilket är lätt att läsa fel.
  - `owners()` saknar en kommentar om att en hit bara sitter i en pad.
  - `configLayers` exporteras i onödan.
  - `lengths.ts` förutsätter sorterade markörer utan att säga det.
  - En testkommentar i `lengths.test.ts` säger sekunder om taktdelar.
  - `sampleParts` använder `''` som matrix-id.
  - `sampleUsages` gör om `ownMatrix`.
  - Matrisknappen i Loops har en inline-IIFE.
  - `RenumberDialog` prenumererar på tangenter på nytt vid varje rendering.
  - Testnamn i motorn säger fortfarande "break".

## Efter slutgranskningen

Sex fynd är rättade: slicning med grid 1/8 eller 1/4 ger inga tysta rader; en trim utan egen matrix erbjuder bara Renumber (inget onödigt New trim); `GrainFrom` heter nu `'sample'` i stället för `'break'` och `breakBpm` är borta (kvar är `sampleBpm`); gamla kommentarer om break och parent är omskrivna; ett autospar från före Matrix ger ett meddelande som går att stänga och säkerhetskopian syns direkt i listan; Delete trim nämner också loopar som spelar pads utanför trimmens egen matrix vars hits spelar trimmen.
