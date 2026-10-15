# Fas 6 – Klipp i Song

## Mål

Song blir en tidslinje med klipp på 1/16-upplösning. Loopar och mods läggs ut som klipp, som kan flyttas och ändras i längd från båda kanterna. Fill-fönstret i Loops tas bort, eftersom samma sak görs genom att korta ett klipp.

**Klart när:** M1 kan spelas i 6/16 och sedan börja om, en fill kan ligga som ett klipp på sista 1/4 av en takt och spela sin egen sista fjärdedel, och en mod kan verka på bara en del av en takt. Testerna nedan går igenom, typecheck och lint är gröna, och det finns en sammanfattning i `docs/tasks/fas-6-sammanfattning.md`.

## Beslut (Magnus, 2026-10-15)

1. **Ett släppt klipp får loopens egen längd.** En mod blir 1 takt.
2. **Vänsterkanten trimmar:** klippet börjar senare och spelar innehållet därifrån (offset), som i en DAW.
3. **Där Main saknar klipp är det tyst.** Det som syns är det som spelas.
4. **Ett Fill-klipp tar över under sin längd.** Main räknar vidare under det.
5. **Klipp i samma rad överlappar inte.** Ett nytt eller flyttat klipp kortar, delar eller ersätter det som ligger under.

## Ingår

### Model

1. **Ny modell för låten:** `Song.clips: Clip[]` ersätter `Song.rows`.
   - `Clip = { id, row, ref, start, length, offset }`, där `start`, `length` och `offset` räknas i steg om 1/16.
   - `offset` är var i innehållet klippet börjar. För en loop räknas det runt loopens längd.
2. **Kommandon:**
   - `addClip(row, ref, start)`: med förvald längd och kapat vid låtens slut.
   - `moveClip(id, row, start)`: loopar flyttas mellan Main och Fill, mods mellan A och B.
   - `copyClip(id, row, start)`.
   - `resizeClip(id, edge, position)`: minst 1 steg. Vänsterkanten ändrar även `offset`.
   - `removeClip(id)`.
   - Alla löser överlapp enligt beslut 5.
3. **Uppgradering:** äldre projekt med `rows` görs om till klipp.
   - En Main-cell ger ett klipp fram till nästa Main-cell eller låtens slut.
   - En Fill-cell ger ett klipp med fillens längd, och dess fönster blir klippets start, längd och offset.
   - Mod-körningar ger ett klipp per körning.
4. `Loop.window` och `setFillWindow` tas bort. Referenskontroll och `unsliceBreak` använder klipp.

### Engine

1. **Lager per steg:** ett Fill-klipp går före ett Main-klipp.
   - Innehållets index är `(t − start + offset) mod looplängd`.
   - Main räknar alltid utifrån låtens tid, så den fortsätter i takt under en fill.
2. **Mods per steg:** varje klipp är en körning. Intervallen räknas från klippets början (plus offset), och Ramp sträcker sig över klippets längd. Slip-tempo gäller klippets exakta spann, även när det inte ligger på taktgränser.
3. `loopSong` och `modPreviewSong` gör klipp.

### UI

1. **Song som tidslinje:**
   - En linjal med takter och slag, och ett rutnät på 1/16.
   - Klipp släpps från biblioteket på det steg man pekar på.
   - Ett klipp dras för att flyttas, och med Alt kopieras det.
   - Kanterna dras för att ändra längd, med snäpp till 1/16.
   - Ett valt klipp tas bort med Delete och nudgas med ←/→ (Shift: ett slag). Dubbelklick öppnar editorn.
   - Spelhuvudet är ett streck i rätt position.
   - **Klippen visar innehåll:** loop-klipp visar stegens pads i miniatyr, med linjer där loopen börjar om och etiketten "from x.y.z" när början är trimmad. Mod-klipp visar namn och mål.
2. **Loops:** fönsterlisten och de nedtonade stegen tas bort.

## Tester som krävs

- [x] M1 (4 takter) i ett klipp på 6/16 och därefter M1 igen ger stegen 0–5 och sedan 0, 1, 2, …
- [x] Ett klipp längre än loopen börjar om loopen. Offset trimmar början.
- [x] Där inget Main-klipp ligger blir det inga triggers.
- [x] Fill-klipp på sista 1/4 med offset 12 spelar fillens steg 12–15. Main fortsätter i takt efter fillen.
- [x] En mod i ett klipp på 4/16 påverkar bara de stegen. Ramp går över klippets längd.
- [x] Slip-tempo i ett klipp som inte börjar på en taktgräns.
- [x] Överlapp: ett nytt klipp över ett annat kortar, delar och ersätter rätt.
- [x] `resizeClip` från vänster ändrar `offset`, och längden är minst 1 steg.
- [x] Uppgradering av `rows`, inklusive fill-fönster, ger samma triggers som före.
- [x] UI: ett chip släppt på ett steg ger ett klipp med loopens längd. Att dra i högerkanten ändrar längden, och en flytt flyttar klippet.
