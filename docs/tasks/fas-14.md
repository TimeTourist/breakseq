# Fas 14 – Padens val

## Mål

En pad väljer själv vilken medlem som spelar, så att en hi-hat kan låta levande utan mods.

**Klart när:** en hi-hat-pad med fyra hits låter olika varje gång utan mods, och en step lock eller en Pad member-mod går före. Testerna går igenom, typecheck och lint är gröna, och det finns en sammanfattning i `docs/tasks/fas-14-sammanfattning.md`.

## Beslut (Magnus, 2026-10-16)

1. **Lägen:** Top (som idag), Round robin, Random och Random utan upprepning (aldrig samma två gånger i rad).
2. **Ordning:** step lock går före moden, och moden går före padens läge.
3. **Round robin räknas per pad över hela låten**, i tidsordning, oavsett vilken loop paden ligger i.
4. Görs efter fas 13.

## Min tolkning (granska gärna)

- **Läget väljs i padens panel i Hits**, som en rad med fyra knappar. Det sparas på paden.
- **Slumpen** tas från den injicerade `Rng`, som allt annat i generatorn.
- **Swap** väljer först vilken pad eller hit som spelar. Väljer Swap en hel pad gäller padens läge, och väljer Swap en viss hit spelas den hiten.
