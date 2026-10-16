# Fas 15 – Stretch

## Mål

Time stretch som på gamla samplers. En hit spelas som korta bitar som börjar allt längre fram och läggs över varandra, så att längden ändras men tonhöjden är kvar.

**Klart när:** ett break på 136 BPM i en låt på 170 BPM håller sin tonhöjd med Fit to tempo, och en mod kan dra ut en fill till ett metalliskt ljud. Testerna går igenom, typecheck och lint är gröna, och det finns en sammanfattning i `docs/tasks/fas-15-sammanfattning.md`.

## Beslut (Magnus, 2026-10-16)

1. **Stretch finns på breaket och som mål i Mods.**
2. **Bara stretch byggs.** Pitch ändrar redan både tonhöjd och längd, så stretch och pitch tillsammans flyttar tonhöjden men behåller längden.
3. **På breaket:** Off (förvalt), Fit to tempo eller Factor.
   - Fit to tempo stretchar med breakets tempo delat med låtens, så att varje slice blir lika lång som sina steg.
   - En one-shot har bara Off och Factor.
4. **Bitlängden** ställs i ms, både på breaket och i moden. Förvalet är 30 ms.
5. **Moden** har ett val för hur den möter breakets stretch:
   - **Multiply**: faktorerna multipliceras.
   - **Replace**: modens stretch gäller i stället för breakets.
6. **När A och B rör stretch** vinner B, som för andra lägesvärden.
7. **Längdlinjen i Loops** räknar med breakets stretch men inte med modens, på samma sätt som med pitch.

## Min tolkning (granska gärna)

- **Generatorn delar upp hiten i bitar.** Varje bit blir en egen trigger med en kort region och en övertoning (Hann-fönster, halv överlappning). Renderaren behöver bara lära sig fade in. Då blir allt testbart i generatorn och kan portas till en plugin.
- **Stretch 1** med Off spelar hiten som idag, utan bitar.
- **Baklänges:** bitarna går baklänges genom slicen, och varje bit spelas baklänges.
- **Ratchet:** varje retrigger stretchas för sig.
- **Breakets stretch ställs i Slice**, i en panel "Stretch" bredvid Sample.
