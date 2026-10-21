# Fas 24b – Stegrader och fliken Mods: sammanfattning

## Gjort

- **Modellen** (`src/model/types.ts`, `lanes.ts`, `upgrade-mods.ts`)
  - En stegeffekt har `step` (`'1/16' | 'beat' | 'bar'`) och `lane`: 1–16 steg, var och en fast (`{ v }`) eller 🎲 (`{ lo, hi, chance }`, chance 100/75/50/25). `rate` och formerna är borta från stegeffekter.
  - Tempo (slip) är en egen typ, `TempoEffect`, med sin rate och sina former (`TempoShape`), oförändrad.
  - `LANES` har omfång, nollvärde, steg och enhet per mål enligt tabellen i specen. Dists värden är nu procent.
  - Rena ritverktyg: måla, flytta 🎲-kant, 🎲 på/av, chans, Randomize (fast och 🎲), Ramp ↗/↘, Clear, Length, In turn. Slumpen i Randomize injiceras.
  - Kommandon kontrollerar stegrader (`laneProblem`). Nytt kommando `cloneMod` ("<namn> copy", nytt id och ny seed).
  - `upgradeProject` räknar om gamla List, Cycle, Ramp och Random till stegrader (se Gamla projekt i specen).
- **Generatorn** (`src/engine/mods.ts`)
  - Stegraden räknas från klippets innehållsstart och loopar på sin längd.
  - Ett 🎲-steg slår ur modens och klippets seeds, målet och vilket steg i klippet det är, samma plats som Random förut. Värdet hålls över steget.
  - Misslyckad chans gör ingenting. På/av-rader: chansen är sannolikheten för på.
  - Pad member: en medlem paden saknar spelar medlem 1. Direction: av lämnar hittens riktning.
  - `modPassRows` (`mod-pass.ts`) ger förhandsvisningens rader för ett varv med samma seeds som Play. `padsOnlyUnderStretch` säger vilka pads som bara hörs under Stretch-mods.
- **Fliken Mods** (`ModsView`, `LaneCard`, `LaneEditor`, `ModCards`, `ModPreview`, `laneText`)
  - Listan med namn, antal effekter och ♪; + New mod; Start from kvar, med förvalen ritade som stegrader.
  - Rubriken: namnet, Rename, Clone, Delete, 🎲 och antalet effekter.
  - Alla effekter som kort under varandra. Varje kort har namn, enhet, Remove, meningen (som skissen), Step, Length, Randomize, Shift: dice, Ramp ↗/↘, Clear och egna val:
    - Pitch: Values.
    - Filter: Type och Resonance 0/30/60.
    - Dist: läge.
    - Reverb: storlek.
    - Delay: tid och feedback.
    - Stretch: Multiply/Replace och Grain.
    - Pad member: In turn.
  - Linjal och stegrad med spöksteg efter ↻, 🎲 vid hovring (svagt synlig utan hovring på telefon), chans-knapp och bubbla under draget.
  - Swap, Tempo och Tape behåller sina meningar på ett kort (utan målväljaren).
  - + Add effect i specens ordning (Scratch och ljudmoddarna kommer i 24c/24d).
  - Förhandsvisningen: Plays on, varvets nummer, rutnätet med loopens steg och en rad per effekt för varvet som spelas, med spelhuvudets steg markerat.
- **Reglage som inte hörs** (`Unheard.tsx`), gråade med förklaring i title och synlig text:
  - Ramp på på/av-rad (avstängd).
  - Multiply/Replace när ingen hit i Plays on har egen stretch.
  - Hittens Grain i Matrices när paden bara spelas under Stretch-mods i Song.
- **Bort:** `ModGraph.tsx`, `modText.ts` (parse, format, randomMod), StepSentence, New example och grafernas CSS.

## Klart när

1. **Volume på 3 steg av 1/16 faller olika på varje slag:** `a Volume of 3 steps of 1/16 falls differently on every beat` (`src/engine/lanes.test.ts`).
2. **🎲 på Pitch: olika i varv 1 och 2, samma i Song varje gång:** `a dice step on Pitch gives different values in pass 1 and 2, and the same values in Song every time`.
3. **Gamla projekt ger samma triggers:**
   - Före ändringen sparades triggers från den gamla motorn för ett projekt med List (två klipp, det ena trimmat), Cycle, Ramp, Random och en Random med chans 30 % (`src/engine/fixtures/old-shapes*.{ts,json}`).
   - Takt 1–5 (List, Cycle, Ramp, Random) blir exakt lika efter omräkningen.
   - Chansen 30 % blir 25 %: där båda slår är värdet detsamma.
4. **Provat i Chromium (Playwright) på 1400 px och 390 px:**
   - Rita och måla med riktig mus, med bubblan "−15 dB" under draget. Ett drag är ett Undo-steg.
   - 🎲 på ett steg, chans 100 → 75, och dra 🎲-kanten ("🎲 −23 dB to −11 dB"). Målning går inte över 🎲-steget.
   - Randomize, Shift-klick och Shift: dice, Ramp ↗ och sedan ↘, och Clear.
   - Måla på/av på Direction, och se Ramp gråad med "An on/off lane has no slope".
   - Play: varvet räknas upp (Pass 3) och spelhuvudets steg lyser i rutnätet.
   - På 390 px finns ingen sidledes rullning, och ritning, 🎲 och Ramp fungerar.
   - Magnus autospar (localhost:5199) laddades med den nya koden utan fel. Den har inga mods och ändrades inte.
5. **Testerna, typecheck och lint är gröna.** 80 filer och 779 tester, mot 78 och 740 förut.

## Claudes val (inskrivna i specen)

- Gamla projekt:
  - Ramp får lika många steg som modens längsta klipp har intervall (16 utan klipp), så att den blir exakt när klippen är lika långa.
  - Random på Direction får halva chansen.
  - Cycle är exakt där varje intervall har en hit.
  - Dist räknas om till procent.
- Tempo behåller sina former och sin rate.
- Misslyckad chans gör ingenting. 🎲 slår hela tal på Ratchet, Pad member och Pitch i halvtoner, annars fritt. Free pitch ritas i tiondelar.
- Direction: av lämnar hittens riktning.
- Ramp-knappens riktning räknas ut ur raden.
- Enheterna member och on/off. In turn räknar medlemmar i Plays on-loopen.
- Förvalen flyttade in i omfånget och resonansvalen (Gate −24 dB, Thin out från 60 Hz, resonans 30/60 %).
- Rutnätets rader för Swap, Tempo och Tape, och att det visar varvet som spelas.
- Vad som gråas och när, och att Multiply/Replace och Grain fortfarande går att ändra.
- Listan står statiskt (inte sticky) på smal skärm i Mods.

## TODO(spec)

Inga nya.

## Att granska och prova

- **Rita på telefon.** Steg på 1/16 blir smala (cirka 10 px på 390 px), och 🎲 syns svagt på alla steg utan hovring. Det är som skissen, men prova med fingret.
- **Stegraderna går inte att ändra med tangentbordet**, bara med pekare och knappar. Säg till om det behövs.
- **Rutnätet** på långa loopar (64 steg) rullar i sidled. Swap-raden visar slutet av hittens namn ("1" i "d 1"), och hela namnet syns i title.
- **Pad member med Clear** sätter medlem 1 på alla steg, alltså över padens eget val (Random och så vidare). Det följer specens nollvärde, men lyssna om det är vad du vill.
- **Multiply/Replace och Grain** är gråade men går att ändra. Ramp på på/av-rader är avstängd.
- **Flakigt test (fanns före fasen):** `render-chunks.test.ts > gives the same tape, which plays on past the seams it starts before` faller ungefär var tredje körning, också på baslinjen. Ej rört.
