# Breakseq – spec v1

Oct 14, 2026 · @Magnus

## Översikt

Breakseq är en webbapp som gör drill n bass-breaks av ett uppklippt break, till exempel Amen. Man bygger loopar av pads, placerar dem i en låt och låter mods förvränga dem. Resultatet exporteras som WAV och färdigställs i en DAW; appen gör bara breaks, inte bas eller annat.

Designprinciper:

- **Ett sätt att jobba.** Varje sak skapas och redigeras på exakt ett ställe, i en pipeline med sex vyer.
- **Iterativt.** En iteration går igenom de steg den behöver, inte alla varje gång.
- **Render först.** Ljudet räknas fram offline och spelas upp som en färdig buffer. Uppspelning och export är samma sak.
- **Ny slump varje rendering.** Varje rendering är en ny tagning; den loopar oförändrad tills man renderar igen.
- **Motor skild från GUI.** Motorn är en ren modul som kan flyttas till en plugin senare.
- **GUI på engelska.**

## Datamodell

Allt pekar nedåt i en enda kedja: ett steg spelar en pad, en pad väljer en hit, en hit spelar ett sample, och ett sample är en trimmad fil eller en slice av den. Ordlistan är **Sample → Hit → Pad → Matrix**. Alla objekt har fasta id:n som aldrig ändras, oavsett ordning eller namn.

```
fil     1→n    trim
trim    1→1/n  sample   osliced ger ett sample, slicad ett per slice
sample  n→m    hit      ett sample kan spelas av många hits
hit     n→1    pad      (x-led) varje hit sitter i exakt en pad
pad     n→1    matrix   (y-led)
pad/matrix → loop n→1 song
```

| Objekt | Innehåller | Skapas i |
| --- | --- | --- |
| Sample | Ett rått utklipp: den trimmade filen, eller en slice av den. Bara ljud, inga inställningar. En importerad fil behåller sitt namn (amen.wav) och kan ha flera trims, numrerade per fil med fasta namn (amen trim 1, amen trim 2). En trim är ett fönster i filen och vilka kanaler som används (Stereo, Left, Right eller Mono). Trimmen är det som slicas: takterna och markörerna ligger på trimmen, och varje slice är ett sample. Uppklippningen heter efter trimmen (amen slice 1) och byter aldrig namn. | Samples |
| Hit | Spelar ett sample (en slice eller hela trimmen) med egen config: region inom samplet i procent (start, slut), riktning (fram/bak), pitch (halvtoner), volym (dB), pan (−100 % vänster till +100 % höger), fade out (ms), stretch (Off, Fit to tempo eller Factor) med bitlängd (ms) och var bitarna börjar (Sample eller Hit), dist (Off, Drive, Crush eller Decimate, med mängd 0–1), filter (Off, Low-pass eller High-pass, med brytfrekvens och resonans), reverb och delay. En variant är en ny hit på samma sample, sist i samma pad; byts dess sample, eller tas originalet bort, är den ingen variant längre. | Pads |
| Pad | En rad hits i x-led, i ordning, och config för alla sina hits (samma reglage som hitten, utan region). Paden väljer själv medlem: Top (den första), Round robin (nästa varje gång paden spelar, räknat per pad över hela låten i tidsordning), Random eller No repeat (slump, aldrig samma två gånger i rad). En step lock går före en mod, och en mod går före padens val. | Pads |
| Matrix | Pads i y-led (01, 02 …) och config för alla sina pads. En matrix med flera pads är ett break och en med en pad en one-shot: det är en klassificering som visas med en ikon, inget man väljer. Varje trim får en egen matrix, som heter som filen utan ändelse med trimmens nummer (amen 1) och visar trimmen den kommer från som länk. Matrisen kan döpas om, och då följer dess egna pads, hits (amen 1 07) och loop med. En pad heter som matrisen med sin rad (amen 1 07, Snares 02), också en kopia, och döps om till sin nya rad när pads läggs till, flyttas eller tas bort; ett namn man skrivit själv rörs inte. | Samples, Pads |
| Loop | Tagg Main/Fill (bara för gruppering och namn; vilken loop som helst kan ligga i Main- eller Fill-raden), längd i steg om 1/16 (från 1/16 till 16 takter), som väljs i takter, slag och 1/16. Varje steg: pad eller tomt, vald medlem, step locks. | Loops |
| Mod | Namn och effekter, högst en per mål. En effekt verkar på allt under modens klipp i Song. | Mods |
| Song | Längd i takter och klipp i raderna Main, Fill, Mod A och Mod B. Ett klipp har start, längd och offset i steg om 1/16. | Song |

Step locks i v1: vald pad-medlem, ”Ignore mods” och nudge (finns i modellen, alltid 0 i v1).

**Varje hit sitter i exakt en pad**, och varje pad i exakt en matrix. Ett stegs val av medlem pekar på hittens id, inte på positionen i paden.

**Config i tre lager.** En hits config läggs ihop med padens och matrisens där hitten sitter, hit → pad → matrix. Pitch, volym och pan adderas. Varje lager med baklänges vänder riktningen, så en baklänges hit i en baklänges matrix spelas framåt. Stretch multipliceras: en hit på 2× i en matrix på Fit to tempo blir dubbelt så lång som sina steg, och Fit to tempo räknas en gång, oavsett hur många lager som har det. Fade, dist, filter, reverb, delay, bitlängd och var bitarna börjar tas från närmaste lager som har ett eget. Region finns bara på hitten. En hit följer padens och matrisens config där den sitter, inte där den kom ifrån. Tempot för Fit to tempo kommer från hittens sample, alltså trimmen det slicades ur, inte från matrisen: en snare från ett annat break sträcks efter sitt eget tempo.

**Drag ger kopior.** En hit, eller alla hits i en matrix (All hits), som dras till en pad i Pads blir nya hits där, med samma sample och hittens egna inställningar. Padens och matrisens config där kopian kom ifrån följer inte med; den nya platsens gäller. Dras något till en pad läggs alla dess hits sist på paden. **En hit som släpps på en annan hit ersätter den:** den gamla tas bort och kopian hamnar på dess plats, i ett ångra-steg. Ersätta är ett riktigt byte: steg i loopar och mods som låst den gamla hitten spelar kopian. Ersätts en pads första hit kan paden få ny längd, och då flyttas padsen efter, som vid andra ändringar av första hitten. En hit kan inte ersätta sig själv. Ett släpp mellan två hits i samma pad flyttar hitten i stället (se Pads). Ändringar i en kopia rör inte originalet, och tvärtom: det finns ingen koppling efteråt. Vill man att allt följer en matrix lägger man den direkt i Loops. Det enda kopior delar är samplet (se Byten och omräkning).

**En matrix är fri att ändra.** + Pad lägger en tom pad sist, en pad kan flyttas och tas bort med sina hits, och hits kan dras in. Det matrisen innehåller är det som spelas när den läggs i en loop.

**En matrix spelas i padordning**, pad efter pad. Varje pad är lika lång som sin första hit: en slice tar stegen från där den börjar på trimmens grid till där nästa börjar (hamnar två på samma steg kommer bara den första med), och en hel trim sin längd i låtens tempo, avrundat uppåt, minst ett steg. En tom pad tar inga steg. Dras matrisen till en loop läggs paddarna ut efter varandra från steget:

```
pad:     01   02   03
hits:    x-|  x-|  x---
         x    |    x-
loop:    steg 1 (2), steg 3 (2), steg 5 (4)
```

Tas en pad bort flyttas allt efter den fram. Loopar som redan lagts ut ligger kvar som de är.

**Samples lever så länge något använder dem.** Tas en matrix bort går bara dess egna pads och hits; trimmen och matrisens loop ligger kvar. Tas en trim eller fil bort frågar Delete först och listar var den används (se Data, undo och lagring).

## Pipeline och vyer

Appen har sex vyer i arbetsordning: Samples, Pads, Loops, Mods, Song och Project, nåbara via flikar och tangenterna 1–6. Varje vy har ett ansvar; från andra vyer länkar man dit, men redigerar aldrig där. Tangenterna 1–6, mellanslag och Ctrl+Z fungerar också när en kryssruta, en radioknapp eller ett reglage har fokus; bara textfält, sökfält, nummerfält och listval räknas som att man skriver. När en dialog är öppen (som + New matrix) går tangenterna till dialogen: mellanslag kryssar i en kryssruta, siffror byter inte flik och Ctrl+Z ångrar inte under den, och Escape stänger den.

1. **Samples** – här klipper man: filerna och deras trimmar, kanal, takter, markörer och slicing. Ingenting låter annorlunda av det man gör här. Filtabellen ligger överst och den valda trimmens vågform och slicing under den (Slicing), på samma sida, så att en fil importeras och slicas utan att man byter flik.

   **Filerna.** WAV/AIFF eller REX2 (.rx2) släpps på ytan överst eller väljs med Browse files. Varje fil får en trim med en egen matrix med en pad och en hit (en one-shot). Varje fil är en grupp med en rad per trim: filens namn står bara på den första raden, med en papperskorg som tar bort hela filen med alla dess trims, ▶ som spelar hela filen en gång (■ stoppar) och en beskärningsikon med plus (New trim) som gör en ny trim av samma fil på en egen rad, utan att filen importeras igen. Ett långt filnamn kortas med … i mitten, och hela namnet syns när man håller musen över det. Ett klick på en rad väljer trimmen och visar den under tabellen; den valda raden är markerad. Kolumnen Trim har trimmens nummer (ett klick väljer den) och, bredvid varandra, en papperskorg som tar bort trimmen (Delete trim) och en beskärningsikon som öppnar och stänger dess Trim. Delete trim på en fils sista trim säger att filen går med. Type har Slice och Don't slice, och en trim som inte är slicad står med "not sliced". Creates säger vad trimmen gör, med länkar: 64 Slice ↓ (antalet slices; länken visar slicingen under tabellen), 64 pads, 64 hits Pads → (antalet pads och hits i trimmens matrix, som öppnas i Pads i fokus), N Loops → (hur många loopar som spelar trimmens pads, den egna först; länken öppnar den egna) och ♪ Song när den hörs i låten. En trim som inte ska slicas visar sin matrix på samma sätt (1 pad, 1 hit Pads →). Musen över en länk visar namnet på det den öppnar. Trim stängs med sin ikon eller med ett klick utanför den (utom i headern och på tabellens knappar, som gör sitt: Trim-ikonen på en annan rad öppnar den raden). Slice skapar ingenting och gissar ingenting: Creates visar Create Slices ↓, som väljer trimmen och visar den under tabellen, där den slicas. Don't slice på en trim som bara är markerad Slice tar tillbaka markeringen. Är trimmen redan slicad frågar Don't slice först, i samma dialog som Delete (Don't slice amen 1?), och räknar upp vad som går: alla pads utom 01 i trimmens matrix med sina hits, och dess loop, och var de används (där blir det tyst). Pad 01 och dess hit blir kvar och spelar hela trimmen. Ctrl+Z ångrar. En WAV med cue-markörer importeras markerad Slice, inte slicad; markörerna sparas och erbjuds i slicingen. En REX2-fil (.rx2, från ReCycle) importeras redan slicad, i ett ångra-steg: filens slicer blir markörer (även de som är avstängda i filen), takterna kommer från filen och avrundas uppåt till hela takter, och matrisen och loopen skapas som när man slicar själv. Ljudet är loopens vågform från filens loopstart (eller dess första slice, om den börjar före, som REX-SDK:n spelar den) till loopslut, i filens samplerate; en loop som inte är hela takter fylls ut med tystnad i loopens eget tempo. Filen känns igen på sitt innehåll, inte bara på ändelsen. Filen läses i webbläsaren med en TypeScript-version av läsdelen i VelociLoops (Unlicense). En trasig eller okänd fil ger ett fel i Samples. Äldre REX (.rex) och ReCycle (.rcy) läses inte. Start och slut trimmas per trim; trimningen är ett fönster i originalfilen. I samma Trim-editor väljs kanal: Stereo (som filen är), Left eller Right (den kanalen i både vänster och höger) eller Mono (L+R, medelvärdet i båda). Allt spelas i stereo: en monofil har samma ljud i båda kanalerna. Trimmens ▶ är Play i headern (se Uppspelning), och spelar den syns spelhuvudet i Trim. En trims takter sätts i slicingen när den slicas och kan ändras där efteråt; BPM räknas fram ur den trimmade längden, och ett tempo under 60 eller över 200 BPM ger en varning. Innan trimmen är slicad visar Length bara längden. Ett dubbelklick på en rad som inte ska slicas öppnar dess matrix i Pads.

   **Slicing.** Under tabellen visas den valda trimmen (den första, tills man väljer en annan). Markörer placeras när som helst. En trim som inte är slicad visar sin vågform, ett tomt fält för takter och hur den ska slicas: Cue markers (bara om filen har cue-markörer inom trimmen, och då förvald), 1/4, 1/8, 1/16 eller Transients. Ingenting skapas förrän både takter och sätt är valda; då skapas slices, pads och loopen i ett ångra-steg. Cue markers finns sedan kvar bland valen för en slicad trim. Det valda sättet följer markörerna, också efter ångra: Transients så länge markörerna är de som hittades, annars Cue markers eller det lika grid som markörerna stämmer med, och annars inget av dem. Länken ← Trim öppnar trimmens Trim i tabellen. Rubriken är slicens namn (amen slice 1), och under den står länkarna i kedjans ordning, bakåt till vänster och framåt till höger: ← File (visar filens rad i tabellen), ← Trim, Pads → (öppnar matrisen i Pads i fokus) och ♪ Song → när den hörs i låten. Inga namn står bland länkarna; de syns när man håller musen över dem. *(Magnus beslut; ändras inte utan att fråga.)* Play sample spelar den trimmade filen, med Loop till vänster. New matrix from slice gör den markerade slicen till en egen matrix: en ny trim av filen över just den slicen, med en matrix med en pad, medan trimmen blir som den är; sedan visas "Made the matrix … Pads →". Equal grid (1/4, 1/8, 1/16, där 1/16 är standard: 64 slices för fyra takter Amen) är startpunkten; markörerna kan sedan flyttas, läggas till och tas bort. Vågformen visar slicesen med sina nummer, och ett klick på en slice väljer den och spelar den (och stoppar Play i headern). Under vågformen visas en rad med 1/16-steg som i Loops: varje slice står i steget där den hamnar när trimmens matrix läggs i en loop, i en låda fram till nästa slice eller slutet, och svaga 1/16-linjer ligger över vågformen. Hamnar två slices på samma steg markeras steget rött, eftersom den andra då inte kommer med.

   Flyttas en markör slår det igenom direkt i allt som spelar slicen. **Ändringar som byter numrering frågar först:** läggs en markör till eller tas bort, eller byts grid, takter eller transienter, så att slices får nya nummer eller försvinner, och någon slice som byter nummer eller försvinner spelas av mer än en hit (varianter och kopior räknas lika, var de än ligger), frågar en dialog i appens stil: "You use slice 07, 09 in: pad amen 1 07 and pad Snares 01. Make a new trim and sample for this?" med knapparna New trim och Renumber. Paddarna står med matrisens namn och sin rad, vad de än heter. Escape eller ett klick utanför avbryter, och då ändras ingenting, inte heller valet i vyn. *New trim* lämnar den gamla trimmen som den var och gör en ny trim av filen med ändringen (nästa lediga nummer, samma fönster, kanal, cues och takter). Matrisen man slicar flyttar dit med sina hits och sin loop; kopior i andra matriser spelar kvar den gamla. Samples visar sedan den nya trimmen, och den gamla står kvar i tabellen. *Renumber* räknar slices efter nummer, så det som var 06 blir nya 07 där 07 används. Takterna frågar först när fältet lämnas eller med Enter, och Sensitivity för Transients när reglaget släpps, inte mitt i en ändring. Dialogen ger ingen knapp fokus, så Enter i takterna öppnar den utan att välja något i den.
2. **Pads** – här formar man allt man hör: en matrix i taget, som en tidslinje, med ljud från några utvalda matriser.

   **Fokusraden** överst: Focus väljer matrisen i fokus (med ikon för break eller one-shot), Take from har en knapp per annan matrix som slås på och av, och till höger finns + New matrix och ▶, som gör samma sak som Play i headern och heter efter det valda (Play hit, Play pad, Play matrix). Fokus och Take from är vyns val, inte projektets: de sparas inte i projektet och går inte att ångra. Samma fokus gäller i Loops. Tas matrisen i fokus bort, eller ångras den bort, är ingen matrix i fokus, och en borttagen matrix försvinner ur Take from. Matrisen i fokus tar man inte från: sätts en matrix man tar från i fokus syns den varken under Take from eller på hyllan (i Loops bara en gång, som matrisen i fokus), och den kommer tillbaka där när fokus flyttas till en annan matrix. Utan fokus ber Pads om en matrix, och utan matriser länkar den till ← Samples.

   **Matrisens rad** under fokusraden: en knapp med matrisens ikon och klassificering (break eller one-shot) som väljer matrisen, namnet (går att ändra; ett tomt namn ger fel först när man lämnar fältet eller trycker Enter, och då står det gamla namnet kvar), ♪ Song, ← Samples (för en matrix som kommer från en trim; öppnar trimmen i Samples), + Pad (en tom pad sist, som blir vald), Clone och Delete matrix. Clone kopierar hela matrisen med egna pads och kopior av alla hits; kopian heter som matrisen med "copy" efter (amen 1 copy), har ingen trim och ingen loop, hamnar i fokus och är sedan helt fristående. Delete matrix frågar först och räknar upp vad som går med (antal pads och hits) och var dess pads används (i en annan loop, eller dess loop i Song); kopior på andra ställen räknas inte. Trimmen och matrisens loop blir kvar, och efteråt är ingen matrix i fokus.

   **Tidslinjen** visar padsen efter varandra i tid, var och en lika bred som den spelar (se En matrix spelas i padordning), med 1/16-steg, slag och takter i bakgrunden; en tom pad är smal och randig. Varje pad har sitt nummer överst (och ♪ om den hörs), den första hittens vågform och sina hits nedåt, där den första är markerad. Zoom: Fit visar hela matrisen i rutans bredd, och 1 bar visar en takt per bredd. Ingen kolumn blir smalare än 24 px; får inte allt plats scrollar tidslinjen i sin egen ruta, aldrig sidan i sidled. En kolumn som är för smal för hitsens namn visar bara numret och vågformen, och dess hits syns i 1 bar eller när paden är vald. Padens val (Top, Round robin, Random, No repeat) står på paden i 1 bar och när den är vald. En hit visas med sin rad (07), som `15→07` när den spelar en annan slice än sin rad, och som `→think 07` när den kommer från en annan trim; i en matrix utan trim visas hittens namn. Långa namn kortas med … i mitten, och hela namnet syns när man håller musen över det. Spelar Play matrisen går spelhuvudet över tidslinjen.

   **Reglagen** under tidslinjen gäller det som är valt. Ett klick på en hit väljer den och spelar den, ett klick på padens nummer väljer paden, och matrisens knapp väljer matrisen.
   - *Hit:* namnet (går att ändra), ♪ Song, vilken slice den spelar och Replace…, som byter till en annan slice eller ett annat sample (med The whole sample för hela trimmen) och behåller hittens inställningar och region, Variant (en ny hit på samma sample, sist i paden), Delete hit, hittens region på vågformen med handtag och fälten Start ms och End ms, och reglagen: riktning, pitch, volym, pan, fade, stretch, dist, filter, reverb och delay. Ett reglage visar vad som kommer från lagren ovanför.
   - *Pad:* namnet, vilken rad den är, ← och → som flyttar paden en rad i tidslinjen, Pad plays (Top, Round robin, Random, No repeat), padens hits med ▶, ↑ och ↓ per hit, + Hit (en kopia av en hit läggs sist; med sökfält), en hopfälld Pad sound med padens config, samma reglage som matrisens, och Delete pad, som tar paden med dess hits.
   - *Matrix:* matrisens config, samma reglage som hitten utan region, lagda över alla dess pads.

   Delete på en hit, en pad eller en matrix frågar alltid först.

   **Take from** är en hylla under tidslinjen med varje matrix man tar från: namnet, All hits och dess hits, pad för pad. Hyllan scrollar i sin egen ruta. Ett klick på en hit där spelar den.

   **Drag och släpp** (se Drag ger kopior). En hit eller All hits dras från hyllan, eller en hit från en pad i tidslinjen:
   - Släpps den på en pad (padens nummer eller den tomma ytan under dess hits) läggs en kopia av varje hit sist i paden. En pad på Top som då får mer än en hit byter till Round robin, i samma ångra-steg.
   - Släpps en hit på en annan hit ersätter den den (se Drag ger kopior), och kopian blir vald. All hits som släpps på en hit läggs sist i den hittens pad.
   - Inom samma pad flyttar ett släpp mellan två hits (den övre eller nedre delen av en hit) hitten dit, också till första plats, och ett släpp på padens tomma yta flyttar den sist. Ordningen styr Top och Round robin. Ett släpp mitt på en annan hit i samma pad ersätter den. Drag från en annan pad, också i samma matrix, ger alltid en kopia.
   - Under draget syns vad som händer: "add" på paden, "replace" på hitten, eller en linje där hitten hamnar. Tidslinjen, hyllan och sidan scrollar när man drar nära kanten.

   **Med finger eller penna** trycker man på en hit eller All hits i hyllan, så är den vald (en rad visar vad som är valt, med Cancel), och sedan på en pad (lägg till) eller en hit (ersätt). Valet används en gång. Escape, ett nytt tryck på samma hit eller ett tryck utanför padsen och hyllan avbryter, och ett tryck på en annan hit i hyllan väljer den i stället. Med mus spelar ett klick i hyllan bara hitten.

   **Tangentbordet:** ←/→ byter pad (från matrisen till första eller sista paden; de stannar vid ändarna), ↑/↓ går genom padens hits (↑ från första hitten går tillbaka till paden), och varje steg spelar det valda: en hit sig själv, en pad som den väljer. Enter väljer matrisen, Delete eller Backspace frågar som Delete-knappen, och mellanslag är Play/Stop. Står fokus på en pads eller en hits knapp i tidslinjen stegar pilarna från den, inte från det valda, och fokus flyttar med till det nya valet. Tidslinjen är ett enda tabbstopp: det valda, eller första paden. Tangenterna går inte till Pads när man skriver i ett fält, står på ett reglage, håller Ctrl, Alt eller Cmd, eller har en dialog öppen.

   **+ New matrix** öppnar en dialog med ett namn (Matrix 1, Matrix 2 …, det första lediga numret) och en lista över de laddade one-shots (matriser med en pad) med deras hits, med en kryssruta och ▶ per hit; ▶ spelar ljudet. Create gör en matrix med en pad, där varje ikryssad hit läggs som en kopia med sina inställningar. Med fler än en hit väljer paden Round robin, med en Top. Utan kryss blir det en tom matrix med en tom pad. Den nya matrisen hamnar i fokus. Listan används bara när matrisen skapas; senare läggs fler till med drag eller + Hit, utan koppling till originalen. Ett tomt namn går inte, och Escape avbryter.
3. **Loops** – placera pads och matriser på steg, välj medlem per steg och sätt step locks. Överst finns samma fokusrad som i Pads (Focus och Take from, utan ▶), och ändras fokus här ändras det också i Pads. Ett steg låter antingen paden välja ("The pad picks", förvalt) eller låser en medlem, även medlem 1. En matrix i en loop kan bytas mot en annan ("Matrix amen 1 → swap for…"): varje steg som spelar rad N i den gamla spelar rad N i den nya, och ett steg vars rad den nya saknar töms. Matrisens namn där öppnar den i Pads. Varje hit visas som en låda från sitt steg fram till nästa hit eller loopens slut, hur länge ljudet än klingar; en låda över radens slut fortsätter på nästa rad. Stegen i lådan är tomma och går att klicka och släppa på, och det som läggs där kortar lådan. Hyllan visar matrisen i fokus och de man tar från, i den ordningen, var och en med ikon och namn; utan fokus ber den om en. Varje knapp i hyllan visar hur många 1/16 den tar (`07 ·2`; en tom pad visar ingen längd), och varje break har en knapp för hela matrisen (`amen 1 ▸ all` med dess längd). Medan något dras över stegen visas en streckad låda där det hamnar och vad det skriver över. En matrix som släpps på ett steg lägger ut sina pads efter varandra från steget (se En matrix spelas i padordning) och skriver över hela sin längd: steg där ingen pad hamnar töms. Ett dubbelklick på en matrix eller en pad i hyllan öppnar den i Pads. Ett klick på en knapp i hyllan väljer den och spelar den: en pad sin första hit, en matrix en gång som den läggs ut i en loop. Build pads → öppnar Pads.
4. **Mods** – bygg mods.
5. **Song** – en tidslinje med 1/16-rutnät. Loopar och mods läggs ut som klipp, som flyttas (Ctrl kopierar, Alt också) och ändras i längd från båda kanterna. Ett markerat klipp kopieras med Ctrl+C och klistras in med Ctrl+V där spelhuvudet står, i klippets rad. Ctrl+D lägger en kopia direkt efter klippet, och kopian blir markerad. Ett klick i linjalen flyttar spelhuvudet dit: Play startar där, och spelar låten hoppar den dit. Stop går tillbaka dit. Ett drag i linjalen markerar ett loopområde. Områdets ändar har var sitt handtag, som i Trim: en linje över hela tidslinjen med en kloss överst, som dras eller flyttas med ←/→ (Shift: ett slag). När området är på skuggas det som ligger utanför, som i Trim. Knappen Loop slår av och på området. När det är på spelar Song från startpunkten in i området och sedan området om och om igen. När det är av loopas hela låten. Området sparas i projektet och går att ångra, men exporten tar alltid hela låten.

**Automatisk kedja.** Varje importerad fil, och varje ny trim, blir en trim med en egen matrix: en one-shot med en pad och en hit som spelar hela trimmen (amen 1). När trimmen slicas blir den matrisen den slicade: pad 01 blir första slicens rad, och matrisen får en pad per slice (amen 1 01, amen 1 02 …), var och en med slicens hit. Första gången får trimmen också en loop med matrisens namn (amen 1), som spelar paddarna i ordning, var och en på närmaste 1/16 (hamnar två på samma steg kommer bara den första med). Loopen skapas en gång. Så länge den är exakt som matrisen lade ut den följer den med när takterna eller markörerna ändras i trimmen eller i en annan trim som matrisens pads spelar (också när den slutar vara slicad), och när matrisen ändras i Pads (pads läggs till, kopieras, flyttas eller tas bort, och hits ersätts eller ändras så att en pad blir längre eller kortare). Loopen är alltid hela takter: blir matrisen längre än trimmens takter avrundas loopen uppåt till hela takter, högst 16 takter, och pads efter slutet kommer inte med. När man har ändrat i den själv rörs den aldrig. Andra loopar ligger kvar som de lades ut. Matrisens rader följer markörerna: blir det fler slices får matrisen en ny pad sist för varje ny slice som ingen av dess pads spelar. En rad man själv har tagit bort kommer inte tillbaka när markörerna ändras, och pads man lagt till själv är inga rader.

**Byten och omräkning.** En hit spelar en slice efter nummer: slice 05 är alltid trimmens femte slice. Samplet är det enda kopior och varianter delar: flyttas en markör ändras slicens ljud i alla hits som spelar den, även kopior och varianter i andra matriser. Läggs en markör till eller tas bort räknas alla slices om, och om det byter nummer på en slice som mer än en hit spelar frågar Samples först (se Samples). Blir det färre slices blir hits på de sista tysta där de spelas (paddarna visas nedtonade, och i hyllorna bara så länge en loop spelar dem), och blir det fler dyker de nya upp som pads i trimmens matrix. En hits region är i procent av dess slice och följer med när slicen ändras. Att byta trim eller fil under en matrix går inte; matrisen visar vilken trim den kommer från. Undo och snapshots är skyddsnätet.

**Samma sak ser likadan ut.** Samma funktion ser ut och fungerar likadant i alla flikar:

- *Vågformer* har samma färg, och alla visar spelmarkören när det de visar spelar. I Pads går markören genom hittens region, och spelar matrisen går spelhuvudet över tidslinjen; spelar paden visas ingen markör, eftersom det inte är givet vilken hit som låter. I Samples går den genom trimmens vågform när trimmen eller dess matrix spelar.
- *Start och slut* ställs med samma handtag i Trim, Pads (hittens region) och Song (loopen): dra, eller fokusera och använd ←/→ (Shift: 10 ms, i Song ett slag). Trim och Pads har dessutom fälten Start ms och End ms. Utanför regionen är det lika mörkt överallt.
- *Spela* är en ▶/■-knapp. Där det finns ett val (Play sample i Samples) har den en Loop-knapp direkt till vänster; Loop är en enda knapp som slås på och av och ser ut som Loop i Song, och avslagen spelar det en gång. Knappen heter Play eller Stop och vad den spelar (Play matrix, Stop sample). Ordet Preview används inte.
- *Knappar* är 44 px för handlingar som står för sig själva, och 36 px i rader, listor, tabeller och segment (även chips och små ikoner).
- *Delete* betyder att något försvinner, och *Remove* att det tas ur något (Remove på en effekt i en mod). Delete pad, Delete hit, Delete loop, Delete mod, Delete matrix, Delete trim och Delete file ser likadana ut, som text eller som papperskorg i täta rader: man får alltid en fråga, i en dialogruta i appens stil med Cancel och Delete (Escape avbryter), som räknar upp vad som går med (för en one-shot: 1 pad, 1 hit) och var det används, och tar man bort det ändå blir det tyst där det användes (steg med paden töms, hitten lämnar sin pad och step locks, paden lämnar sin matrix, loopens och modens klipp lämnar Song).
- *Länkar och knappar*: att hoppa till en annan flik är en textlänk med pil (← Samples, Pads →, Loops →), på raden under rubriken där det finns en. En länk med pil nedåt eller ← Trim i Samples visar något på samma sida (Slice ↓, Create Slices ↓). Knappar ändrar något.
- *Rubriken* är namnet på det som är valt (amen slice 1, amen 1 01, M1); en flik utan val har fliknamnet.
- *Slices* heter "slice" med två siffror överallt (slice 01, Marker 01, Plays slice 01 of amen trim 1).
- *Sidomenyerna* i Loops och Mods har samma ordning: rubrik, + New …, listan, sedan eventuell extra sektion. Pads har ingen sidomeny, utan fokusraden.
- *Reglage* ser likadana ut överallt: etikett och värde ovanför. Sifferfält har etiketten till vänster och samma höjd.
- *Hörs i låten*: det som hörs i Song, hela vägen ned (loopen ligger i Song, paden på ett steg i den, hitten i paden, matrisen genom paden, och trimmen i Samples genom hitten), har "♪ Song →" vid sitt namn, och ett klick öppnar Song. I sidomenyerna står ett ♪ vid det som hörs. Det som bara hörs för att en mod byter till det (Swap, Pad member) räknas inte, eftersom det ofta beror på slumpen. Annars visas inte var något används; Delete säger det när det behövs.
- *Siffror*: längder står i ms, tempo med två decimaler, och takter som "1 bar" och "2 bars".
- *Huvudet* är detsamma i Loops och Mods: namnet, under det en rad med info, länkar och inställningar, och knapparna till höger.
- *Headern* (BREAKSEQ, flikarna och transporten) står alltid kvar överst när sidan scrollar.
- *Webbläsarens Back och Forward* går mellan flikarna: varje flikbyte är ett steg, och fliken man kommer tillbaka till visar det som var öppet där (hit, pad, loop, mod, vald trim och öppen Trim i Samples). Fokus och Take from är inga steg. Ändringar inom en flik är inga steg, och ångra (Ctrl+Z) är skilt från Back.
- *Hjälptext* står inte i rubriker; rubriker är namn ("Pads", "Loops and mods"), och hjälpen står i en liten grå rad sist i sin panel. Ett tomt läge länkar till fliken där man gör det som saknas (← Samples, ← Loops, ← Mods).
- *Av och på* (Loop i Song) markeras som ett valt segment.
- *Knappar säger vad de gör*: −1 ms och +1 ms flyttar en markör; pilar betyder att man hoppar till en annan flik. New example ritar om ett exempel i Mods, New take slumpar om det som spelas i Song.
- *Chips*: länkchips har accentfärg, och bara det som går att dra har dra-markören.
- *Spelknappar i flikar* finns bara där det inte är klart vad Play i toppen spelar.

**Biblioteksraden.** I Pads, Loops och Song finns en rad att dra från: hits ur matriserna man tar från i Pads (Take from), pads och matriser ur matrisen i fokus och de man tar från i Loops, och loopar och mods i Song. Man drar därifrån för att använda, aldrig för att redigera.

## Motor

Motorn består av två delar: en händelsegenerator som räknar fram triggers, och en renderare som gör ljud av dem. Generatorn är en ren funktion utan DOM- eller ljudberoenden, och slumpen injiceras så att den går att testa.

**Händelsegeneratorn** tar Song, alla objekt och en slumpkälla, och ger en lista av triggers. Varje trigger har: tid i sekunder, takt och steg (för spelhuvudet), hit-id, samt slutlig pitch, volym, riktning och region. För varje takt:

1. Det aktiva lagret väljs per steg: ett Fill-klipp går före ett Main-klipp, och där inget klipp ligger är det tyst. Ett klipp spelar sin loop från `offset` och börjar om loopen när den tar slut; steget i loopen är `(t − start + offset) mod looplängd`. Under ett Fill-klipp spelar fillen även sina tysta steg, och Main räknar vidare så att den är i takt efteråt. Ett släppt klipp får loopens egen längd (en mod får 1 takt). Att dra vänsterkanten trimmar början och flyttar offset. Klipp i samma rad överlappar inte: ett nytt eller flyttat klipp kortar, delar eller ersätter det som ligger under.
2. För varje steg i det lagret ger paden och stegets valda medlem en hit; utan val spelas medlem 1.
3. Mods från raderna A och B tillämpas på stegen (se Mods). Steg med ”Ignore mods” hoppas över.
4. Varje steg blir en eller flera triggers (fler vid ratchet), placerade på tidslinjen.

**Renderaren** spelar triggers i en `OfflineAudioContext` och ger en ljudbuffer. All uppspelning sker på en röst: en ny trigger klipper den föregående med en kort fade (ca 2–5 ms) så att det inte klickar. Baklänges-versioner av samples förberäknas en gång.

Samples behåller stereo. Tempo ställs per låt i BPM. En ny låt börjar på 170 BPM och 8 takter. Pitch ändrar uppspelningshastigheten och därmed längden, vilket är avsiktligt.

## Mods

En mod har ett namn och effekter, högst en per mål. En ny mod har inga effekter och gör ingenting förrän man lägger till en. En stegeffekt är ett mål, en rate och en form; slump är bara en av formerna. Tape är en effekt som arbetar på ljud (se Tape). Mods byggs i Mods-vyn och placeras i raderna A och B i Song; en mod i en takt verkar på det lager som hörs i den takten.

| Fält | Val i v1 |
| --- | --- |
| Mål | Swap (Stack eller Shuffle), Pad member, Pitch (halvtoner), Volume (dB), Pan (−100 till +100 %), Direction, Ratchet (1–8), Stretch (faktor, bitlängd i ms, Multiply eller Replace), Dist (läge; värdet är mängden 0–1), Filter (typ och resonans; värdet är brytfrekvensen i Hz), Reverb (storlek; värdet är mängden i %), Delay (tid och feedback; värdet är mängden i %), Tempo (slip), Tape |
| Rate | Per steg, per beat, per bar. Värdet hålls över intervallet och gäller alla triggers i det. |
| Form | (Alla mål utom Swap och Tape.) List (värden i tur och ordning, ett per intervall), Cycle (stegar genom värden eller medlemmar), Ramp (från–till över modens längd), Random (slumpvärde inom ett intervall, med chans i %; för pitch hela halvtoner eller fritt, förvalt halvtoner) |

**Samverkan.** När A och B rör samma mål adderas numeriska värden (pitch, volym, pan), och för lägesvärden (riktning, medlem, ratchet, stretch, dist, filter) vinner B. Mods läggs ovanpå hitten och stegets locks.

**Ordning.** Mods tillämpas i fast ordning efter mål, oavsett rad:

1. Swap
2. Pad member
3. Ratchet
4. Pitch, volym, pan, riktning, stretch, dist och filter – gäller varje retrigger i en ratchet
5. Tempo (slip)

**Var en mod verkar.** En mod har inget eget omfång: den verkar på allt under sitt klipp i Song. Vilka steg bestäms alltså av var och hur långt klippet ligger.

**Swap** byter hit på steg som har en, utan att ändra rytmen. Den har två lägen, och algoritmen väljs i moden.

- **Stack** väljer bland allt under spelhuvudet: lagren uppifrån och ner (Fill, sedan Main, även när Main inte hörs), och inom varje lager padens hits i ordning. Per intervall (1/16, beat eller takt) väljer den *at random*, *round robin* (en kandidat längre för varje intervall med en hit), *layer by layer, top down* (Fill, Main, Fill … med varje lagers förvalda hit) eller *layer by layer, bottom up* (Main först).
- **Shuffle** blandar hitsen som spelas inom klippet: högen är hitsen på stegen med en hit, och varje sådant steg får en hit ur högen, *like a deck* (varje hit en gång, i slumpad ordning), *freely* (samma hit kan komma igen), *in reverse* eller *rotated by n*. Steg utan hit förblir tysta.

Swap tillämpas före alla andra mål. Har både A och B Swap vinner B.

**Längd.** En mod gäller sitt klipp i Song, på 1/16 när. Varje klipp är en sammanhängande modulation: intervallen räknas från klippets början, och Ramp sträcker sig över klippets längd.

**Ratchet** n delar stegets längd i n lika delar och triggar hitten i varje del.

**Pan** placerar ljudet mellan vänster och höger. Hittens, padens, matrisens och modernas pan adderas och begränsas till −100 % och +100 %. Allt är stereo, så pan är balans med en enda regel: i mitten spelar båda kanalerna som utan pan, och åt höger tonas vänster kanal ner mot noll medan höger blir upp till 3 dB starkare (och tvärtom), så att den upplevda styrkan är densamma (lika effekt).

**Dist och filter** färgar ljudet, i den ordningen: dist först, sedan filter.

- **Dist** har tre lägen och en mängd 0–1. *Drive* är mjuk mättnad som blir hård klippning; *Crush* sänker bitdjupet (16 bitar vid 0, 2 vid 1); *Decimate* sänker samplingsfrekvensen. Dist håller nivån: ljudets genomsnittliga nivå (RMS) är densamma efter dist som före, så att det inte blir tyst och sedan högt.
- **Filter** är Low-pass eller High-pass med en brytfrekvens i Hz och en resonans. Filtret håller inte nivån, för ett stängt lågpass ska låta tunnare, men en hög resonanstopp dämpas så att den inte skjuter iväg.
- **På hitten** (i Pads) gäller dist och filter alltid; på paden och matrisen gäller de hits under dem som saknar egna. **I en mod** ställs läget (dist) eller typen och resonansen (filter) i moden, och List, Ramp och Random ändrar mängden respektive brytfrekvensen. En mod gäller i stället för hittens dist eller filter.

**Reverb och delay** är kast: ett break får plötsligt rymd eller eko en kort stund, eller bara på slumpvisa slag, som en del av breaket. (Reverb över hela låten läggs i Reason eller Digitakt.)

- **Bredvid rösten.** Låten har en reverb och en delay som klingar ut bredvid rösten. Ett slag skickar en del av sitt ljud dit, som det hörs, alltså avklippt där nästa slag klipper det; svansen klipps inte av nästa slag eller av att moden tar slut.
- **Reverb** har en mängd (0–100 %, hur mycket av slaget som skickas) och en storlek från litet rum till stor hall (0,3–4 s). Rummet är brus som klingar av, alltid samma, så samma låt låter likadant varje gång.
- **Delay** har en mängd, en tid i låtens tempo (1/16, 1/8, 3/16 eller 1/4) och feedback (0–90 %, hur mycket av varje eko som kommer tillbaka).
- **På hitten** (i Pads) skickar en hit alltid; mängd 0 på en hit tar närmaste lagers (pad, sedan matrix). **I en mod** ställs storleken (reverb) eller tiden och feedbacken (delay) i moden, och formen ger mängden i procent. En ny Reverb- eller Delay-effekt är ett kast (List 100, för delay 80), så att alla slag under klippet skickas; Random med chans ger kast på slumpvisa slag. Under Start from finns Reverb throw, Delay throw och Random verb. En mod gäller i stället för hittens; när A och B båda skickar adderas mängderna (högst 100 %) och B:s inställningar gäller.
- **Svansen.** I en loop och i låten som spelas runt hörs det som klingar efter slutet i början av nästa varv. Spelas något en gång, och i Export WAV, klingar svansen ut efter slutet, så filen blir längre än låten.
- **Exporten.** MIDI-filen, bit-WAV:en och REX-filen är torra: slagen utan reverb och delay. Har låten reverb eller delay följer en WAV med bara dem (…-reverb-delay.wav), tyst däremellan, från låtens början och så länge de klingar, i samma nivå som bitarna, så att den på ett ljudspår bredvid ger låten.

**Stretch** ändrar en hits längd utan att ändra tonhöjden, som time stretch på gamla samplers: hitten spelas som korta bitar (bitlängden, förvalt 30 ms) som var och en börjar lite längre fram i slicen och läggs över varandra med korta övertoningar. Faktor 2 gör hitten dubbelt så lång, 0,5 hälften så lång; faktorn går från 1/16 till 16 och bitlängden från 5 till 500 ms. Kort bitlängd låter metalliskt, lång mjukare och ekande. Pitch ändrar fortfarande både tonhöjd och längd, så stretch och pitch tillsammans flyttar tonhöjden med samma längd (2× och +12 ger en oktav upp i samma längd).

- **På hitten** (i Pads, bredvid pitch): Off (förvalt), Fit to tempo eller Factor. Fit to tempo stretchar med tempot hos trimmen som hittens sample kommer från delat med låtens, så att slicen håller sin tonhöjd och blir lika lång som sina steg i låten. Ett sample ur en trim som inte är slicad har inget tempo och kan inte Fit to tempo. På paden och matrisen verkar stretch som makro för alla hits under dem och multipliceras med hittens egen (se Config i tre lager).
- **Var bitarna börjar**, ett val på hitten: *Sample* (förvalt) lägger bitarna i ett rutnät från trimmens början, som när en sampler stretchade hela breaket: spelas slicesen i ordning låter det som ett stretchat break, och en slice behåller sina bitar var den än spelas. *Hit* börjar bitarna vid hittens start, vilket ger rena slag.
- **I en mod:** en faktor och en bitlängd, och ett val av hur den möter hittens stretch: *Multiply* (multipliceras med hittens, så att en mod på 2× gör ett break på Fit to tempo dubbelt så långt som stegen) eller *Replace* (modens stretch gäller i stället för hittens). Ramp och Random kan ändra faktorn över tid.

## Tape

Tape spelar in en bit av det som hörs och spelar upp den som ett band, så länge mod-klippet ligger i Song.

- **Segment:** de första Repeat-stegen (1/16 till 4 takter) från där klippet börjar på tidslinjen, även när början är trimmad. Det man ser är det som spelas in. Ett klipp med Tape är minst så långt som segmentet.
- **Inspelning:** det som hörs i segmentet, alltså Main eller Fill med stegeffekterna från A och B, men utan Tape.
- **Riktning:** Framåt, Baklänges eller Pendel (framåt, baklänges, framåt, …). Pendel är förvald.
- **Hastighet:** går linjärt från ett värde till ett annat (0×–4×) över klippets längd, förvalt 1× → 0,25×. Hastigheten ändrar tonhöjd och längd som ett band, och varje varv tar så lång tid som hastigheten ger. Under 1× blir ljudet också tystare i takt med hastigheten, som ett band som bromsas, så 0× är tyst. Låtens tempo ändras aldrig.
- **Ramp over:** hur lång rampen är, från klippets start (förvalt hela klippet). Därefter ligger hastigheten kvar på slutvärdet. Kurvan är Linear, Soft start, Soft end, Hard start (det mesta av ändringen direkt) eller Hard end (håller emot och ändras sist).
- **Wow och flutter:** två reglage, 0–100 %. Wow är långsam, lite oregelbunden svajning i hastigheten (upp till ±25 %), och flutter är snabbt, oregelbundet fladder (upp till ±6 %). Båda ligger ovanpå rampen och slumpas per take.
- **Under klippet** hörs bara tapen. Vid 0× är det tyst. Tapen klipper rösten före sig.
- **Efter klippet** fortsätter det som syns där, på huvudklockan, som efter slip.
- **A och B:** har båda raderna Tape samtidigt vinner B. Tape går före slip-tempo i sitt spann.

## Slip-tempo

En tempo-mod (t.ex. 1/3) låter det aktiva lagret spelas i ett annat tempo medan huvudklockan tickar vidare i bakgrunden. När moden släpper fortsätter allt där det skulle ha varit, som om moden aldrig funnits.

- **Start:** när moden börjar startar ett lokalt spelhuvud på huvudklockans position i det aktiva lagret.
- **Under moden:** det lokala spelhuvudet går i det modulerade tempot (1/3 = stegen kommer tre gånger glesare). Samples spelas i normal hastighet och längd; bara avståndet mellan triggers ändras.
- **Återhopp:** när moden tar slut väntar motorn till nästa hela steg på huvudklockan och fortsätter därifrån.
- **Längd:** ett mod-klipp är en sammanhängande modulation över sin exakta längd, även när det inte börjar på en taktgräns.
- **Pitch** ändras inte av tempo-moden, bara av en pitch-mod.

Spelhuvudet i GUI:t följer triggers, så under en tempo-mod tänds stegen i det långsammare tempot utan specialhantering.

## Uppspelning och export

Allt som spelar mer än ett ljud renderas först; uppspelningen spelar den färdiga buffern i realtid.

Play spelar det som visas i fliken:

| Vy | Vad Play spelar |
| --- | --- |
| Samples | Trimmen vars Trim är öppen, trimmad och loopad (även en one-shot). Annars den valda trimmens matrix som den låter när den läggs i en loop, renderad och loopad, och utan någon sådan låten. |
| Pads | Det som är valt: en hit en gång; en pad i en loop, där den väljer på nytt varje varv (Round robin går hela varv); annars matrisen i fokus som den läggs ut, pad efter pad (med utbytta slices), renderad och loopad. Utan fokus, eller med en tom pad vald, inget. |
| Loops | Den valda loopen, renderad och loopad |
| Mods | Moden på sin loop, renderad och loopad. Utan någon mod finns inget att spela. |
| Song, Project | Hela låten, renderad och loopad |

I Samples är trimmens ▶ i Trim samma sak som Play i headern: de visar samma läge, och den ena stoppar den andra. Play sample i slicingen, ▶ vid en fil och ett klick på en slice spelar direkt vid tryck och stoppar Play i headern, och Play i headern stoppar dem; en sak spelar i taget. I Pads sitter ▶ i fokusraden och gör samma sak som Play i headern. Ett klick på en hit, och ▶ i en pads lista och i dialogen New matrix, spelar en hit en gång. Medan Play spelar i Pads ändrar valet inte vad som spelar: det som spelar fortsätter, och ett klick på en hit hörs ovanpå, en gång. Byts matrisen i fokus under tiden spelar den nya matrisen hel. När uppspelningen har stoppats spelar Play det som är valt. Byts flik under uppspelning startar den nya flikens ljud direkt från början när det är renderat; ändras det som spelar tar den nya renderingen vid där loopen tar slut. Har den nya fliken inget att spela stannar uppspelningen. Play i headern är en enda knapp, som alla andra ▶: den visar ■ och heter Stop medan det spelar. Mellanslag gör samma sak som Play/Stop, i alla vyer, utom när man skriver i ett fält.

- **När det renderas:** automatiskt kort efter varje ändring (debounce), plus en knapp för ny slumptagning utan att något ändrats.
- **Byte under uppspelning:** en ny rendering startar exakt där den gamla loopen tar slut, utan avbrott.
- **Spelhuvud:** renderaren lämnar en triggerlista (tid, takt, steg). GUI:t tänder det steg vars trigger senast passerats. Ingen annan feedback, och mods ändrar inte hur steg ser ut.
- **Export:** görs i fliken Project. Export WAV sparar låten som den är nu, och varje snapshot har egna knappar för att spela och exportera den utan att ladda den; det laddade projektet rörs inte. WAV-filen är 44,1 kHz / 24 bit, normaliserad till −0,3 dBFS. Det som exporteras är exakt det man hör.
- **MIDI och bitar:** bredvid Export WAV i Project exporteras låten som en MIDI-fil och en WAV-fil med bitar, för en sampler som Dr. Octo Rex eller Digitakt. En bit är varje unikt ljud som hörs i låten: samma sample, slice och region med samma pitch, riktning, stretch, volym, pan, fade, dist och filter som de spelas, lagren och mods inräknade. Två kopior som låter likadant är alltså en bit. MIDI-filen är bara noter och låter som låten. Bitarna ligger i trim- och sliceordning (Amen 01, 02 …, sedan varianter och one-shots), en per lika lång ruta: rutan är så lång som den längsta biten, resten av rutan är tyst, och antalet rutor avrundas uppåt till 4, 8, 16, 32 eller 64 så att filen kan delas på ett rutnät. Varje ruta har också en cue-markör. Ett Tape-segment blir en egen bit. Bit 1 är C1 (not 36) och följande bitar ligger en halvton upp; fler än 92 bitar ryms inte och exporten säger då ifrån. MIDI-filen har låtens tempo, och varje not är så lång som ljudet hörs. Bredvid finns Export MIDI + REX, som sparar samma MIDI-fil och bitarna som en REX2-fil (.rx2) för Dr. Octo Rex: en slice per bit, i samma ordning från C1, lagda direkt efter varandra utan tystnad emellan. REX sparar loopens längd i hela taktslag, så den sista biten fylls ut med tystnad till nästa slag i låtens tempo. Filen skrivs i webbläsaren med en TypeScript-version av skrivdelen i VelociLoops (Unlicense), som ger exakt samma fil som biblioteket.

## Data, undo och lagring

- **Borttagning:** Delete frågar alltid först, och räknar upp vad som går med och var det används. En fil kan tas bort med alla sina trims, i ett ångra-steg. En trim, en matrix, en pad, en hit, en loop eller en mod som används kan tas bort efter en fråga, och blir då tyst där det användes (se Samma sak ser likadan ut). En matrix tar sina pads och hits med sig, men inte trimmen eller sin loop: loopens steg med matrisens pads töms. En trim tar sin matrix med sig och varje hit som spelar den, var den än ligger; paddar som blir tomma ligger kvar. En fil går med sin sista trim. Kopior i andra matriser räknas inte som användning av en matrix: de spelar vidare när den tas bort.
- **Pad-medlem tas bort:** steg som valt den medlemmen faller tillbaka på padens medlem 1.
- **Tom pad:** en pads sista medlem får tas bort. En tom pad finns kvar och spelar inget.
- **Undo:** alla ändringar går att ångra, i en gemensam historik för hela appen. State är oföränderligt (immutable) från start, så undo blir en historik av tillstånd.
- **Lagring:** projektet autosparas i webbläsaren (IndexedDB). Det går också att exportera och importera ett projekt som en fil: en zip med projektets JSON och alla ljudfiler (Export .zip och Import .zip under Project file i Project).
- **Projekt från före Matrix** (fas 22) öppnas inte. En projektfil (.zip), en snapshot eller en säkerhetskopia från före Matrix ger meddelandet "This project was made before Matrix (phase 22). Open it in the tag fas-21-fore-matrix." En autospar från före Matrix sparas först, som den är, som en säkerhetskopia innan den skrivs över, och appen börjar med ett tomt projekt.
- **Säkerhetskopior av autosparen:** webbläsaren behåller de 20 senaste kopiorna av projektet. En kopia sparas när sidan laddas, med projektet som det var innan något ändrats, och sedan högst var 5:e minut när projektet har ändrats. I Project listas kopiorna med tid, aktiv snapshot och antal samples, loopar och klipp i Song. Restore ersätter projektet och börjar en ny ångra-historik, som Load. Det som fanns innan sparas först som en kopia. Listan visas även när laddningen misslyckades.
- **Projekt och snapshots:** i fliken Project öppnas eller skapas ett projekt som en mapp på disk. En snapshot är en JSON-fil i mappen med allt i projektet, där ljuden refereras med sökväg till filer i mappen. Save och New snapshot finns i sidhuvudet, där Export låg. Save skriver över den aktiva snapshoten, och New sparar nuläget som en ny snapshot som blir aktiv, medan den förra ligger kvar orörd. (changed) visar osparade ändringar, och Load med osparade ändringar frågar först. Även den aktiva snapshoten har Load: den laddar den som den sparades och kastar ändringarna sedan dess (frågan har då inget Save first). En load börjar en ny ångra-historik.

## Teknik och arkitektur

Webbapp i TypeScript, byggd med Vite. GUI i React. Ljud via Web Audio API. Tester med Vitest.

Koden delas i tre lager, där varje lager bara känner till lagret under:

1. **Model** – typer, oföränderligt state, kommandon (ändringar som kan ångras), automatiska kedjan och referenskontroll vid borttagning.
2. **Engine** – händelsegenerator och renderare. Inga DOM- eller React-beroenden; generatorn har även inga Web Audio-beroenden, så den kan portas till en plugin senare.
3. **UI** – React-vyerna, uppspelning av renderad buffer och spelhuvud.

Ingen extern backend: allt körs i webbläsaren.

## Faser

Varje fas slutar med något som går att använda och lyssna på. ”Klart när” är acceptanskriteriet.

| Fas | Innehåll | Klart när |
| --- | --- | --- |
| 1. Motor | Model-lagret med undo och kedja; händelsegenerator och renderare med choke, region, riktning och pitch | Tester visar rätt triggers för en låt med Main, Fill och en enkel mod |
| 2. Första iterationen | Import, Slice (equal grid), Song med Main-raden, render, loop, spelhuvud, WAV-export, autospar | Man kan ladda Amen, slica, dra M1 till Song och exportera |
| 3. Eget material | Tag, Hits, Pads, Loops med medlemsval, Fill-raden, projektfil (zip) | Fyra snares kan bli en pad som placeras i en loop och hörs i Song |
| 4. Mods | Formerna List, Cycle, Ramp, Random. Mål i ordning: medlem, pitch, volym, riktning, ratchet, tempo (slip), Borrow | Ett break med stutter-rullar, pitchtrappa och 1/3-tempo låter som avsett |
| 5. Förfining | Transientdetektering, autotaggning, egna taggar, WAV-import med cue-markörer, smidigare drag and drop | – |
| 6. Klipp i Song | Song som tidslinje med klipp på 1/16, trimning med offset; fill-fönstret ersätts av korta klipp | M1 kan spelas i 6/16 och börja om, en fill kan ligga på sista 1/4 |
| 7. Mods med flera mål och Tape | Flera effekter per mod; Tape: inspelat segment med riktning och hastighetsramp | En mod kan spela två 1/16 i pendel allt långsammare till tystnad, och låten fortsätter i takt |
| 8. Wow, flutter och tydligare Mods | Wow och flutter på Tape, rampens tid och kurva; Mods som meningar med graf och startpunkter | En tape-broms kan ta ett slag och sedan ligga kvar, och en mod går att förstå utan att spela den |
| 9. Breaks, pads och hits; taggar och omfång bort | Sample → Hit → Pad → Break; Hits och Pads blir en vy; taggar och Acts on tas bort | Amen visas med förälder och pads 01–64, pad 08 kan få en variant och en one-shot som alternativ |
| 10. Swap: Stack och Shuffle | Swap ersätter Borrow: Stack väljer bland lagren under spelhuvudet, Shuffle blandar klippets hits | Main och Fill kan växla per steg, och ett groove kan blandas om med samma rytm |
| 11. Project och snapshots | Fliken Project: projektmapp på disk, snapshots med save, new och load | Man kan hoppa mellan två snapshots av samma projekt, och den ena påverkar inte den andra |
| 12. Hits längd | Svansar i Loops som visar hur länge varje hit låter; i Slice en rad som visar var varje slice hamnar på 1/16-griden | En split +-\|+-\|+--- syns som 2/16, 2/16 och 4/16 både i Slice och när föräldern dras in i en loop |
| 13. Breaks som egna objekt | Sample är bara ljud; Break klipper upp ett sample i platser. Markörer går alltid att flytta, sample under ett break och slice under en hit går att byta, och ett break i en loop kan bytas mot ett annat | Amen kan bytas mot Think i en loop och tvärtom, och en markör kan flyttas medan M1 ligger i Song |
| 14. Padens val | En pad väljer medlem: Top, Round robin, Random eller Random utan upprepning. Step lock går före moden, moden före paden | En hi-hat-pad med fyra hits låter olika varje gång utan mods |
| 15. Stretch | Time stretch med korta bitar: på hitten (Off, Fit to tempo, Factor) med föräldern som makro, och som mod (Multiply eller Replace), med bitlängd i ms och bitar från breakets eller hittens början | Ett break på 136 BPM i en låt på 170 BPM håller sin tonhöjd, och en mod kan dra ut en fill till metalliskt ljud |
| 16. Export i Project | Export WAV flyttar till Project; varje snapshot kan spelas och exporteras utan att laddas; Save och New snapshot i sidhuvudet | Två snapshots kan jämföras och exporteras utan att man byter mellan dem |
| 17. MIDI-export | Låten som MIDI och en WAV med bitar i lika långa rutor, C1 = bit 1 | Exporten laddad i Dr. Octo Rex (via Bounce to REX) låter som låten i Breakseq |
| 18. Dist och filter | Dist (Drive, Crush, Decimate) som håller nivån, och filter (Low-pass, High-pass) med brytfrekvens och resonans; på hitten och som mod | En fill kan krossas allt mer med en Ramp utan att bli starkare, och ett lågpass kan öppnas över en takt |
| 19. Pan och kanalval | Pan på hitten (föräldern som makro) och som mod, adderas som volym, balans med lika effekt; kanalval på samplet i Trim (Stereo, Left, Right, Mono) | En hi-hat kan studsa mellan vänster och höger med en Random-mod |
| 20. Säkerhetskopior av autosparen | De 20 senaste kopiorna av projektet i webbläsaren, vid laddning och högst var 5:e minut; Restore i Project | Ett projekt som skrivits över går att få tillbaka från kopian vid laddningen |
| 21. Reverb och delay | Reverb (mängd, storlek) och delay (mängd, tid, feedback) på hitten och som mod, med svansen bredvid rösten; torr MIDI- och REX-export och rymden som egen WAV | En mod med reverb över två takter ger ett kast som klingar ut efter moden |
| 22. Matrix | Break och one-shot blir en Matrix: Sample → Hit → Pad → Matrix, pads i y-led och hits i x-led, config i tre lager (hit, pad, matrix). Break och one-shot är bara en klassificering (ikon). Drag ger kopior. Slicingen hör till trimmen; ändringar som byter numrering frågar först (New trim eller Renumber). Plays och Replace with file tas bort. Import väljer Slice eller Don't slice. Gamla projekt öppnas inte | Amen slicas och blir en matrix med 64 pads som spelar som i dag i sin loop. En ny matrix *Snares* kan fyllas med fyra snares från olika filer, ställas på Round robin och spela en ny snare varje gång på ett steg i Loops. *Snares* kopieras till Amens rad 07 och ger fyra nya hits där; pitchas en av kopiorna ändras inte snaren i *Snares*, och tvärtom. Sänks volymen på Amens pad 07 sänks alla dess hits; sänks Amens matrix sänks allt i Amen, även kopiorna. Ingen kod, typ eller text i gränssnittet använder Break eller One-shot som objekt |
| 22b. REX2-import | En REX2-fil (.rx2) importeras i Import som ett slicat sample, med läsdelen av VelociLoops i TypeScript | En .rx2 importeras i Import (Browse och drag) och blir ett sample som redan är slicat: REX-filens slicer är markörer, takterna kommer från filen, och matrisen och loopen skapas som när man slicar själv. Loopen låter som filen. Testfilerna från VelociLoops (`120Stereo.rx2`, `120Mono.rx2`, `120FourBeats.rx2`) avkodas till samma ljud som deras WAV-facit, inom avrundningen från heltal till flyttal. En fil som Breakseq själv exporterat som REX läses tillbaka med samma antal slicer, samma tempo och samma ljud. En trasig eller okänd fil ger ett tydligt fel i Import, ingen krasch |
| 23. Gränssnitt för matriser | Flikarna Samples, Pads, Loops, Mods, Song och Project på tangenterna 1–6. Samples ersätter Import och Slice; Pads ersätter Hits med en matrix i fokus som tidslinje, Take from, reglagen för det valda, drag som lägger till, ersätter och flyttar, tryck med finger, tangentbord och + New matrix av one-shots. Loops delar fokus. Modellbuggarna från sorteringen rättade (loopen följer matrisen, padnamn efter rad, MIDI-bitar per ljud) | Amen importeras och slicas i Samples utan att byta flik. I Pads ligger amen 1 i fokus som en tidslinje och one-shots under Take from; en snare dras till pad 07 och blir en kopia där, och en hit som släpps på sista padens hit ersätter den. En ny matrix *Snares* byggs med + New matrix och kryssrutor, där varje ljud hörs vid ett klick. Hela flödet går med tangentbordet och på en mobil. Loops hylla visar bara matrisen i fokus och de man tar från. Ingen text i gränssnittet använder break eller one-shot som namn på ett objekt, bara som klassificering |
| 24. Mods att leka med (planerad) | Ett gränssnitt för mods där det är lätt och roligt att leka med parametrarna. Utformas före fasen | – |

Flikarna bytte namn i fas 23. Faserna före den använder de gamla namnen: Import och Slice är nu Samples, och Hits är nu Pads.

## Utanför v1

- Sväng: nudge per steg (fältet finns redan, alltid 0).
- Låsbara seeds för att återskapa en tagning.
- Andra taktarter och valfritt antal steg per loop (t.ex. 14 steg för 7/8).
- VST/CLAP-plugin, med händelsegeneratorn portad till Rust eller C++.
