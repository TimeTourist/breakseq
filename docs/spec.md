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

Allt pekar nedåt i en enda kedja: ett steg spelar en pad, en pad väljer en hit, en hit spelar en slice av ett break, och ett break klipper upp ett sample. Ordlistan är **Sample → Hit → Pad → Break**. Alla objekt har fasta id:n som aldrig ändras, oavsett ordning eller namn.

| Objekt | Innehåller | Skapas i |
| --- | --- | --- |
| Sample | Ljuddata: en importerad fil, trimmad till ett fönster i filen. Bara ljud, utan typ. | Import |
| Hit | Hur en slice spelas: vilken plats i vilket break, region inom slicen i procent (start, slut), riktning (fram/bak), pitch (halvtoner), volym (dB), fade out (ms). Ett breaks egen hit är förälder till dess slices. | Hits |
| Pad | Det ett steg spelar: en hit plus alternativ, i ordning. Den första spelas utan mods. Varje plats i ett break har en pad, med platsens hit överst. | Hits |
| Break | En uppklippning av ett sample: takter, markörer och platser 01…N, en pad per plats, och föräldern, som är ett makro för alla slices. En one-shot är ett break med en enda plats och utan markörer. | Import, Slice |
| Loop | Tagg Main/Fill (bara för gruppering och namn; vilken loop som helst kan ligga i Main- eller Fill-raden), längd i steg om 1/16 (från 1/16 till 16 takter), som väljs i takter, slag och 1/16. Varje steg: pad eller tomt, vald medlem, step locks. | Loops |
| Mod | Namn och effekter, högst en per mål. En effekt verkar på allt under modens klipp i Song. | Mods |
| Song | Längd i takter och klipp i raderna Main, Fill, Mod A och Mod B. Ett klipp har start, längd och offset i steg om 1/16. | Song |

Step locks i v1: vald pad-medlem, ”Ignore mods” och nudge (finns i modellen, alltid 0 i v1).

En hit kan ingå i flera pads, till exempel sin automatiska pad och en pad man byggt själv. Ändras hitten ändras den överallt; vill man ha en annorlunda version duplicerar man den i Hits. Ett stegs val av medlem pekar på hittens id, inte på positionen i paden. Ett breaks egen hit (hela det trimmade samplet) är förälder och fungerar som ett makro för alla hits från breakets slices: pitch och volym läggs ovanpå varje slice-hits egna, baklänges på föräldern vänder varje slice för sig (en baklänges slice spelas då framåt), och förälderns fade gäller slices utan egen fade. Föräldern spelas aldrig som en pad: att lägga den i en loop lägger ut breakets slices i ordning från steget.

## Pipeline och vyer

Appen har sex vyer i arbetsordning, nåbara via flikar och tangenterna 1–6. Varje vy har ett ansvar; från andra vyer länkar man dit, men redigerar aldrig där.

1. **Import** – ladda WAV/AIFF, välj Break eller One-shot per fil. Break gör ett break med markörer på 1/16 och loopen M1; One-shot gör ett break med en plats. Start och slut trimmas per sample; trimningen är ett fönster i originalfilen. För ett break gissas antal takter (det av 1, 2, 4, 8 och 16 som ger 70–180 BPM) och ändras i Slice, även efter slicing; BPM räknas fram ur den trimmade längden, och ett tempo under 60 eller över 200 BPM ger en varning.
2. **Slice** – placera markörer i ett break, när som helst. Varje ändring slår igenom direkt i allt som spelar breaket, utan varningar. Här byts också samplet under breaket ("Replace sample…"). Equal grid (1/4, 1/8, 1/16, där 1/16 är standard: 64 slices för fyra takter Amen) är startpunkten; markörerna kan sedan flyttas, läggas till och tas bort; transienter senare. Under vågformen visas en rad med 1/16-steg som i Loops: varje slice står i steget där den hamnar när föräldern läggs i en loop, med sin längd i breakets tempo, och svaga 1/16-linjer ligger över vågformen. Hamnar två slices på samma steg markeras steget rött, eftersom den andra då inte kommer med.
3. **Hits** – varje break med föräldern överst och dess pads i ordning, sedan one-shots. En pad visar sina hits; den valda hitten redigeras (region, riktning, pitch, volym, fade, variant). Hits läggs till en pad som alternativ genom att dra eller med "+ Hit", ordnas om och tas bort. En hit kan bytas till en annan slice eller one-shot ("Replace…") och behåller då pitch, volym, fade och riktning.
4. **Loops** – placera pads på steg, välj medlem per steg och sätt step locks. Ett break i en loop kan bytas mot ett annat ("Break: Amen → Think"): varje steg som spelar plats N i det gamla spelar plats N i det nya. Varje steg visar hur länge dess hit låter: en linje längs stegets underkant som fortsätter över följande steg tills ljudet tar slut eller nästa slag klipper det. Längden räknas i låtens tempo, med hittens och förälderns pitch men utan mods, och gäller även one-shots. Stegen under linjen är tomma och går att släppa på.
5. **Mods** – bygg mods.
6. **Song** – en tidslinje med 1/16-rutnät. Loopar och mods läggs ut som klipp, som flyttas (Alt kopierar) och ändras i längd från båda kanterna.

**Automatisk kedja.** Ett break får direkt en pad per plats, med platsens hit överst, och en förälder; ett break av en fil som importeras som Break får dessutom loopen M1, som spelar platserna i ordning, var och en på närmaste 1/16 (hamnar två på samma steg kommer bara den första med). M1 skapas en gång och ändras aldrig av sig själv.

**Byten och omräkning.** Platser räknas efter nummer: pad 05 är alltid breakets femte slice. Flyttas, läggs till eller tas bort en markör räknas alla slices om; blir det färre platser blir de sista tysta där de spelas, och blir det fler dyker de nya upp som pads att dra. Byts samplet under ett break behåller markörerna sin plats i takten och ljudet under dem byts. En hits region är i procent av dess slice och följer med när slicen ändras. Undo och snapshots är skyddsnätet: inget av detta frågar eller varnar.

**Biblioteksraden.** I Loops och Song finns en rad att dra från: pads i Loops, loopar och mods i Song. Man drar därifrån för att använda, aldrig för att redigera.

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
| Mål | Swap (Stack eller Shuffle), Pad member, Pitch (halvtoner), Volume (dB), Direction, Ratchet (1–8), Tempo (slip), Tape |
| Rate | Per steg, per beat, per bar. Värdet hålls över intervallet och gäller alla triggers i det. |
| Form | (Alla mål utom Swap och Tape.) List (värden i tur och ordning, ett per intervall), Cycle (stegar genom värden eller medlemmar), Ramp (från–till över modens längd), Random (slumpvärde inom ett intervall, med chans i %; för pitch hela halvtoner eller fritt, förvalt halvtoner) |

**Samverkan.** När A och B rör samma mål adderas numeriska värden (pitch, volym), och för lägesvärden (riktning, medlem, ratchet) vinner B. Mods läggs ovanpå hitten och stegets locks.

**Ordning.** Mods tillämpas i fast ordning efter mål, oavsett rad:

1. Swap
2. Pad member
3. Ratchet
4. Pitch, volym och riktning – gäller varje retrigger i en ratchet
5. Tempo (slip)

**Var en mod verkar.** En mod har inget eget omfång: den verkar på allt under sitt klipp i Song. Vilka steg bestäms alltså av var och hur långt klippet ligger.

**Swap** byter hit på steg som har en, utan att ändra rytmen. Den har två lägen, och algoritmen väljs i moden.

- **Stack** väljer bland allt under spelhuvudet: lagren uppifrån och ner (Fill, sedan Main, även när Main inte hörs), och inom varje lager padens hits i ordning. Per intervall (1/16, beat eller takt) väljer den *at random*, *round robin* (en kandidat längre för varje intervall med en hit), *layer by layer, top down* (Fill, Main, Fill … med varje lagers förvalda hit) eller *layer by layer, bottom up* (Main först).
- **Shuffle** blandar hitsen som spelas inom klippet: högen är hitsen på stegen med en hit, och varje sådant steg får en hit ur högen, *like a deck* (varje hit en gång, i slumpad ordning), *freely* (samma hit kan komma igen), *in reverse* eller *rotated by n*. Steg utan hit förblir tysta.

Swap tillämpas före alla andra mål. Har både A och B Swap vinner B.

**Längd.** En mod gäller sitt klipp i Song, på 1/16 när. Varje klipp är en sammanhängande modulation: intervallen räknas från klippets början, och Ramp sträcker sig över klippets längd.

**Ratchet** n delar stegets längd i n lika delar och triggar hitten i varje del.

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

| Vy | Vad som spelas |
| --- | --- |
| Hits | Ett enskilt ljud direkt vid tryck, ingen rendering |
| Loops | Den valda loopen, renderad och loopad |
| Song | Hela låten, renderad och loopad |

I vyer utan egen uppspelning (Import, Slice) spelar och exporterar Play och Export låten.

- **När det renderas:** automatiskt kort efter varje ändring (debounce), plus en knapp för ny slumptagning utan att något ändrats.
- **Byte under uppspelning:** en ny rendering startar exakt där den gamla loopen tar slut, utan avbrott.
- **Spelhuvud:** renderaren lämnar en triggerlista (tid, takt, steg). GUI:t tänder det steg vars trigger senast passerats. Ingen annan feedback, och mods ändrar inte hur steg ser ut.
- **Export:** det som spelas i aktuell vy (loopen i Loops, låten i Song) sparas som WAV, 44,1 kHz / 24 bit, normaliserad till −0,3 dBFS. Det som exporteras är exakt det man hör.

## Data, undo och lagring

- **Borttagning:** något som används (sample, hit, pad, loop, mod) kan inte tas bort. Vyn visar i stället var det används, med länkar dit.
- **Pad-medlem tas bort:** steg som valt den medlemmen faller tillbaka på padens medlem 1.
- **Tom pad:** en pads sista medlem får tas bort. En tom pad finns kvar och spelar inget.
- **Undo:** alla ändringar går att ångra, i en gemensam historik för hela appen. State är oföränderligt (immutable) från start, så undo blir en historik av tillstånd.
- **Lagring:** projektet autosparas i webbläsaren (IndexedDB). Det går också att exportera och importera ett projekt som en fil: en zip med projektets JSON och alla ljudfiler.
- **Projekt och snapshots:** i fliken Project öppnas eller skapas ett projekt som en mapp på disk. En snapshot är en JSON-fil i mappen med allt i projektet, där ljuden refereras med sökväg till filer i mappen. Save skriver över den aktiva snapshoten, och New sparar nuläget som en ny snapshot som blir aktiv, medan den förra ligger kvar orörd. (changed) visar osparade ändringar, och Load med osparade ändringar frågar först. En load börjar en ny ångra-historik.

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

## Utanför v1

- Sväng: nudge per steg (fältet finns redan, alltid 0).
- Låsbara seeds för att återskapa en tagning.
- Andra taktarter och valfritt antal steg per loop (t.ex. 14 steg för 7/8).
- REX2-import (proprietärt format).
- VST/CLAP-plugin, med händelsegeneratorn portad till Rust eller C++.
