# Fas 23 – sortering av buggar

Genomgång av appen på main (efter fas 22b) i Chromium via Playwright, med en ny tom projektdata (IndexedDB och localStorage rensade). Material: `samples/Amen-break.wav`, `snare_01.wav`, `snare_02.wav`, en kort trim av Amen (0–220 ms, New trim + Don't slice), `src/engine/fixtures/rex/120Stereo.rx2` och `ErrorCorrupt.rx2`. Drag och släpp gjordes med riktiga drag (Playwright `dragTo`). Projektets tillstånd lästes ur autosparen i IndexedDB efter varje steg och kontrollerades: varje hit i exakt en pad, varje pad i exakt en matrix, inga steg mot borttagna pads eller medlemmar, inga klipp mot borttagna loopar. **Den kontrollen hittade inga trasiga tillstånd någon gång**, inte heller efter ångra, zip-import, omladdning eller Load av snapshot.

Skärmbilder ligger i `.playwright-mcp/sort-*.png` (mappen är git-ignorerad).

Sammanfattning: 5 punkter i modell och motor, 20 i gränssnittet. Inga fel eller varningar i konsolen.

## Modell och motor

### M1. Matrisens egen loop slutar följa slicingen när matrisen har ändrats i Hits — medel

- [x] Rättad i fas 23 (`90e1275`): loopen jämförs med hur matrisen lade ut den före ändringen, och varje kommando som ändrar en matrix tar med loopen när den är orörd (`following` i `src/model/chain.ts`).

- **Gjort:** Amen slicad (4 takter, 1/16), loopen *Amen-break 1* orörd. I Hits drogs pad 05 till matrisen *Amen-break 1* (en kopia blir pad 65). Sedan flyttades markör 17 i Slice cirka 70 ms framåt, så att slice 17 hamnar på steg 2.1.2.
- **Väntat:** Loopen har aldrig ändrats för hand, så den ska följa med (spec, Automatisk kedja: "Så länge den är exakt som matrisen lade ut den följer den med när trimmens takter eller markörer ändras").
- **Hände:** Loopen ändrades inte (steg 2.1.1 spelar fortfarande pad 17). Kontroll: samma markörflytt utan kopian gör att loopen följer med (steg 2.1.1 blir tomt och 17 hamnar på 2.1.2).
- **Var:** `followLoop` i `src/model/chain.ts:243–251` jämför loopen med `laidOut(before, was)`, alltså med hur matrisen lägger ut sig *nu*, inklusive pads som lagts till, kopierats, flyttats eller tagits bort i Hits efter att loopen lades ut. `addPad`, `copyPad`, `copyMatrix`, `copyHits` (om första hitten byts), `movePad` och Delete pad uppdaterar inte loopen, så den räknas som handredigerad och fryser för gott.
- **Säkerhet:** hög (reproducerat med kontroll). Specen säger inte om ändringar av matrisen i Hits ska föras över till loopen. Men att loopen fryser utan att man rört den är troligen inte avsikten. Förslag: jämför med en sparad utläggning, eller låt matriskommandona ta med loopen när den är orörd.

### M2. Pad- och hitnamn bär radnummer som inte följer raden — medel

- [x] Rättad i fas 23 (`90e1275`, `ba20537`): en pad heter som matrisen med sin rad och döps om när rader flyttas eller tas bort, utom namn man skrivit själv. `padLabel` läser fortfarande numret ur namnet, som nu följer raden, och Renumber-dialogen använder raden (U20).

- **Gjort:**
  - Pad 05 från Amen drogs till matrisen *snare_02 1*.
  - *120Stereo.rx2 1* (10 pads) drogs till *Snares*.
  - Pad *Snares 01* togs bort.
- **Väntat:** En pad visar vilken rad den är i sin matrix (spec, Hits). Namnen följer matrisen (amen 1 07).
- **Hände:**
  - Kopian i *snare_02 1* heter "Amen-break 1 05" och visas som **05** på rad 02.
  - I *Snares* visas raderna 03–12 som 01–10, så hyllan i Loops visar `01 02 01 02 03 …` (`sort-08-loops.png`).
  - Efter Delete pad heter rad 01 "Snares 02".
  - Följder:
    - Renumber-dialogen och Don't slice-dialogen listar "pad Amen-break 1 05" två gånger, för två olika pads (`sort-06-renumber-dialog.png`).
    - Delete file räknar upp "pad 120Stereo.rx2 1 01 … 10", som i själva verket ligger i *Snares*.
    - Kopierade hits har samma namn som originalet, så + Hit-listan visar två "snare_01 1", två "Amen-break 1 05" och två "Amen-break 1 09".
    - Byts *Amen-break 1* namn får kopiorna i andra matriser inte det nya namnet, eftersom `renameMatrixIn` bara går igenom matrisens egna pads.
- **Var:**
  - `padCopy` och `copiesOf` behåller källans namn: `src/model/commands.ts:158–172`, som används av `copyPad` (rad 196) och `copyMatrix` (rad 214).
  - Delete pad och `movePad` döper inte om.
  - `padLabel` i `src/ui/labels.ts:8` tar numret ur namnet i stället för ur raden.
- **Säkerhet:** hög. Delvis gränssnitt (padLabel), men grunden är namnen i modellen.

### M3. En REX-fils matris heter med ändelsen ".rx2" — låg

- [x] Rättad i fas 23 (`90e1275`): `baseName` tar bort `.rx2`.

- **Gjort:** Importerade `120Stereo.rx2`.
- **Väntat:** Matrisen heter som filen utan ändelse med trimmens nummer: "120Stereo 1" (spec, Datamodell).
- **Hände:** Matrisen, loopen och padsen heter "120Stereo.rx2 1", "120Stereo.rx2 1 01" och så vidare.
- **Var:** `baseName` i `src/model/sound.ts:7` tar bara bort `.wav/.wave/.aif/.aiff/.aifc`.
- **Säkerhet:** hög.

### M4. MIDI-exporten gör en egen bit för varje kopia av samma slice — medel/låg

- [x] Rättad i fas 23 (`90e1275`, `ba20537`): en bit är ett unikt ljud (sample, slice, region, fade och spelade inställningar), inte en hit.

- **Gjort:** Läste `midiPlan`, eftersom drag ger kopior sedan fas 22. Det syns inte i låten jag exporterade, eftersom ingen kopia av samma slice hördes där.
- **Väntat:** "En bit är varje unik variant som hörs i låten" (spec, MIDI och bitar). Två kopior av Amen 05 med samma inställningar låter likadant.
- **Hände (från koden):** `soundKey` i `src/engine/midi.ts:50–61` börjar med `t.hitId`, så varje kopia blir en egen bit och en egen ruta och not. Exporten fylls snabbare mot gränsen på 92 bitar.
- **Säkerhet:** hög på beteendet, men specen kan läsas på två sätt ("hit med pitch, riktning …"). Bör beslutas. Förslag: nyckla på sample + slice + region i stället för hit-id.

### M5. Variantmarkeringen blir kvar efter Replace och när originalet tas bort — låg

- [x] Rättad i fas 23 (`90e1275`): `setHitSource` till ett annat sample och borttagning av originalet nollställer `variantOf`.

- **Gjort:** Variant på "snare_01 1" i *Snares 01*, sedan Replace… till Amen trim 1, slice 05.
- **Väntat:** En variant är en ny hit på samma sample (spec, Hit).
- **Hände:**
  - Hitten heter fortfarande "snare_01 1 var", har `variantOf` kvar och visas som "Variant of snare_01 1" fast den spelar Amen 05.
  - Tas originalet bort pekar `variantOf` på en hit som inte finns. Gränssnittet klarar det (`HitsView.tsx:911`).
  - `isPlain` i `src/engine/midi.ts:67` räknar den alltid som variant i exportordningen.
- **Var:** `setHitSource` i `src/model/chain.ts:637` nollställer inte `variantOf`. Ingen kod städar `variantOf` när en hit tas bort.
- **Säkerhet:** hög på beteendet, låg betydelse.

(Kända luckor från fas 22 som inte testades igen: `addVariant` utan pad, ny trim utan egen matris och namn vid ny trim. Se `fas-22-sammanfattning.md`.)

## Gränssnitt (checklista för fas 23)

- [x] **U1. Enter i Bars-fältet hoppar över omnumreringsdialogen och gör en ny trim — hög.**
  - **Gjort:** I Slice, med slice 05 och 09 spelade av kopior, skrev jag 2 i Bars och tryckte Enter.
  - **Väntat:** Dialogen New trim / Renumber frågar.
  - **Hände:** Ingen dialog syntes. Det blev direkt en ny trim (trim 3, 2 takter) och matrisen flyttade dit (Undo: "add sample Amen-break"). Med Tab i stället för Enter kommer dialogen, med fokus på New trim.
  - **Var:** `SliceView.tsx:284–287` (Enter anropar `commitBars`, sedan kommer blur) och `RenumberDialog.tsx:50` (`autoFocus` på New trim). Samma Enter, eller blur-commiten, verkar svara i dialogen.
- [x] **U2. Tangenterna 1–7, mellanslag och Ctrl+Z fungerar inte när en kryssruta eller ett reglage har fokus — medel.**
  - **Gjort:** Klickade på Ignore mods i Loops och tryckte 3.
  - **Hände:** Fliken byttes inte. Samma sak gäller efter ett klick på ett reglage (Sensitivity, Volume …), där Ctrl+Z inte ångrar.
  - **Var:** `isTyping` i `App.tsx:34–36` räknar alla `INPUT`, även checkbox och range.
- [x] **U3. × i paddens hitlista tar bort hitten utan att fråga — medel.**
  - **Väntat:** Delete frågar alltid (spec, Samma sak ser likadan ut).
  - **Hände:** Hitten försvann direkt. Ångra-texten säger "remove hit", fast specen säger Delete om det som försvinner.
  - **Var:** `HitsView.tsx:475`.
- [x] **U4. Drag i Hits-listan når inte mål utanför skärmen — medel.**
  - **Gjort:** Försökte dra snare_01 (längst ner i listan) till Amens pad 07 med 64 pads utfällda.
  - **Hände:** Det gick inte i ett vanligt fönster (1920×880), eftersom listan inte scrollar under draget. Det fungerade först i ett 2500 px högt fönster.
- [x] **U5. Slice listar bara slicade trims och trims markerade Slice — låg.**
  - **Väntat:** Spec: "listas alla trims … de som inte är slicade står med 'not sliced'".
  - **Hände:** Snares och Amen trim 2 syns inte.
  - **Var:** `SliceView.tsx:83`.
- [x] **U6. Slice: vald slicning och text stämmer inte — låg.**
  - Efter Ctrl+Z från Transients står Transients kvar som vald fast texten säger "equal 1/16". Valet är lokalt state, se `SliceView.tsx:65,144`.
  - Med Transients vald står det "own markers" (`SliceView.tsx:292`).
- [x] **U7. Trimmens ▶ i Import och Play i headern spelar samtidigt — låg.** De är två oberoende uppspelningar. Headerns Stop stoppar inte "Stop trim", och headern visar Play medan trimmen spelar.
- [x] **U8. Första nya matrisen heter "Matrix 7" — låg.**
  - **Väntat:** Matrix 1, Matrix 2 … (spec, Hits).
  - **Var:** Numreringen börjar på antalet matriser + 1, se `HitsView.tsx:208`.
- [ ] **U9. Namn kortas så att de inte går att skilja åt — låg.**
  - "snare_0…" och "Amen-br…" i Hits-listan och i hyllans One-shots.
  - "AMEN-BR…" i Slice.
  - "M…" i Mods-listan.
  - Loopnamnen bryts över två rader i Loops-listan (`sort-02`, `sort-04`, `sort-08`, `sort-09`).
  - **Delvis i fas 23:** Pads, hyllorna och fokusraden kortar namn med … i mitten och visar hela namnet i title, och Slice-listan finns inte längre. Mods-listan och Loops-listan är inte ändrade.
- [x] **U10. En hit från en annan trim visas som "05→Amen-break 1 05" i Hits-listan — låg.** Spec: `→think 07`.
- [x] **U11. En tom pad visas som "02 ·1" i hyllan i Loops — låg.** En tom pad tar inga steg, och matrisens "▸ all 1 bar 3/16" räknar rätt med 0 steg för den.
- [x] **U12. Creates i Import säger "1 hit" för snare_02, vars matrix har 2 pads och 3 hits — låg.**
- [x] **U13. One-shot som namn finns kvar — låg** (känt från fas 22, punkt 5):
  - "(one-shot)" i Replace-listan.
  - Gruppen "One-shots".
  - Knappen "Make one-shot".
- [x] **U14. Ångra-texter som inte säger vad som hände — låg:**
  - Slicning, flyttade markörer och Renumber: "change sample Amen-break".
  - New trim och REX-import: "add sample …".
  - Import .zip: "change 6 samples".
  - Kopia av en pad: "change matrix snare_02 1".
- [x] **U15. Efter Delete matrix öppnas pad 01 i en annan matrix (Amen-break 1) — låg.**
- [x] **U16. Song: körfälten saknar etiketter (Main, Fill, Mod A, Mod B) — låg.** Tidslinjens ruta är också bredare än körfälten (`sort-10-song.png`).
- [x] **U17. "New snapshot" i headern har primärfärg även när den är avstängd (utan projektmapp) — låg.**
- [x] **U18. Mods utan någon mod: Play fortsätter spela en loop — låg/fråga.** Specen säger att uppspelningen stannar när fliken inte har något att spela (`subject.ts:61–66` spelar den första loopen).
- [x] **U19. Delete trim på en fils sista trim säger inte att filen går med — låg.** Dialogen listar matrix, pad och hits, men filen försvinner också (spec: "En fil går med sin sista trim").
- [x] **U20. Renumber-dialogen är svår att läsa när pads har samma namn — låg.** Se M2, och skärmbild `sort-06-renumber-dialog.png`.

## Konsolen

Inga fel och inga varningar under hela sessionen: import, Slice, Hits, Loops, Mods, Song, Project, exporter, zip, snapshots och omladdning. Det enda som loggades var React DevTools-tipset (info) och Vites "server connection lost" från en äldre flik på port 5199.

## Det som fungerade (kort)

- **Import:**
  - Flera WAV i ett steg, New trim med Start/End ms och Slice/Don't slice.
  - Don't slice på en slicad trim (dialogen räknar upp vad som går, ångra återställer allt).
  - Delete trim och Delete file med ångra.
  - REX2: 10 slicer, 1 takt och loop i ett ångra-steg. En trasig REX gav felet "ErrorCorrupt.rx2: Damaged REX2 file".
- **Slice:**
  - Takter + 1/16 gav 64 pads och en loop.
  - Add, Delete och nudge av markörer och Make one-shot.
  - Dialogen New trim / Renumber: Escape och klick utanför avbryter, Renumber och New trim gör som specen säger, och ångra återställer.
  - Grid 1/8 ↔ 1/16 och Transients.
- **Hits:**
  - Drag av hit, pad och matrix till pad och matrix ger kopior.
  - + New matrix, namnbyte, + Pad, + Hit, Round robin, Variant, Replace…, Clone matrix (öppnas, "copy"-namn, ingen trim eller loop), Delete pad och Delete matrix med frågor.
  - Play matrix för alla matriser.
- **Loops:**
  - Utläggning av en matrix (pads efter varandra med rätt längd), en pad på ett steg, medlemslås och Ignore mods.
  - Medlemmen faller tillbaka på 1 när den tas bort.
  - Swap matrix: rad N → rad N, och raderna efter den nya matrisens sista töms.
  - Uppspelning och klick i hyllan.
- **Mods:** En mod med Ratchet, Pad member, Reverb och Swap.
- **Song:** Loopar och mod dragna till Main, Fill och Mod A, och uppspelning.
- **Project:**
  - Export WAV (13,44 s = 8 takter + svans, 44,1 kHz / 24 bit), MIDI + slices med reverb-delay.wav, och MIDI + REX.
  - Export och import av .zip, med samma tillstånd efteråt.
  - Säkerhetskopior listas.
  - Snapshots (New, New snapshot, Load med frågan om ändringar, Play). Projektmappen var en OPFS-mapp, eftersom webbläsarens mappväljare inte går att styra från Playwright.
- **Ångra och gör om** över alla flikar, Back och Forward mellan flikar, och omladdning (autosparen återställer allt).

## Inte provat

- Ljudet med öron: renderingen kontrollerades bara genom att Play/Stop växlade och att exporternas längder stämde.
- WAV med cue-markörer och AIFF.
- Drag av filer till Import (Browse användes).
- Klippredigering i Song (flytta, ändra längd, Ctrl+C/V/D, loopområde).
- Tape och Slip.
- Restore av säkerhetskopia.
