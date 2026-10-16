# Fas 15 – Stretch

## Mål

Time stretch som på gamla samplers. En hit spelas som korta bitar som börjar allt längre fram och läggs över varandra, så att längden ändras men tonhöjden är kvar.

**Klart när:**
- Ett break på 136 BPM i en låt på 170 BPM håller sin tonhöjd med Fit to tempo på föräldern.
- Slices som spelas i ordning låter som ett helt stretchat break.
- En mod kan dra ut en fill till ett metalliskt ljud.
- Testerna går igenom, typecheck och lint är gröna, och det finns en sammanfattning i `docs/tasks/fas-15-sammanfattning.md`.

## Beslut (Magnus, 2026-10-16)

1. **Stretch är en egenskap på hiten**, bredvid pitch i Hits.
   - Lägena är Off (förvalt), Fit to tempo och Factor, med bitlängd i ms (förvalt 30 ms).
   - Fit to tempo stretchar med breakets tempo delat med låtens.
   - En one-shot har bara Off och Factor.
2. **Föräldern är makro:** dess stretch multipliceras med slicens egen.
3. **Var bitarna börjar** är ett val på hiten:
   - **Break** (förvalt): bitarna ligger i ett rutnät från breakets början i samplet.
   - **Hit**: bitarna börjar vid hitens start.
4. **Stretch är också ett mål i Mods**, med faktor och bitlängd. Moden har ett val för hur den möter hitens stretch:
   - **Multiply**: faktorerna multipliceras.
   - **Replace**: modens stretch gäller i stället för hitens.
5. **När A och B rör stretch** vinner B.
6. **Bara stretch byggs.** Stretch och pitch tillsammans flyttar tonhöjden men behåller längden.
7. **Längdlinjen i Loops** räknar med hitens och förälderns stretch men inte med modens.
8. **Mods läggs inte på breaks.** De stannar i Song.

## Min tolkning (granska gärna)

- **Generatorn delar upp hiten i bitar.** Varje bit blir en egen trigger med kort region och övertoning (Hann-fönster, halv överlappning). Renderaren behöver bara lära sig fade in.
- **Stretch 1 med Off** spelar hiten som idag, utan bitar.
- **Bitlängden från föräldern:** en slice utan egen bitlängd tar förälderns. Det gäller också valet av var bitarna börjar.
- **Baklänges:** bitarna går baklänges genom slicen, och varje bit spelas baklänges.
- **Ratchet:** varje retrigger stretchas för sig.
