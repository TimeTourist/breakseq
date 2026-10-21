# Fas 24d – Scratch

Specen: `docs/spec.md`, Scratch. Skissen: `docs/sketches/mods.html` (Scratch i moden DJ hands).

## Mål

Scratch spelar in en bit av det som hörs och spelar den efter en ritad nålrörelse, med en crossfader, som en DJ.

## Innehåll

1. **Modellen:** inspelningens längd, step, nålpunkter (en per steg) och faderrutor (hel eller två halvor, öppen eller stängd).
2. **Ljudet** följer den utjämnade kurvan (Catmull-Rom, som skissen ritar), med fart och riktning, tyst när skivan står still och där fadern är stängd; korta övertoningar vid fadern så att det inte klickar. Inspelningen använder vägen från fas 24c. Loopen är ett hopp tillbaka, utan drag.
3. **Kortet** som specen och skissen: Records the first, Step, Length, Start from (Baby, Chirp, Transformer, Tear), Randomize, Ramp ↗/↘, Clear, nålraden med kurva och fart under varje steg, faderraden, meningen.

## Klart när

- Clear låter som utan Scratch under klippet (test: samma ljud inom avrundning).
- Baby spelar baklänges på varannat steg och Chirp är tyst där fadern är stängd (test).
- Förvalen är lyssnade på i en riktig webbläsare.
- Testerna går igenom, typecheck och lint är gröna, och det finns en sammanfattning i `docs/tasks/fas-24d-sammanfattning.md`.
