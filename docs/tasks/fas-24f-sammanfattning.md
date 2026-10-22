# Fas 24f – Rättelser efter granskningen av fas 24: sammanfattning

## Gjort

1. **Trim och delning slår inte om slumpen** (`src/model/clips.ts`).
   - En loops offset slås inte längre runt till loopens längd när vänsterkanten dras eller klippet delas. Den får vara större än loopen, eller under 0 när kanten dras ut förbi början.
   - Loopen läses runt där den läses: `loopIndex` (i `generate.ts`, `swap.ts` och klippets mönster i `SongView.tsx`). Platsen för slumpen är `clipPlace`, utan runtslagning.
   - Song visar "from" inom loopen, som förut.
   - Tester: `generate.test.ts` (”a change does not reroll”), med en Random-pad med fyra medlemmar. Valen efter trim och delning är desamma i det som är kvar, och dras kanten tillbaka låter det som förut. Två tester i `model.test.ts` är ändrade (offset 28 i stället för 12, och −4 när kanten dras ut förbi början). Där finns också ett test för `loopIndex`.
2. **Scratch: sista steget fortsätter i den fart det kom med** (`scratchEnd` i `src/model/scratch.ts`). Begränsningen till [0,1] är borttagen, så nålen läser strax utanför inspelningen.
   - Tester i `scratch.test.ts`: Ramp ↗ och Ramp ↘ (från 0 till 1 och tillbaka) och Clear på 1 beat i Step bar (punkterna 0 och 1). Alla ger ett sista steg som rör sig, i samma fart som steget före.
   - I `src/ui/scratch.test.tsx` visar kortet ◂1.0 under alla 16 steg efter Ramp ↘.
3. **Svansen vid blockgränsen** (`Player.queue` i `src/ui/playback.ts`). Ett köat block spelar sitt första varv som sina egna ljud utan sin svans, plus svansen från blocket före (`afterTail`). Svansen läggs in från början och runt, som `folded`. Därefter loopar blocket sin egen buffer, med sin egen svans i början. Det gäller tills nästa block tar vid.
   - Köas nästa block medan det förra fortfarande är i sitt första varv, startar det förras egen buffer aldrig. Tas det köade blocket bort igen, får det förra en ny buffer från samma tid.
   - Tester i `playback.test.ts` (”the tail at a block boundary”).
4. **Gamla projekt: Random med hela tal slår hela tal också i stegraden.**
   - Ett 🎲-steg kan nu ha `whole: true` (`LaneStep` i `types.ts`). `laneValueAt` slår hela tal där målet annars slår fritt.
   - `upgrade-mods.ts` sätter flaggan bara där det behövs: inte på mål som redan slår hela tal, och inte på på/av-rader.
   - Den gyllene fixturen har två takter till, som jag gjorde med den gamla motorn. Jag checkade ut f48fa3b i en tillfällig worktree, som nu är borttagen. De första 6 takterna blev exakt som förut.
     - Takt 6: Random med hela tal på Volume (100 %) och Pan (50 %). Testet visar att det blir exakt samma slag som förut.
     - Takt 7: tomma List (se punkt 5).
5. **Gamla projekt: tom List eller Cycle tas bort** (`upgradeStepEffect` ger null). En tom Cycle på Pad member blir In turn, som förut. Tester i `lanes.test.ts`, också mot fixturen.
6. **Pad member har off, och en ny Pad member börjar off.**
   - Omfånget är 0–8, där 0 är off och också nollvärdet. Off låter paden välja som vanligt.
   - Clear sätter off. Ritning och 🎲-steg når off.
   - Texterna säger "off", "at off" och "off to member 3".
   - Gamla projekt behåller 1–8: ett gammalt 0, eller en Random från 0, blir medlem 1.
   - Tester: `lanes.test.ts` i model och i engine (off ger samma slag som utan mod, med Round robin och med Random), och `laneText.test.ts`.
7. **Exporten, Tape över ett klipp med ljudmodd eller Scratch:** `TODO(spec)` i `midi.ts` är borttagen och kommentaren hänvisar till beslutet. Ett nytt test i `midi.test.ts` täcker en bit kvar av tapen och ingen bit kvar. Testet för två bitar fanns redan.

## Klart när

- **Testerna går igenom:** 90 filer och 903 tester, mot 90 och 888 förut. Typecheck och lint är gröna.
- **Provat i en riktig webbläsare** (Chromium via Playwright, `npm run dev`).
  - **Magnus autosparning är orörd.** Servern gick på en egen port, localhost:5288, så sidan hade en egen tom IndexedDB. Projektet på localhost:5199 rördes inte.
  - **Projektet:** en syntetisk break på 1 takt i 16 slices (16 toner), där varje pad fick tre medlemmar till och Random. Jag importerade det som .zip via Project → Import .zip. Loopen låg i Main över 4 takter.
  - **Punkt 1:** jag drog vänsterkanten till 2.2.1, och klippet visade "from 1.2.1". Låtens WAV var sampel för sampel lika med den från före trimmen, från steg 20 till slutet (skillnad 0). Före steg 20 skilde de sig, vilket är rätt eftersom det steget togs bort.
  - **Punkt 1, delning:** en ny kopia av loopen på 3.2.1 delade klippet. Båda halvorna var lika med före delningen (skillnad 0), och den nya kopian lät annorlunda.
  - **Punkt 2:** i Scratch-kortet gav Clear ▸1.0 på alla 16 steg och Ramp ↘ ◂1.0 på alla 16, också det sista. Clear på 1 beat i Step bar gav ▸0.3 på båda stegen. Kurvan ritas strax under "start" i sista steget och klipps vid kanten.
  - **Punkt 6:** en ny Pad member visar "at off" och Step 1–4: off. Clear sätter off. Ett 🎲-steg på off blir "off to member 1", och att rita ner ett steg till botten ger off. En mod med bara Pad member off i Mod A över låten gav en WAV som var exakt lika med den utan mod (skillnad 0).
- **Det här och raden Aktuell fas i `CLAUDE.md`.**

## TODO(spec)

Inga nya `TODO(spec)` i koden. Två saker där specen inte stämmer med det som fanns, eller inte säger något:

- **En tom Cycle gjorde något förut.** Den gamla motorn spelade 1, 2, 3 … på alla mål, inte bara på Pad member: en tom Cycle på Volume gav +1, +2, +3 dB och så vidare. Specen säger att en tom List eller Cycle gjorde ingenting och tas bort, och det är byggt så. En tom Cycle på något annat än Pad member låter alltså inte som förut. Det spelar troligen ingen roll, eftersom ingen ritade så med flit. Fixturen har därför bara tomma List.
- **Pad member off under A och B:** specen säger inte vad som gäller när B är off och A har en medlem. Nu gäller samma som för Direction: B vinner, så off på B låter paden välja.

## Att granska

- **Offset utanför loopen.** En loops offset kan nu vara större än loopen eller negativ i sparade projekt. Allt som läser den går via `loopIndex` eller `clipPlace`. Projekt som sparades före fasen har redan runtslagna offset. Deras slump ändras inte förrän de trimmas, och det är just det felet som är rättat.
- **Svansen när nästa block tar vid:** svansen från blocket före läggs in runt det nya blocket om den är längre än blocket. Det är samma förenkling som `folded`.
- **Den gamla Dist med hela tal** (0 eller 1 förut, alltså 0 eller 100 %) slår nu hela procent mellan 0 och 100. Det är ett ovanligt fall.

## Att lyssna på

- **Play i Matrices, Loops eller Mods med Loop på och ett långt reverb:** hör svansen från ett block i början av nästa, i stället för att varje block får sin egen svans i början?
- **Song:** dra vänsterkanten på ett loopklipp med en Random-pad, eller dela det. Resten ska låta exakt som förut.
- **Scratch med Ramp ↘ eller Clear på 1 beat i Step bar:** sista steget hörs nu och läser strax utanför inspelningen. Låter övergången vid loopen bra?
