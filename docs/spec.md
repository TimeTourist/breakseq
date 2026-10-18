# Breakseq – spec v1

Oct 14, 2026 · @Magnus

## Översikt

Breakseq är en webbapp som gör drill n bass-breaks av ett uppklippt break, till exempel Amen. Man bygger loopar av pads, placerar dem i en låt och låter mods förvränga dem. Resultatet exporteras som WAV och färdigställs i en DAW; appen gör bara breaks, inte bas eller annat.

Designprinciper:

- **Ett sätt att jobba.** Varje sak skapas och redigeras på exakt ett ställe, i en pipeline med åtta vyer.
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
| Sample | Ett rått utklipp: den trimmade filen, eller en slice av den. Bara ljud, inga inställningar. En importerad fil behåller sitt namn (amen.wav) och kan ha flera trims, numrerade per fil med fasta namn (amen trim 1, amen trim 2). En trim är ett fönster i filen och vilka kanaler som används (Stereo, Left, Right eller Mono). Trimmen är det som slicas: takterna och markörerna ligger på trimmen, och varje slice är ett sample. Uppklippningen heter efter trimmen (amen slice 1) och byter aldrig namn. | Import, Slice |
| Hit | Spelar ett sample (en slice eller hela trimmen) med egen config: region inom samplet i procent (start, slut), riktning (fram/bak), pitch (halvtoner), volym (dB), pan (−100 % vänster till +100 % höger), fade out (ms), stretch (Off, Fit to tempo eller Factor) med bitlängd (ms) och var bitarna börjar (Sample eller Hit), dist (Off, Drive, Crush eller Decimate, med mängd 0–1), filter (Off, Low-pass eller High-pass, med brytfrekvens och resonans), reverb och delay. En variant är en ny hit på samma sample, sist i samma pad. | Hits |
| Pad | En rad hits i x-led, i ordning, och config för alla sina hits (samma reglage som hitten, utan region). Paden väljer själv medlem: Top (den första), Round robin (nästa varje gång paden spelar, räknat per pad över hela låten i tidsordning), Random eller No repeat (slump, aldrig samma två gånger i rad). En step lock går före en mod, och en mod går före padens val. | Hits |
| Matrix | Pads i y-led (01, 02 …) och config för alla sina pads. En matrix med flera pads är ett break och en med en pad en one-shot: det är en klassificering som visas med en ikon, inget man väljer. Varje trim får en egen matrix, som heter som filen utan ändelse med trimmens nummer (amen 1) och visar trimmen den kommer från som länk. Matrisen kan döpas om, och då följer dess egna pads, hits (amen 1 07) och loop med. | Import, Slice, Hits |
| Loop | Tagg Main/Fill (bara för gruppering och namn; vilken loop som helst kan ligga i Main- eller Fill-raden), längd i steg om 1/16 (från 1/16 till 16 takter), som väljs i takter, slag och 1/16. Varje steg: pad eller tomt, vald medlem, step locks. | Loops |
| Mod | Namn och effekter, högst en per mål. En effekt verkar på allt under modens klipp i Song. | Mods |
| Song | Längd i takter och klipp i raderna Main, Fill, Mod A och Mod B. Ett klipp har start, längd och offset i steg om 1/16. | Song |

Step locks i v1: vald pad-medlem, ”Ignore mods” och nudge (finns i modellen, alltid 0 i v1).

**Varje hit sitter i exakt en pad**, och varje pad i exakt en matrix. Ett stegs val av medlem pekar på hittens id, inte på positionen i paden.

**Config i tre lager.** En hits config läggs ihop med padens och matrisens där hitten sitter, hit → pad → matrix. Pitch, volym och pan adderas. Varje lager med baklänges vänder riktningen, så en baklänges hit i en baklänges matrix spelas framåt. Stretch multipliceras: en hit på 2× i en matrix på Fit to tempo blir dubbelt så lång som sina steg, och Fit to tempo räknas en gång, oavsett hur många lager som har det. Fade, dist, filter, reverb, delay, bitlängd och var bitarna börjar tas från närmaste lager som har ett eget. Region finns bara på hitten. En hit följer padens och matrisens config där den sitter, inte där den kom ifrån. Tempot för Fit to tempo kommer från hittens sample, alltså trimmen det slicades ur, inte från matrisen: en snare från ett annat break sträcks efter sitt eget tempo.

**Drag ger kopior.** En hit, en pad eller en hel matrix som dras till en pad eller en matrix blir nya hits (och pads) där, med samma sample och hittens egna inställningar. Padens och matrisens config där kopian kom ifrån följer inte med; den nya platsens gäller. Dras något till en pad läggs alla dess hits sist på paden. Dras en matrix till en matrix läggs dess pads sist, med sin egen padconfig och sitt val; en pad blir en ny pad sist, och en hit en ny pad sist med kopian. Ändringar i en kopia rör inte originalet, och tvärtom: det finns ingen koppling efteråt. Vill man att allt följer en matrix lägger man den direkt i Loops. Det enda kopior delar är samplet (se Byten och omräkning).

**En matrix är fri att ändra.** + Pad lägger en tom pad sist, en pad kan flyttas och tas bort med sina hits, och hits och pads kan dras in. Det matrisen innehåller är det som spelas när den läggs i en loop.

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

Appen har sex vyer i arbetsordning, nåbara via flikar och tangenterna 1–6. Varje vy har ett ansvar; från andra vyer länkar man dit, men redigerar aldrig där.

1. **Import** – ladda WAV/AIFF, välj Slice eller Don't slice per trim. Varje fil får en trim med en egen matrix med en pad och en hit (en one-shot). Varje fil är en grupp med en rad per trim: filens namn står bara på den första raden, med en papperskorg som tar bort hela filen med alla dess trims, ▶ som spelar hela filen en gång (■ stoppar) och en beskärningsikon med plus (New trim) som gör en ny trim av samma fil på en egen rad, utan att filen importeras igen. Ett långt filnamn kortas med … i mitten, och hela namnet syns när man håller musen över det. Kolumnen Trim har trimmens nummer och, bredvid varandra, en papperskorg som tar bort trimmen (Delete trim) och en beskärningsikon som öppnar och stänger dess Trim. Creates säger vad trimmen gör, med länkar: 16 Slice → (antalet slices), 16 Hits → (antalet pads i trimmens matrix, som öppnas i Hits), N Loops → (hur många loopar som spelar trimmens pads, den egna först; länken öppnar den egna) och ♪ Song när den hörs i låten; en trim som inte är slicad gör 1 hit (Hits →). Musen över en länk visar namnet på det den öppnar. Trim stängs med sin ikon eller med ett klick utanför den (utom i headern och på tabellens knappar, som gör sitt: Trim-ikonen på en annan rad öppnar den raden). Slice skapar ingenting och gissar ingenting: Creates visar Create Slices →, som öppnar trimmen i Slice, där den slicas. Don't slice på en trim som bara är markerad Slice tar tillbaka markeringen. Är trimmen redan slicad frågar Don't slice först, i samma dialog som Delete (Don't slice amen 1?), och räknar upp vad som går: alla pads utom 01 i trimmens matrix med sina hits, och dess loop, och var de används (där blir det tyst). Pad 01 och dess hit blir kvar och spelar hela trimmen. Ctrl+Z ångrar. En WAV med cue-markörer importeras markerad Slice, inte slicad; markörerna sparas och erbjuds i Slice. Start och slut trimmas per trim; trimningen är ett fönster i originalfilen. I samma Trim-editor väljs kanal: Stereo (som filen är), Left eller Right (den kanalen i både vänster och höger) eller Mono (L+R, medelvärdet i båda). Allt spelas i stereo: en monofil har samma ljud i båda kanalerna. Spelar Play den trimmade filen syns spelhuvudet i Trim. En trims takter sätts i Slice när den slicas och kan ändras där efteråt; BPM räknas fram ur den trimmade längden, och ett tempo under 60 eller över 200 BPM ger en varning. Innan trimmen är slicad visar Length bara längden. Ett dubbelklick på en rad öppnar trimmen i Slice, eller i Hits om den inte ska slicas.
2. **Slice** – placera markörer i en trim, när som helst. Till vänster listas alla trims under Samples, med namnet på sin matrix (eller trimmens namn om matrisen är borttagen); de som inte är slicade står med "not sliced", och ett klick öppnar en trim. En trim som inte är slicad visar sin vågform, ett tomt fält för takter och hur den ska slicas: Cue markers (bara om filen har cue-markörer inom trimmen, och då förvald), 1/4, 1/8, 1/16 eller Transients. Ingenting skapas förrän både takter och sätt är valda; då skapas slices, pads och loopen i ett ångra-steg. Cue markers finns sedan kvar bland valen för en slicad trim. Länken ← Trim öppnar trimmens Trim i Import, och Slice → där leder tillbaka. Rubriken är slicens namn (amen slice 1), och under den länkar till trimmens matrix och filen (namnet kortat med … i mitten som i Import), ← Trim och Hits →, som öppnar matrisen. Make one-shot gör den markerade slicen till en egen one-shot: en ny trim av filen över just den slicen, med en matrix med en pad, medan trimmen blir som den är. Equal grid (1/4, 1/8, 1/16, där 1/16 är standard: 64 slices för fyra takter Amen) är startpunkten; markörerna kan sedan flyttas, läggas till och tas bort. Under vågformen visas en rad med 1/16-steg som i Loops: varje slice står i steget där den hamnar när trimmens matrix läggs i en loop, i en låda fram till nästa slice eller slutet, och svaga 1/16-linjer ligger över vågformen. Hamnar två slices på samma steg markeras steget rött, eftersom den andra då inte kommer med.

   Flyttas en markör slår det igenom direkt i allt som spelar slicen. **Ändringar som byter numrering frågar först:** läggs en markör till eller tas bort, eller byts grid, takter eller transienter, så att slices får nya nummer eller försvinner, och någon slice som byter nummer eller försvinner spelas av mer än en hit (varianter och kopior räknas lika, var de än ligger), frågar en dialog i appens stil: "You use slice 07, 09 in: pad amen 1 07 and pad Snares 01. Make a new trim and sample for this?" med knapparna New trim och Renumber. Escape eller ett klick utanför avbryter, och då ändras ingenting, inte heller valet i vyn. *New trim* lämnar den gamla trimmen som den var och gör en ny trim av filen med ändringen (nästa lediga nummer, samma fönster, kanal, cues och takter). Matrisen man slicar flyttar dit med sina hits och sin loop; kopior i andra matriser spelar kvar den gamla. Slice öppnar sedan den nya trimmen, och den gamla står kvar i listan. *Renumber* räknar slices efter nummer, så det som var 06 blir nya 07 där 07 används. Takterna frågar först när fältet lämnas eller med Enter, och Sensitivity för Transients när reglaget släpps, inte mitt i en ändring.
3. **Hits** – listan till vänster (Matrices) har varje matrix med sina pads i ordning. Varje matrix har en ikon som visar om den är ett break (flera pads) eller en one-shot (en pad). + New matrix gör en tom matrix (Matrix 1, Matrix 2 …) med en tom pad och öppnar den, så att man döper den. En matrix som öppnas visar sitt namn, länkarna ← Trim, ← Slice och filens namn (för en matrix som kommer från en trim; namnet kortat med … i mitten som i Import, och musen över en länk visar hela namnet), hur många pads den har, och matrisens config: samma reglage som hitten utan region, lagda över alla dess pads. Den har knapparna + Pad (en tom pad sist), Clone matrix och Delete matrix. Clone matrix kopierar hela matrisen med egna pads och kopior av alla hits; kopian heter som matrisen med "copy" efter (amen 1 copy), har ingen trim och ingen loop, öppnas direkt och är sedan helt fristående. Delete matrix frågar först och räknar upp vad som går med (antal pads och hits) och var dess pads används (i en annan loop, eller dess loop i Song); kopior på andra ställen räknas inte. Trimmen och matrisens loop blir kvar. En matrix som kommer från en slicad trim visar trimmens vågform med var slicesen börjar, som numrerade linjer; ett dubbelklick på en linje öppnar den slicen i Slice, där markörerna flyttas. En pad visar vilken rad den är i sin matrix (länk till matrisen), hur den väljer (Pad plays: Top, Round robin, Random, No repeat), sina hits, och en hopfälld Pad sound med padens config, samma reglage som matrisens. Den har + Pad och Delete pad, som tar paden med dess hits. Den valda hitten redigeras (region, riktning, pitch, volym, pan, fade, stretch, dist, filter, reverb, delay, variant); ett reglage visar vad som kommer från lagren ovanför. Hits läggs till en pad genom att dra eller med "+ Hit"; båda ger kopior (se Drag ger kopior). En hit, en pad eller en matrix dras till en pad eller till en matrix i listan. Hits ordnas om och tas bort i paden (Delete och hittens namn). En hit kan bytas till en annan slice eller ett annat sample ("Replace…", med The whole sample för hela trimmen) och behåller då sina inställningar och sin region. En hit som spelar en annan slice än sin rad visas i listan till vänster som `15→07` (eller `→think 07` från en annan trim). En breaks pads kan fällas ihop i listan (▸/▾), och Expand all/Collapse all överst fäller ut eller ihop alla. Listan är hopfälld från början; det sparas bara i vyn.
4. **Loops** – placera pads och matriser på steg, välj medlem per steg och sätt step locks. Ett steg låter antingen paden välja ("The pad picks", förvalt) eller låser en medlem, även medlem 1. En matrix i en loop kan bytas mot en annan ("Matrix amen 1 → swap for…"): varje steg som spelar rad N i den gamla spelar rad N i den nya, och ett steg vars rad den nya saknar töms. Matrisens namn där öppnar den i Hits. Varje hit visas som en låda från sitt steg fram till nästa hit eller loopens slut, hur länge ljudet än klingar; en låda över radens slut fortsätter på nästa rad. Stegen i lådan är tomma och går att klicka och släppa på, och det som läggs där kortar lådan. Under looparna till vänster finns samma lista som i Hits (Show in Pads), en grupp per break och en grupp One-shots för alla matriser med en pad, med en kryssruta per grupp: bara det som är ikryssat visas i hyllan att dra från. Hyllan är ordnad efter matrix. Listan är hopfälld från början och har Expand all/Collapse all överst; valen sparas bara i vyn. Varje knapp i hyllan visar hur många 1/16 den tar (`07 ·2`), och varje break har en knapp för hela matrisen (`amen 1 ▸ all` med dess längd). Medan något dras över stegen visas en streckad låda där det hamnar och vad det skriver över. En matrix som släpps på ett steg lägger ut sina pads efter varandra från steget (se En matrix spelas i padordning) och skriver över hela sin längd: steg där ingen pad hamnar töms. Ett dubbelklick på en matrix, en pad eller en hit i hyllan eller i Show in Pads öppnar den i Hits. Ett klick på en knapp i hyllan väljer den och spelar den: en pad sin första hit, en matrix en gång som den läggs ut i en loop. Ett klick på en matrix eller en hit i Show in Pads spelar den en gång.
5. **Mods** – bygg mods.
6. **Song** – en tidslinje med 1/16-rutnät. Loopar och mods läggs ut som klipp, som flyttas (Ctrl kopierar, Alt också) och ändras i längd från båda kanterna. Ett markerat klipp kopieras med Ctrl+C och klistras in med Ctrl+V där spelhuvudet står, i klippets rad. Ctrl+D lägger en kopia direkt efter klippet, och kopian blir markerad. Ett klick i linjalen flyttar spelhuvudet dit: Play startar där, och spelar låten hoppar den dit. Stop går tillbaka dit. Ett drag i linjalen markerar ett loopområde. Områdets ändar har var sitt handtag, som i Trim: en linje över hela tidslinjen med en kloss överst, som dras eller flyttas med ←/→ (Shift: ett slag). När området är på skuggas det som ligger utanför, som i Trim. Knappen Loop slår av och på området. När det är på spelar Song från startpunkten in i området och sedan området om och om igen. När det är av loopas hela låten. Området sparas i projektet och går att ångra, men exporten tar alltid hela låten.

**Automatisk kedja.** Varje importerad fil, och varje ny trim, blir en trim med en egen matrix: en one-shot med en pad och en hit som spelar hela trimmen (amen 1). När trimmen slicas blir den matrisen den slicade: pad 01 blir första slicens rad, och matrisen får en pad per slice (amen 1 01, amen 1 02 …), var och en med slicens hit. Första gången får trimmen också en loop med matrisens namn (amen 1), som spelar paddarna i ordning, var och en på närmaste 1/16 (hamnar två på samma steg kommer bara den första med). Loopen skapas en gång. Så länge den är exakt som matrisen lade ut den följer den med när trimmens takter eller markörer ändras; när man har ändrat i den själv rörs den aldrig. Andra loopar ligger kvar som de lades ut. Matrisens rader följer markörerna: blir det fler slices får matrisen en ny pad sist för varje ny slice som ingen av dess pads spelar. En rad man själv har tagit bort kommer inte tillbaka när markörerna ändras, och pads man lagt till själv är inga rader.

**Byten och omräkning.** En hit spelar en slice efter nummer: slice 05 är alltid trimmens femte slice. Samplet är det enda kopior och varianter delar: flyttas en markör ändras slicens ljud i alla hits som spelar den, även kopior och varianter i andra matriser. Läggs en markör till eller tas bort räknas alla slices om, och om det byter nummer på en slice som mer än en hit spelar frågar Slice först (se Slice). Blir det färre slices blir hits på de sista tysta där de spelas (paddarna visas nedtonade, och i hyllorna bara så länge en loop spelar dem), och blir det fler dyker de nya upp som pads i trimmens matrix. En hits region är i procent av dess slice och följer med när slicen ändras. Att byta trim eller fil under en matrix går inte; matrisen visar vilken trim den kommer från. Undo och snapshots är skyddsnätet.

**Samma sak ser likadan ut.** Samma funktion ser ut och fungerar likadant i alla flikar:

- *Vågformer* har samma färg, och alla visar spelmarkören när det de visar spelar. I Hits går markören genom hittens region (för en matrix genom hela trimmens vågform); spelar paden visas ingen markör, eftersom det inte är givet vilken hit som låter.
- *Start och slut* ställs med samma handtag i Trim, Hits (hittens region) och Song (loopen): dra, eller fokusera och använd ←/→ (Shift: 10 ms, i Song ett slag). Trim och Hits har dessutom fälten Start ms och End ms. Utanför regionen är det lika mörkt överallt.
- *Spela* är en ▶/■-knapp med en Loop-knapp direkt till vänster, där det finns ett val. Loop är en enda knapp som slås på och av och ser ut som Loop i Song; avslagen spelar det en gång. Den heter Play eller Stop och vad den spelar (Play matrix, Stop trim). Ordet Preview används inte.
- *Knappar* är 44 px för handlingar som står för sig själva, och 36 px i rader, listor, tabeller och segment (även chips och små ikoner).
- *Delete* betyder att något försvinner, och *Remove* att det tas ur något (Remove på en effekt i en mod). Delete pad, Delete hit, Delete loop, Delete mod, Delete matrix, Delete trim och Delete file ser likadana ut, som text eller som papperskorg i täta rader: man får alltid en fråga, i en dialogruta i appens stil med Cancel och Delete (Escape avbryter), som räknar upp vad som går med (för en one-shot: 1 pad, 1 hit) och var det används, och tar man bort det ändå blir det tyst där det användes (steg med paden töms, hitten lämnar sin pad och step locks, paden lämnar sin matrix, loopens och modens klipp lämnar Song).
- *Länkar och knappar*: att hoppa till en annan flik är en textlänk med pil (← Trim, Hits →, Slice →), på raden under rubriken där det finns en. Knappar ändrar något.
- *Rubriken* är namnet på det som är valt (amen slice 1, amen 1 01, M1); en flik utan val har fliknamnet.
- *Slices* heter "slice" med två siffror överallt (slice 01, Marker 01, Plays slice 01 of amen trim 1).
- *Sidomenyerna* i Hits, Loops och Mods har samma ordning: rubrik, + New …, listan, sedan eventuell extra sektion.
- *Reglage* ser likadana ut överallt: etikett och värde ovanför. Sifferfält har etiketten till vänster och samma höjd.
- *Hörs i låten*: det som hörs i Song, hela vägen ned (loopen ligger i Song, paden på ett steg i den, hitten i paden, matrisen genom paden, och trimmen i Import och Slice genom hitten), har "♪ Song" vid sitt namn, och ett klick öppnar Song. I sidomenyerna står ett ♪ vid det som hörs. Det som bara hörs för att en mod byter till det (Swap, Pad member) räknas inte, eftersom det ofta beror på slumpen. Annars visas inte var något används; Delete säger det när det behövs.
- *Siffror*: längder står i ms, tempo med två decimaler, och takter som "1 bar" och "2 bars".
- *Huvudet* är detsamma i Hits, Loops och Mods: namnet, under det en rad med info, länkar och inställningar, och knapparna till höger.
- *Headern* (BREAKSEQ, flikarna och transporten) står alltid kvar överst när sidan scrollar.
- *Webbläsarens Back och Forward* går mellan flikarna: varje flikbyte är ett steg, och fliken man kommer tillbaka till visar det som var öppet där (matrix, hit, pad, loop, mod, trim i Slice, öppen Trim). Ändringar inom en flik är inga steg, och ångra (Ctrl+Z) är skilt från Back.
- *Hjälptext* står inte i rubriker; rubriker är namn ("Pads", "Loops and mods"), och hjälpen står i en liten grå rad sist i sin panel. Ett tomt läge länkar till fliken där man gör det som saknas (← Import, ← Slice, ← Loops, ← Mods).
- *Av och på* (Loop i Song) markeras som ett valt segment.
- *Knappar säger vad de gör*: −1 ms och +1 ms flyttar en markör; pilar betyder att man hoppar till en annan flik. New example ritar om ett exempel i Mods, New take slumpar om det som spelas i Song.
- *Chips*: länkchips har accentfärg, och bara det som går att dra har dra-markören.
- *Spelknappar i flikar* finns bara där det inte är klart vad Play i toppen spelar.

**Biblioteksraden.** I Loops och Song finns en rad att dra från: pads och matriser i Loops, loopar och mods i Song. Man drar därifrån för att använda, aldrig för att redigera.

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
- **På hitten** (i Hits) gäller dist och filter alltid; på paden och matrisen gäller de hits under dem som saknar egna. **I en mod** ställs läget (dist) eller typen och resonansen (filter) i moden, och List, Ramp och Random ändrar mängden respektive brytfrekvensen. En mod gäller i stället för hittens dist eller filter.

**Reverb och delay** är kast: ett break får plötsligt rymd eller eko en kort stund, eller bara på slumpvisa slag, som en del av breaket. (Reverb över hela låten läggs i Reason eller Digitakt.)

- **Bredvid rösten.** Låten har en reverb och en delay som klingar ut bredvid rösten. Ett slag skickar en del av sitt ljud dit, som det hörs, alltså avklippt där nästa slag klipper det; svansen klipps inte av nästa slag eller av att moden tar slut.
- **Reverb** har en mängd (0–100 %, hur mycket av slaget som skickas) och en storlek från litet rum till stor hall (0,3–4 s). Rummet är brus som klingar av, alltid samma, så samma låt låter likadant varje gång.
- **Delay** har en mängd, en tid i låtens tempo (1/16, 1/8, 3/16 eller 1/4) och feedback (0–90 %, hur mycket av varje eko som kommer tillbaka).
- **På hitten** (i Hits) skickar en hit alltid; mängd 0 på en hit tar närmaste lagers (pad, sedan matrix). **I en mod** ställs storleken (reverb) eller tiden och feedbacken (delay) i moden, och formen ger mängden i procent. En ny Reverb- eller Delay-effekt är ett kast (List 100, för delay 80), så att alla slag under klippet skickas; Random med chans ger kast på slumpvisa slag. Under Start from finns Reverb throw, Delay throw och Random verb. En mod gäller i stället för hittens; när A och B båda skickar adderas mängderna (högst 100 %) och B:s inställningar gäller.
- **Svansen.** I en loop och i låten som spelas runt hörs det som klingar efter slutet i början av nästa varv. Spelas något en gång, och i Export WAV, klingar svansen ut efter slutet, så filen blir längre än låten.
- **Exporten.** MIDI-filen, bit-WAV:en och REX-filen är torra: slagen utan reverb och delay. Har låten reverb eller delay följer en WAV med bara dem (…-reverb-delay.wav), tyst däremellan, från låtens början och så länge de klingar, i samma nivå som bitarna, så att den på ett ljudspår bredvid ger låten.

**Stretch** ändrar en hits längd utan att ändra tonhöjden, som time stretch på gamla samplers: hitten spelas som korta bitar (bitlängden, förvalt 30 ms) som var och en börjar lite längre fram i slicen och läggs över varandra med korta övertoningar. Faktor 2 gör hitten dubbelt så lång, 0,5 hälften så lång; faktorn går från 1/16 till 16 och bitlängden från 5 till 500 ms. Kort bitlängd låter metalliskt, lång mjukare och ekande. Pitch ändrar fortfarande både tonhöjd och längd, så stretch och pitch tillsammans flyttar tonhöjden med samma längd (2× och +12 ger en oktav upp i samma längd).

- **På hitten** (i Hits, bredvid pitch): Off (förvalt), Fit to tempo eller Factor. Fit to tempo stretchar med tempot hos trimmen som hittens sample kommer från delat med låtens, så att slicen håller sin tonhöjd och blir lika lång som sina steg i låten. Ett sample ur en trim som inte är slicad har inget tempo och kan inte Fit to tempo. På paden och matrisen verkar stretch som makro för alla hits under dem och multipliceras med hittens egen (se Config i tre lager).
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
| Import | Trimmen vars Trim är öppen, trimmad och loopad (även en one-shot). Utan öppen Trim spelar Play låten. |
| Slice | Trimmens matrix som den låter när den läggs i en loop, renderad och loopad |
| Hits | Den öppna matrisen som den läggs ut, pad efter pad (med utbytta slices), den valda hitten, eller med bara en pad vald padens val. Loop på (förvalt) eller av; med Loop på väljer en pad på nytt varje varv, och Round robin går hela varv. |
| Loops | Den valda loopen, renderad och loopad |
| Mods | Moden på sin loop, renderad och loopad |
| Song, Project | Hela låten, renderad och loopad |

Trim och Slice har egna ▶ som spelar trimmen och matrisen direkt vid tryck, och de små ▶ i en pads lista spelar en hit en gång. I Hits sitter Loop och ▶ vid det som Play spelar: vid matrisen, paden, eller hitten när en sådan är vald, och ▶ där gör samma sak som Play. Byts flik under uppspelning startar den nya flikens ljud direkt från början när det är renderat; ändras det som spelar tar den nya renderingen vid där loopen tar slut. Har den nya fliken inget att spela stannar uppspelningen. Play i headern är en enda knapp, som alla andra ▶: den visar ■ och heter Stop medan det spelar. Mellanslag gör samma sak som Play/Stop, i alla vyer, utom när man skriver i ett fält.

- **När det renderas:** automatiskt kort efter varje ändring (debounce), plus en knapp för ny slumptagning utan att något ändrats.
- **Byte under uppspelning:** en ny rendering startar exakt där den gamla loopen tar slut, utan avbrott.
- **Spelhuvud:** renderaren lämnar en triggerlista (tid, takt, steg). GUI:t tänder det steg vars trigger senast passerats. Ingen annan feedback, och mods ändrar inte hur steg ser ut.
- **Export:** görs i fliken Project. Export WAV sparar låten som den är nu, och varje snapshot har egna knappar för att spela och exportera den utan att ladda den; det laddade projektet rörs inte. WAV-filen är 44,1 kHz / 24 bit, normaliserad till −0,3 dBFS. Det som exporteras är exakt det man hör.
- **MIDI och bitar:** bredvid Export WAV i Project exporteras låten som en MIDI-fil och en WAV-fil med bitar, för en sampler som Dr. Octo Rex eller Digitakt. En bit är varje unik variant som hörs i låten (hit med pitch, riktning, stretch och volym, mods inräknade), så MIDI-filen bara är noter och låter som låten. Bitarna ligger i trim- och sliceordning (Amen 01, 02 …, sedan varianter och one-shots), en per lika lång ruta: rutan är så lång som den längsta biten, resten av rutan är tyst, och antalet rutor avrundas uppåt till 4, 8, 16, 32 eller 64 så att filen kan delas på ett rutnät. Varje ruta har också en cue-markör. Ett Tape-segment blir en egen bit. Bit 1 är C1 (not 36) och följande bitar ligger en halvton upp; fler än 92 bitar ryms inte och exporten säger då ifrån. MIDI-filen har låtens tempo, och varje not är så lång som ljudet hörs. Bredvid finns Export MIDI + REX, som sparar samma MIDI-fil och bitarna som en REX2-fil (.rx2) för Dr. Octo Rex: en slice per bit, i samma ordning från C1, lagda direkt efter varandra utan tystnad emellan. REX sparar loopens längd i hela taktslag, så den sista biten fylls ut med tystnad till nästa slag i låtens tempo. Filen skrivs i webbläsaren med en TypeScript-version av skrivdelen i VelociLoops (Unlicense), som ger exakt samma fil som biblioteket.

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
| 23. Gränssnitt för matriser (planerad) | Fokus på en matrix och några påsar, dragsida och flikar. Utformas före fasen | – |
| 24. Mods att leka med (planerad) | Ett gränssnitt för mods där det är lätt och roligt att leka med parametrarna. Utformas före fasen | – |

## Utanför v1

- Sväng: nudge per steg (fältet finns redan, alltid 0).
- Låsbara seeds för att återskapa en tagning.
- Andra taktarter och valfritt antal steg per loop (t.ex. 14 steg för 7/8).
- REX2-import (proprietärt format).
- VST/CLAP-plugin, med händelsegeneratorn portad till Rust eller C++.
