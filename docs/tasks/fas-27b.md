# Fas 27b – Crazy madness

Specen: `docs/spec.md`, Crazy madness (Två lägen, Fire and forget, Recept, Hur ett break fogas in). Skissen för ikonerna: `docs/sketches/crazy-smileys.html`. Bygger på 27a (förvalen som mods, med extrem/subtil).

## Mål

Lägesknappen i headern, receptet som ren funktion i model, att ett break som slicas i Crazy bygger till Song, och Go crazy.

## Klart när

- `project.mode` och `recipeSeed` i modellen, med förval och uppgradering av gamla projekt som specen säger; byte av läge går att ångra.
- Receptet är rena funktioner i `src/model` (ingen DOM, ingen `Math.random`): rulla receptet ur seeden, och bygg ett break in i projektet som ett kommando. Test per regel och variant (vilken variant ger vad), och att samma projekt bygger samma låt (deterministiskt).
- Att slica en trim första gången i Crazy bygger enligt receptet, i samma kommando som den automatiska kedjan eller direkt efter som ett steg i historiken (en Undo tar bort allt Crazy byggde). Total control gör som förut.
- Go crazy: allt utom samples och egna mods byggs om med ny `recipeSeed`, ett kommando, Undo tar tillbaka.
- Knapparna i headern med smileys från skissen och muspekartexterna i specen.
- Provat i en riktig webbläsare på egen port (inte 5199): nytt projekt, importera och slica ett break → en låt; ett andra break → ett nytt avsnitt; Go crazy → en annan låt; Undo. Också mobilbredd.
- Testerna går igenom, typecheck och lint är gröna, sammanfattning i `docs/tasks/fas-27b-sammanfattning.md`, raden Aktuell fas i `CLAUDE.md`.
