# Fas 24d – Scratch: sammanfattning

## Gjort

- **Modellen** (`src/model/scratch.ts`, `types.ts`): `ScratchEffect` har
  - inspelningens längd (1 beat, 2 beats, 1 bar, 2 bars)
  - Step
  - nålpunkter, 2–16, en per steg, fästa vid 1/(2·R)
  - faderrutor, hela eller i två halvor, öppna eller stängda

  Till det finns ritverktygen från skissen:
  - förvalen Baby, Chirp, Transformer och Tear, med skissens punkter och fader
  - Clear och Ramp ↗/↘ (riktningen räknas ur punkterna, som på stegraderna)
  - Randomize (skissens slumpvandring)
  - längden, och klick och Alt-klick på fadern

  En ny Scratch är Baby på 1 bar. Kommandona kontrollerar effekten. `scratch` ligger sist i målen, så gamla slumpval låter som förut.
- **Ljudet** (`src/engine/scratch.ts`) använder vägen från 24c:
  - Varje steg blir en *skarv*. Den läser det som hörs längs stegets Catmull-Rom-kurva, med fart, riktning och tonhöjd som en skiva.
  - En skarv är tyst där steget står still (under 0,05×) eller fadern är stängd.
  - Skarvar bredvid varandra tonas över på 3 ms, så faderkanterna och hoppet vid loopen klickar inte.
  - Sista steget fortsätter i den fart det kom med. Vid loopen lyfts nålen och hoppar till första punkten.
- **Var Scratch ligger i renderingen:** bredvid Tape (led 2).
  - Den läser det som hörs utan Tape och Scratch, och ersätter det som hörs under klippet.
  - Ljudmoddarna hör alltså Scratch som de hör Tape.
  - Det stämmer med specen och med 24c utan ändring. `applySplices` kan nu läsa ur en annan källa än den den spelar över.
- **Kortet** (`src/ui/ScratchCard.tsx`) som skissen:
  - Records the first … under the clip, Step och Length (2–16).
  - Start from, 🎲 Randomize, Ramp och Clear, och färgförklaringen.
  - Nålraden med kurvan (gult framåt, blått bakåt, streckat stilla), spöken efter ↻ och hoppet streckat. Drag och målning av punkter med bubbla, och ett drag är ett ångra-steg.
  - Farten under varje steg (▸2.4, ◂2.4, –).
  - Faderraden med klick och Alt-klick, och stängda rutor skuggade i nålraden.
  - Meningen.

  Scratch finns i + Add effect efter Tape. Förhandsvisningen har en rad för Scratch (▸ ◂ –, fadern som skugga).

## Klart när

1. **Clear låter som utan Scratch under klippet:** `Clear sounds as without Scratch under the clip` (`render.scratch.test.ts`), skillnad under 1e-4. I Chromium var skillnaden 6e-8 med Amen.
2. **Baby spelar baklänges varannat steg:** `Baby plays backwards on every other step …`.
   - Som skarvar i `scratch.test.ts`.
   - Som ljud i `render.scratch.test.ts`: utgången är det som hörs läst där kurvan pekar, baklänges.
3. **Chirp är tyst där fadern är stängd:** `Chirp is silent where the fader is closed`, både som skarvar och som ljud. I Chromium med Amen var RMS exakt 0 i alla stängda halvor, efter övertoningen.
4. **Förvalen i en riktig webbläsare** (Chromium via Playwright, Magnus autospar på localhost:5199):
   - Kortet ser ut som skissen.
   - Drag av punkter, klick och Alt-klick på fadern, förvalen, Clear, Ramp åt båda håll och Randomize ger rätt mening och data.
   - Play i Mods spelade Chirp utan fel eller varningar i konsolen.
   - På 390 px finns ingen sidledes rullning.
   - Varje förval renderades med riktig Web Audio på Amen:
     - Ljud under klippet för alla (RMS 0,07–0,10) och ingen NaN.
     - Exakt samma ljud före klippet.
     - Inga hopp större än i Amen själv.
   - Ändringarna ångrades (15 steg, till Nothing to undo), och autosparen har åter 0 mods.

   Själva lyssnandet är kvar åt Magnus (se nedan).
5. **Testerna, typecheck och lint är gröna.** Det är 89 filer och 863 tester, mot 85 och 823 förut. `npm test` kördes två gånger.

## Claudes val (inskrivna i specen under Scratch, ”Hur Scratch verkar”)

- **Var Scratch ligger i renderingen:** bredvid Tape, före ljudmoddarna (se ovan).
- **Tape och Scratch samtidigt:** Scratch hörs, och tapen tonas över till den på 3 ms. Har A och B båda Scratch vinner B.
- **Inspelningen** börjar där klippet börjar på tidslinjen, som Tape. Nålraden räknas från klippets innehåll, som stegraderna.
- **Kurvans ändar fortsätter rakt.** Skissen upprepar ändpunkten, vilket ger halv fart i första och sista steget. Då vore Clear inte 1× där. Kortet ritar samma kurva som ljudet.
- **Clear behåller Length**, som skissen (ett varv över raden). Clear låter alltså som utan Scratch bara när raden är lika lång som inspelningen. Med Baby-längden (8 steg av 1/16 på 1 bar) börjar inspelningen om efter en halv takt.
- **Detaljer:**
  - Kurvan kan slå över lite förbi inspelningens ändar vid en vändning och läser då det som hörs strax utanför.
  - Meningen räknar en paus i ett bakåtdrag som samma drag.
  - Kortet har ingen Source-rad, som skissen.
  - Spelhuvudet följer huvudklockan.

## TODO(spec)

- **MIDI-, bit- och REX-exporten** känner inte till Scratch, och inte heller ljudmoddarna. Under dem spelar MIDI-filen slagen utan dem. Frågan i specen och i `midi.ts` gäller nu båda.

## Att lyssna på och granska

- **Förvalen på Amen:** låter Baby, Chirp, Transformer och Tear som en DJ? Är farten rimlig? Baby går i 2,4× på 1 bar, vilket är snabbt. Med Records the first 1 beat blir det lugnare.
- **Chirp:** fadern stängs mitt i steget innan skivan vänder, inte exakt vid vändningen. Låter det som en chirp?
- **Clear med 8 steg** spelar första halvtakten två gånger (se ovan). Vill du att Clear också sätter Length så att raden täcker inspelningen?
- **Kurvans raka ändar** gör att Baby börjar i full fart i stället för att mjukt komma igång.
- **Hoppet vid ↻** tonas över på 3 ms. Det är mjukt, men hörs som ett hack, vilket är avsikten.
- **Tape och Scratch i samma takt:** Scratch vinner.
- **På 390 px** blir farttexterna under 1/16-stegen trånga och går in i varandra (som i skissen).
