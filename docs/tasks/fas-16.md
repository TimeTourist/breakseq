# Fas 16 – Export i Project

## Mål

Export och snapshots samlas i Project, så att versioner kan jämföras och exporteras utan att man byter mellan dem.

**Klart när:** två snapshots kan spelas och exporteras från Project utan att laddas, och sidhuvudet har Save och New snapshot där Export låg. Testerna går igenom, typecheck och lint är gröna, och det finns en sammanfattning i `docs/tasks/fas-16-sammanfattning.md`.

## Beslut (Magnus, 2026-10-16)

1. **Export WAV flyttar från sidhuvudet till Project** och exporterar låten som den är nu.
2. **Varje snapshot i listan** får knappar för att spela och exportera den. Den renderas direkt från snapshoten och laddas inte, så det laddade projektet rörs inte.
3. **Sidhuvudet** får Save, som skriver över den aktiva snapshoten, och New snapshot där Export låg.

## Min tolkning (granska gärna)

- **Loopar exporteras inte längre från Loops.** Export finns bara i Project och gäller låten.
- **Utan öppen projektmapp** är Save och New snapshot avstängda, med en förklaring.
- **Play på en snapshot** spelar dess låt. Play i sidhuvudet stannar den, som vanligt.
