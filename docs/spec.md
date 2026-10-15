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

Allt pekar nedåt i en enda kedja: ett steg spelar en pad, en pad väljer en hit, en hit spelar en sample. Alla objekt har fasta id:n som aldrig ändras, oavsett ordning eller namn.

| Objekt | Innehåller | Skapas i |
| --- | --- | --- |
| Sample | Ljuddata: en slice av ett break eller en importerad fil. Huvudtagg och ev. extra taggar. | Import, Slice |
| Hit | En sample + region (start, slut), riktning (fram/bak), pitch (halvtoner), volym (dB), fade out (ms) | Hits |
| Pad | Ordnad lista av hits. Medlem 1 är default. En ensam hit är en pad med en medlem. | Pads |
| Loop | Tagg Main/Fill (bara för gruppering och namn; vilken loop som helst kan ligga i Main- eller Fill-raden), längd i hela takter, 16 steg per takt. Varje steg: pad eller tomt, vald medlem, step locks. | Loops |
| Mod | Mål, omfång, rate, form och formens parametrar | Mods |
| Song | Takter med raderna Main, Fill, Mod A och Mod B | Song |

Step locks i v1: vald pad-medlem, ”Ignore mods” och nudge (finns i modellen, alltid 0 i v1).

En hit kan ingå i flera pads, till exempel sin automatiska pad och en pad man byggt själv. Ändras hitten ändras den överallt; vill man ha en annorlunda version duplicerar man den i Hits. Ett stegs val av medlem pekar på hittens id, inte på positionen i paden. Ett breaks egen hit (hela det trimmade samplet) är förälder till alla hits från breakets slices: dess pitch och volym läggs ovanpå varje slice-hits egna.

## Pipeline och vyer

Appen har åtta vyer i arbetsordning, nåbara via flikar och tangenterna 1–8. Varje vy har ett ansvar; från andra vyer länkar man dit, men redigerar aldrig där.

1. **Import** – ladda WAV/AIFF, välj Break eller One-shot per fil. Start och slut trimmas per sample; trimningen är ett fönster i originalfilen. För ett break anges antal takter, och BPM räknas fram ur den trimmade längden.
2. **Slice** – placera markörer i ett break. Equal grid (1/4, 1/8, 1/16, där 1/16 är standard: 64 slices för fyra takter Amen) är startpunkten; markörerna kan sedan flyttas, läggas till och tas bort; transienter senare.
3. **Tag** – ge varje sample en huvudtagg (K, S, H, R, G + egna, max 8). Varje kort har en play-knapp.
4. **Hits** – redigera region, riktning, pitch, volym och fade; duplicera som variant.
5. **Pads** – samla hits i pads och bestäm ordning.
6. **Loops** – placera pads på steg, välj medlem per steg och sätt step locks.
7. **Mods** – bygg mods.
8. **Song** – placera loopar och mods i takter.

**Automatisk kedja.** Varje sample får direkt en default-hit (hela samplet, inga ändringar) och en pad med den hitten som enda medlem. När ett break slicas skapas dessutom loopen M1, som spelar breakets pads i ordning, kvantiserad till 1/16. Kedjan körs en gång; därefter är allt vanliga objekt. Ett break kan slicas om så länge dess slices inte används utanför M1 och M1 inte ligger i Song; då ersätts slices, hits, pads och M1. Slices med egna markörer placeras i M1 på närmaste 1/16.

**Biblioteksraden.** I Loops och Song finns en rad att dra från: pads i Loops, loopar och mods i Song. Man drar därifrån för att använda, aldrig för att redigera.

## Motor

Motorn består av två delar: en händelsegenerator som räknar fram triggers, och en renderare som gör ljud av dem. Generatorn är en ren funktion utan DOM- eller ljudberoenden, och slumpen injiceras så att den går att testa.

**Händelsegeneratorn** tar Song, alla objekt och en slumpkälla, och ger en lista av triggers. Varje trigger har: tid i sekunder, takt och steg (för spelhuvudet), hit-id, samt slutlig pitch, volym, riktning och region. För varje takt:

1. Det aktiva lagret väljs: Fill om raden F har en loop i takten, annars Main. Exakt ett lager hörs. En Main loopar tills nästa Main börjar; en Fill täcker så många takter som den är lång. En Fill har ett fönster med start- och slutmarkör över sina steg (förvalt hela loopen): inom fönstret spelar fillen, även sina tysta steg, och utanför lyser Main igenom.
2. För varje steg i det lagret ger paden och stegets valda medlem en hit; utan val spelas medlem 1.
3. Mods från raderna A och B tillämpas på stegen (se Mods). Steg med ”Ignore mods” hoppas över.
4. Varje steg blir en eller flera triggers (fler vid ratchet), placerade på tidslinjen.

**Renderaren** spelar triggers i en `OfflineAudioContext` och ger en ljudbuffer. All uppspelning sker på en röst: en ny trigger klipper den föregående med en kort fade (ca 2–5 ms) så att det inte klickar. Baklänges-versioner av samples förberäknas en gång.

Samples behåller stereo. Tempo ställs per låt i BPM. En ny låt börjar på 170 BPM och 8 takter. Pitch ändrar uppspelningshastigheten och därmed längden, vilket är avsiktligt.

## Mods

En mod är ett mål, ett omfång, en rate och en form. Slump är bara en av formerna. Mods byggs i Mods-vyn och placeras i raderna A och B i Song; en mod i en takt verkar på det lager som hörs i den takten.

| Fält | Val i v1 |
| --- | --- |
| Mål | Pad member, Pitch (halvtoner), Volume (dB), Direction, Ratchet (1–8), Tempo (slip), Source loop (Borrow) |
| Omfång | Alla steg, steg med en viss huvudtagg, steg med en viss pad, ett stegintervall |
| Rate | Per steg, per beat, per bar. Värdet hålls över intervallet och gäller alla triggers i det. |
| Form | List (värden i tur och ordning, ett per intervall), Cycle (stegar genom värden eller medlemmar), Ramp (från–till över modens längd), Random (slumpvärde inom ett intervall, med chans i %) |

**Samverkan.** När A och B rör samma mål adderas numeriska värden (pitch, volym), och för lägesvärden (riktning, medlem, ratchet) vinner B. Mods läggs ovanpå hitten och stegets locks.

**Ordning.** Mods tillämpas i fast ordning efter mål, oavsett rad:

1. Source loop (Borrow)
2. Pad member
3. Ratchet
4. Pitch, volym och riktning – gäller varje retrigger i en ratchet
5. Tempo (slip)

**Omfång.** Omfånget prövas när moden tillämpas, mot den hit som spelas efter tidigare mål i ordningen. Ett taggomfång för S träffar alltså en snare som en Pad member-mod har bytt in.

**Borrow** byter steget mot samma steg i angiven loop, med dess pad, medlem och locks.

**Längd.** En mod gäller den takt den står i. Samma mod i angränsande takter i samma rad är en sammanhängande modulation; det påverkar Ramp, List och slip.

**Ratchet** n delar stegets längd i n lika delar och triggar hitten i varje del.

## Slip-tempo

En tempo-mod (t.ex. 1/3) låter det aktiva lagret spelas i ett annat tempo medan huvudklockan tickar vidare i bakgrunden. När moden släpper fortsätter allt där det skulle ha varit, som om moden aldrig funnits.

- **Start:** när moden börjar startar ett lokalt spelhuvud på huvudklockans position i det aktiva lagret.
- **Under moden:** det lokala spelhuvudet går i det modulerade tempot (1/3 = stegen kommer tre gånger glesare). Samples spelas i normal hastighet och längd; bara avståndet mellan triggers ändras.
- **Återhopp:** när moden tar slut väntar motorn till nästa hela steg på huvudklockan och fortsätter därifrån.
- **Längd:** samma tempo-mod i angränsande takter är en sammanhängande modulation, så det lokala spelhuvudet startar inte om.
- **Pitch** ändras inte av tempo-moden, bara av en pitch-mod.

Spelhuvudet i GUI:t följer triggers, så under en tempo-mod tänds stegen i det långsammare tempot utan specialhantering.

## Uppspelning och export

Allt som spelar mer än ett ljud renderas först; uppspelningen spelar den färdiga buffern i realtid.

| Vy | Vad som spelas |
| --- | --- |
| Tag, Hits, Pads | Ett enskilt ljud direkt vid tryck, ingen rendering |
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
- **Taggar:** huvudtaggen används av mods; extra taggar (t.ex. ”Also: Ride”) är bara information. Max 8 taggar totalt, inklusive de fem förvalda (K, S, H, R, G).

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

## Utanför v1

- Sväng: nudge per steg (fältet finns redan, alltid 0).
- Låsbara seeds för att återskapa en tagning.
- Andra taktarter och valfritt antal steg per loop (t.ex. 14 steg för 7/8).
- REX2-import (proprietärt format).
- VST/CLAP-plugin, med händelsegeneratorn portad till Rust eller C++.
