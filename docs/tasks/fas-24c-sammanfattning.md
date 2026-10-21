# Fas 24c – Mods som samplar det som hörs: sammanfattning

## Gjort

- **Det flakiga testet** (`render-chunks.test.ts > gives the same tape …`) är förklarat och rättat, först i fasen.
  - I node-web-audio-api är `getChannelData` en vy av minne som `AudioBuffer` äger, men vyn håller inte bufferten vid liv. När bufferten samlats in läser vyn frigjort minne.
  - `renderChunk` sparade bara vyer och lade ihop dem först efter att andra delar renderats. Ibland blev då sista bildrutan i ett slag 0 i stället för −0,31.
  - Reproducerat: 1–17 fel på 300 varv före rättningen, 0 på 900 efter.
  - Rättat på två ställen: delarna sparar kopior, och render-testerna laddar Web Audio genom `src/test/web-audio.ts`, där varje vy håller sin buffer vid liv som i en webbläsare. Samma fel dök upp i ett annat test (`flutter changes the sound …`) under fasen.
  - I webbläsaren händer det inte, men kopiorna kostar inget märkbart.
- **Det som hörs är en källa.** Renderingen sker nu i tre led på låtens tidslinje:
  1. *Det som hörs*: alla slag, också de under Tape, med stegeffekter, reverb och delay. Det renderas i bitar med cache som förut.
  2. *Tape*: tapen spelar in det som hörs i segmentet, alltså också reverb och delay, och ersätter det som hörs under sitt klipp.
  3. *Ljudmoddarna*: de spelar bitar av ljudet efter led 2. Ingen läser sig själv eller en annan.

  Scramble med Whole song läser bara ur bufferten, så bitarna och cachen påverkas inte. En rendering med alla moddar tog cirka 30 ms i Chromium.
- **Generatorn** (`src/engine/audio-mods.ts`, rena data) beskriver varje ljudmodd som *skarvar* (`Splice`): var den hörs, varifrån i det som hörs den läser (ett polynom över skarven, så farten och tonhöjden kan ändras), nivå och korn.
  - `Take` har nu `heard` (alla slag) och `splices`.
  - `Tape.source` finns inte längre.
- **Renderingen:**
  - `render-audio-mods.ts` spelar skarvarna med vanlig aritmetik: linjär läsning, korn med Hann-fönster och 3 ms övertoningar.
  - `render-heard.ts` spelar tapes, som förut med Web Audio, och sedan skarvarna.
  - `renderTakeWhole` och `renderTakeWithTail` gör samma led, och testet att bitar ger samma ljud som en lång rendering gäller fortfarande.
- **Modellen:**
  - Scramble, Stutter, Freeze, Reverse och Rewind är stegrader med egna inställningar.
  - Halftime är en egen effekt utan stegrad.
  - Kommandona kontrollerar inställningarna.
  - Målens nummer i tärningarna är oförändrade, så gamla slumpval låter som förut.
- **Fliken Mods** som skissen:
  - Korten har meningarna, raden Source … och valen med skissens etiketter.
  - Stutter har förvalet Roll.
  - Around the clip är gråad med förklaring när Take from inte är ± bars.
  - Under Scramble finns bilden Where each cell comes from med 🎲 Reroll.
  - Halftime har ett kort utan stegrad.
  - + Add effect har de sex efter Tape.
  - Förhandsvisningens rutnät har en rad per ljudmodd.

## Klart när

1. **Stutter Roll på sista slaget ger 1/16, 1/32 och 1/64:** `a Roll on the last beat of a bar repeats 1/16, then 1/32, then 1/64` (`audio-mods.test.ts`). Den rullen renderas också i `render.heard.test.ts`.
2. **Scramble Whole song spelar rutor från andra delar av låten, samma varje gång tills 🎲:** `with Take from Whole song plays cells from other parts of the song, the same cells every time` och `🎲 on the mod picks other cells`.
3. **Reverse, Freeze, Rewind och Halftime har var sitt test:**
   - Som skarvar i `audio-mods.test.ts`: baklänges på sin plats, hållet korn som ton med Spread ur seeds, Fast/Slowing/Spin-back och halv fart från klippets början.
   - Som ljud i `render-audio-mods.test.ts` och `render.heard.test.ts`: var och en ändrar ljudet under sitt klipp, och före och efter klippet är ljudet detsamma.
4. **En Tape över ett reverbkast spelar in svansen:** `a Tape over a reverb throw records the tail`. I tapens andra varv, efter slaget, hörs svansen med kastet och är tyst utan.
5. **Lyssnat i Chromium (Playwright), med Magnus autospar på localhost:5199:**
   - Moden med alla sex kort, meningarna, de gråade reglagen och bilden ser ut som skissen. På 390 px finns ingen sidledes rullning.
   - Play i Mods spelade (Pass 5 efter fyra sekunder) utan fel eller varningar i konsolen.
   - Varje modd renderades med riktig Web Audio på Amen-break 1:
     - Ljud under klippet för alla (RMS 0,03–0,13) och skillnad mot utan modden, men exakt samma ljud före klippet.
     - Inga NaN.
     - Tape med reverbkast gav starkare andra varv (0,133) än utan (0,109).
   - Ändringarna i projektet ångrades (8 steg, till Nothing to undo), och autosparen har åter 0 mods.
6. **Testerna, typecheck och lint är gröna.** Det är 85 filer och 823 tester, mot 80 och 779 förut. `npm test` kördes tre gånger.

## Claudes val (inskrivna i specen)

- **Källan har med tape.** Specen sade att Tape inte räknas in (Claudes val), men skissen och fas 24c säger att den gör det (Magnus beslut). Det är rättat i specen.
- **Som en glitch-effekt på utgången:**
  - Under ett klipp ersätter modden eller tapen det som hörs, också reverb som klingade före.
  - Efter klippet hörs det som hörs på huvudklockan igen, också svansar av det som spelade under klippet.
  - Det gäller nu även Tape. Förut klingade reverb från före tapen vidare under den, och slagen under tapen skickade inget.
- **Tapens inspelning** har med det som klingar in i segmentet. Reverb/delay-WAV:en i exporten är tyst under en tape, eftersom tapen redan är en egen bit.
- **Ordningen** när olika ljudmoddar verkar samtidigt: Rewind, Stutter, Freeze, Reverse, Scramble, Halftime. Har A och B samma ljudmodd vinner B.
- **Detaljerna:**
  - Rutor och Grabs ligger på låtens rutnät.
  - Stutters upprepningar räknas per Grabs-fönster (pitch och gate).
  - Freeze håller ett spann av på-steg vid dess början. Spread är upp till ± Spread av ett korn.
  - Rewinds tre kurvor.
  - Halftime läser från klippets början, och Keep pitch spelar korn på 30 ms.
  - Ramp är inte gråad på Stutter, eftersom den gör något där. 🎲 på Stutter ger ±1 som skissen.
  - Where each cell comes from visar blocket som Play renderar.

## TODO(spec)

- **MIDI-, bit- och REX-exporten** känner inte till ljudmoddarna. Under dem spelar MIDI-filen slagen utan moddarna. Ska ett klipp med ljudmoddar bli en egen bit, som en tape? (I specen under Hur ljudmoddarna verkar och i `midi.ts`.)

## Att lyssna på och granska

- **Tape efter klippet.** Nu hörs svansar och långa slag från under tapen när klippet slutar. Lyssna på en Tape stop med reverb på slagen: hörs svansen komma tillbaka efter tapen?
- **Stutter Roll med Grabs beat** jämfört med 1/16, och Pitch per repeat. Låter rullen som en rulle?
- **Freeze:**
  - Med Spread 0 blir det en surrande ton (10 ms ger cirka 200 Hz, 80 ms cirka 25 Hz).
  - Med Spread 25–50 % blir det brusigare.
  - Är Grain-värdena rätt för det du tänkt?
- **Rewind Spin-back** (bromsar, vänder och snurrar bakåt) jämfört med Slowing. Är det så du menar med de tre kurvorna?
- **Halftime med Keep pitch** låter som stretch med korn på 30 ms, alltså lite metalliskt.
- **Ordningen** när flera ljudmoddar ligger på samma steg (Glitch box): bara en hörs åt gången.
- **Scramble i Mods** med en loop av en takt: blocket är ett varv, så Whole song, ± bars och Inside the clip blir samma sak där. I Song märks skillnaden.
- **Snabba Rewinds och ×2** läser ljudet snabbare utan filter, så det kan vika sig (aliasing), som en gammal sampler.
