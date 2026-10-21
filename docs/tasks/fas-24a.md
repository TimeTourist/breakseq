# Fas 24a – Seeds och Reroll

Specen: `docs/spec.md`, Slump och seeds (under Uppspelning och export) och Faser. Allt där är Magnus beslut.

## Mål

All slump kommer ur seeds som sparas i projektet. Samma projekt låter alltid likadant (också efter Load och i export), Play i Matrices, Loops och Mods låter olika varje varv, och 🎲 ger nya seeds och går att ångra.

## Innehåll

1. **Seeds i modellen.** `Mod`, `Matrix`, `Pad` och `Clip` får `seed: number` (heltal 0 ≤ seed < 2³²). Nya objekt får en seed ur en injicerad källa i `CommandContext` (aldrig `Math.random` i model eller engine). Kopior och kloner: ett kopierat klipp behåller sin seed (specen); en klonad mod, matrix eller pad får nya seeds. *(Claudes val för kloner.)* Projektfiler utan seeds får seeds när de laddas.
2. **Slump ur seed och plats.** Generatorn tar inte längre en `Rng` för hela låten. Varje slumpval räknas ur en ren funktion av objektets seed och var det spelas (klippets seed, steget i låten, varvet), så att samma projekt ger samma triggers. Gäller allt som specen räknar upp: Random och No repeat på pads, Round robin, Shuffle och Stack i Swap, slump i mods och wow/flutter på Tape. Round robin fortsätter räkna över varven.
3. **Varv.** Play i Matrices, Loops och Mods räknar in varvets nummer, så varv 1, 2, 3 … låter olika. Song låter likadant varje varv. Lös TODO(spec) under Varv i loop (en buffer med fast antal varv räcker inte) på det sätt som passar renderingen idag (delar som renderas löpande), och skriv lösningen i specen som Claudes val.
4. **Reroll.** Kommandon som ger nya seeds, ett Undo-steg vardera: allt (headern, knappen 🎲 mellan Redo och Load, aria Reroll everything), en mod (🎲 i Mods bredvid modens namn), en matrix och en pad (🎲 i Matrices på matrisen respektive den valda paden), och ett klipp (🎲 på det markerade klippet i Song). Muspekaren säger vad den slår om och att Undo tar tillbaka det. New take finns inte (kolla att det är borta).

## Klart när

- Samma projekt ger samma triggers två gånger, efter Save och Load, och i Export WAV (test).
- Play i Mods på en mod med Random låter olika i varv 1 och 2 (test på generatorn med varvsnummer) och samma serie varv varje gång.
- 🎲 på ett klipp ändrar bara det klippets slump; Undo tar tillbaka den (test).
- Testerna går igenom, typecheck och lint är gröna, 🎲-knapparna är provade i en riktig webbläsare, och det finns en sammanfattning i `docs/tasks/fas-24a-sammanfattning.md`.
