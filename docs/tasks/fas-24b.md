# Fas 24b – Stegrader och fliken Mods

Specen: `docs/spec.md`, Mods och Stegrader och fliken Mods. Skissen: `docs/sketches/mods.html` (öppna den i en webbläsare; dess JS visar exakta etiketter, meningar och värden). Där skissen och specen skiljer sig gäller specen.

## Mål

Fliken Mods byggs om enligt skissen: alla effekter som kort med ritbara stegrader, 🎲-steg, Randomize, Ramp ↗/↘ och Clear, och en förhandsvisning på en loop. Formerna List, Cycle, Ramp och Random ersätts av stegrader.

## Innehåll

1. **Modellen.** En stegeffekt har `step` (1/16, beat, bar) och `lane`: 1–16 steg, var och en fast (`{ v }`) eller 🎲 (`{ lo, hi, chance }`, chance ∈ 100/75/50/25). `ModShape` och `rate` tas bort. Gamla projekt räknas om när de laddas enligt specen (Gamla projekt). Swap, Tempo och Tape är oförändrade.
2. **Generatorn.** Stegraden räknas från klippets början och loopar på sin längd över klippet. Ett 🎲-steg slår sitt värde ur modens/klippets seed och platsen (fas 24a); misslyckad chans ger målets nollvärde. På/av-rader: chansen är sannolikheten att steget är på. Samverkan A/B och ordningen är som förut.
3. **Fliken Mods** enligt specen och skissen: listan med Start from kvar, modens rubrik (Rename, Clone, Delete, 🎲), korten med mening, Step, Length, Randomize/Shift: dice, Ramp ↗/↘, Clear, effektens egna val (också de som skissen saknar: Dists läge, reverbens storlek, delayens tid och feedback, stretchens bitlängd och Multiply/Replace), linjal och stegrad; + Add effect; förhandsvisningen med Plays on och rutnätet per varv. Pad member (In turn) och Direction (på/av) får rader. Swap, Tempo och Tape behåller sina reglage på ett kort.
4. **Reglage som inte hörs** gråas ut med en kort förklaring på engelska (title och synlig text), här och i Matrices: Multiply/Replace när hitten saknar egen stretch, hittens bitlängd under en stretch-mod, Ramp på på/av-rader.
5. **Rensa bort** grafen, New example och formernas kod och texter. Mods-texterna (meningarna) följer skissen.

## Klart när

- En Volume på 3 steg av 1/16 hörs falla olika på varje slag (test på triggers).
- Ett 🎲-steg på Pitch ger olika värden i varv 1 och 2, och samma värden i Song varje gång (test).
- Ett projekt med List, Cycle, Ramp och Random laddas och ger samma triggers som före omräkningen, där omräkningen är exakt (List, Cycle), och närmaste möjliga för Ramp och Random (test).
- Rita, måla, 🎲-steg, chans, Randomize, Ramp och Clear är provade i en riktig webbläsare (Playwright), också på smal skärm.
- Testerna går igenom, typecheck och lint är gröna, och det finns en sammanfattning i `docs/tasks/fas-24b-sammanfattning.md`.
