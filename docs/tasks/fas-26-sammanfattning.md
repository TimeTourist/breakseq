# Fas 26 – Trance gate: sammanfattning

## Gjort

- **Modellen** (`src/model/types.ts`, `lanes.ts`, `commands.ts`):
  - Målet `tranceGate` är en på/av-rad (på = öppen) med `ModTranceGate`: Depth (−6, −12, −24 dB eller `'-inf'`), Open (25, 50, 75, 100 %) och Smooth (1–50 ms).
  - Målet ligger sist i `MOD_TARGETS`, så att de andra målen behåller sina nummer i tärningarna och gamla slumpval låter som förut.
  - En ny Trance gate är Straight: 16 steg av 1/16, alla öppna, Depth −∞, Open 50 %, Smooth 5 ms.
  - `clearTranceGate` öppnar alla steg och sätter Open 100 %. `tranceGatePreset` ritar Straight, Off-beat och 3-3-2 och behåller Depth och Smooth.
  - Kommandot kontrollerar reglagen som för de andra ljudmoddarna. Ändringar går via `replaceEffect` och går att ångra.
- **Generatorn** (`src/engine/trance-gate.ts`, ren): `tranceGates` ger en `Gate` per klipp (B vinner över A), med öppna delar i sekunder, Depth som linjär nivå och Smooth. `gateGain(gate, t)` säger nivån vid en tid. `Take` har nu `gates`. Ett klipp med Trance gate räknas i `audioClips`, så exporten gör det till en egen bit.
- **Renderingen:** `applyGates` (`render-audio-mods.ts`) multiplicerar varje bildruta under en gate med nivån där. Det görs sist i `finishHeard`, efter tape, Scratch och skarvarna, så allt som spelar hackas. Mixen med bara reverb och delay är redan tyst under klippet. Gaterna är med i cachenyckeln för tagningen.
- **Kortet** (`LaneCard`): meningen (Trance gate · 16 steps of 1/16 (1 bar), loops · open on 16 of 16 · depth −∞, open 50%, smooth 5 ms), Depth, Open, reglaget Smooth, förvalen Straight, Off-beat och 3-3-2, och Clear med egen title. Ramp är gråad (på/av-rad). Randomize och Shift: dice fungerar som på andra rader.
- **Förhandsvisningen** har en rad för Trance gate, som de andra på/av-raderna. Den visar ▮ för öppen och · för stängd.
- **+ Add effect** har Trance gate sist, efter Halftime.
- **Exportens tagning i appen** (`services.ts`, `playback.ts`) behåller `gates`, som den behåller `splices`.

## Klart när

- **Modellen:** testerna finns i `src/model/audio-mods.test.ts` (omfång, ny effekt, Clear, förval, validering, ångra).
- **Ljudet:** testerna mäter bufferten i `render.heard.test.ts` och `trance-gate.test.ts`:
  - Stängda steg är exakt 0 vid −∞. Vid −12 dB är de det som hörs gånger 10^(−12/20), med en skillnad under 1e-6.
  - Öppna steg är exakt som utan gate under Open av sin längd.
  - Kanterna går på Smooth: med 20 ms är nivån halvvägs 10 ms in.
  - En lång reverbsvans hackas i 1/16-pulser.
  - En Stutter under gaten hackas.
  - Clear låter som utan gate (skillnad under 1e-6).
  - B vinner över A.
  - 🎲-steg ger både öppna och stängda steg, och ljudet är exakt detsamma efter Save och Load.
  - Bitar ger samma ljud som en lång rendering, också med gate.
- **Exporten** (`render-slices.test.ts`, `services.test.ts`): klippet med Trance gate är en egen bit. Den är sampel för sampel lika med låten under klippet och är tyst i de stängda halvorna. Reverb/delay-WAV:en är exakt 0 under klippet.
- **Kortet** (`src/ui/audio-mods.test.tsx`): ny effekt, reglagen, förvalen, Clear, Ramp gråad och förhandsvisningens rad.
- **Provat i Chromium (Playwright)** på en egen dev-server, localhost:5231 (inte 5199, så Magnus autospar rördes inte):
  - test_break.wav på en loop av en takt.
  - Kortet med Off-beat såg rätt ut, och förhandsvisningens rad stämde.
  - Play i Mods spelade (Pass 3 efter fyra sekunder) utan fel eller varningar i konsolen.
  - I 390 px bredd finns ingen sidledes rullning.
  - En rendering med riktig Web Audio i sidan (Straight på brus, 120 BPM) gav öppna halvor med RMS ≥ 0,56, stängda halvor exakt 0 och oförändrat ljud efter klippet.
- **Testerna går igenom:** 94 filer och 975 tester. Typecheck och lint är gröna.

## Claudes val (inskrivna i specen under Trance gate)

- **Kanterna** är raka rampor på Smooth: upp från där ett öppet steg börjar, ner från där dess öppna del slutar.
- **Låten runt klippet** räknas som öppen. Gaten går ner på Smooth där klippet börjar, och den är helt uppe där klippet slutar. Därför hörs låten efter klippet och exportens bitar som de är. Följden är att ett stängt sista steg öppnar sig de sista Smooth ms före klippets slut.
- **Öppna delar som möts** är en, så Open 100 % på öppna steg är exakt som utan gate.
- **Ett 🎲-steg** vars chans misslyckas är stängt.
- **Depth −∞** sparas som `'-inf'`, eftersom JSON inte kan spara −Infinity.
- **Smooth** ställs i hela ms.
- **Förvalen** ligger bland kortets knappar, som Roll på Stutter.

## TODO(spec)

- **Raden Source: …** visas inte på Trance gate-kortet. Den säger "never itself or another audio mod", men Trance gate hackar just de andra ljudmoddarna. Vad ska kortet säga där, om något? (`LaneCard.tsx`, och i specen under Trance gate.)

## Att lyssna på och granska

- **Straight på ett break med lång reverb** (Reverb throw under klippet): hackas svansen som en trance gate?
- **Smooth 1 ms** kan klicka på ett break. 5 ms är förvalt, och 20–50 ms blir mjukt och "pumpigt". Låter förvalet rätt?
- **Off-beat och 3-3-2 med Depth −12 dB** jämfört med −∞.
- **Klippets slut:** med ett stängt sista steg öppnar gaten de sista 5 ms före klippets slut (se Claudes val). Hörs det?
- **A och B med var sin Trance gate som möts:** varje klipp räknar sina kanter för sig, så vid gränsen går nivån kort upp mot 1 om båda är stängda där.
