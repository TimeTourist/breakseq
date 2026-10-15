# Fas 6 – sammanfattning

Song är nu en tidslinje med klipp på 1/16. Fill-fönstret i Loops är borttaget, eftersom samma sak görs genom att korta ett klipp.

## Gjort

- **Model:**
  - `Song.clips` (`Clip {id,row,ref,start,length,offset}`) ersätter `Song.rows`, och `Loop.window` är borttaget.
  - Kommandona `addClip`, `moveClip`, `copyClip`, `resizeClip` och `removeClip` finns i `src/model/clips.ts`. Överlapp löses genom att klippet under kortas, delas eller ersätts.
  - `setSongCell` finns kvar som genväg: den lägger ett klipp på en takt med förvald längd.
  - `upgradeProject` gör om äldre `rows` till klipp. Fill-fönster blir klippets start, längd och offset.
- **Engine:**
  - `songLayers` räknar per steg, och Fill går före Main. Där inget Main-klipp ligger är det tyst.
  - Mods har en körning per klipp. Intervall och Ramp räknas från klippets start. Slip gäller klippets exakta spann, även mitt i en takt.
- **UI:**
  - Song visar en linjal och ett rutnät på 1/16.
  - Klippen visar stegens pads i miniatyr, med prickade linjer där loopen börjar om och etiketten "from x.y.z" när början är trimmad.
  - Ett chip släpps på det steg man pekar på.
  - Ett klipp flyttas genom att dras (Alt kopierar), och kanterna ändrar längd i ett enda undo-steg. Delete tar bort ett klipp, ←/→ nudgar det (Shift: ett slag) och dubbelklick öppnar editorn.
  - Spelhuvudet är ett streck som räknas fram ur spelarens position i sekunder.

## Verifierat

- Det finns 150 tester, och typecheck och lint är gröna.
- I webbläsaren uppgraderades det gamla projektet med fill-fönster till klipp. Kanterna drogs med en riktig mus (M1 blev 6/16 och M2 trimmades till "from 1.2.1"), ett klipp flyttades med en riktig drag och drop, och ångra fungerade.

## Kvar till senare

- Mods-vyns lista över omfång visar fortfarande föräldra-pads.
- Klippets etikett kapas när klippet är smalt, men namnet finns i tooltip.
