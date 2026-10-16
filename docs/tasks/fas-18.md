# Fas 18 – Dist och filter

## Mål

Dist och filter färgar ljudet. De finns på hiten och som mål i Mods.

**Klart när:**
- En fill kan krossas allt mer med en Ramp, utan att låta starkare.
- Ett lågpassfilter kan öppnas över en takt.
- Testerna går igenom, typecheck och lint är gröna, och det finns en sammanfattning i `docs/tasks/fas-18-sammanfattning.md`.

## Beslut (Magnus, 2026-10-16)

1. **Dist är ett mål** med läget Drive, Crush eller Decimate och en mängd från 0 till 1.
2. **Dist och filter finns också på hiten och föräldern**, precis som stretch.
3. **Dist och filter byggs i samma fas.**
4. **Dist håller nivån:** ljudets RMS är densamma efter dist som före.
5. **Filtret:**
   - Typen (Low-pass eller High-pass) och resonansen ställs i moden eller på hiten.
   - Modens värde är brytfrekvensen i Hz.
6. **Filtret håller inte nivån.** En hög resonanstopp dämpas.
7. **Ordningen är dist först, sedan filter.**

## Min tolkning (granska gärna)

- **Föräldern:** dist och filter på föräldern gäller slices som saknar egna, som fade. De multipliceras inte, som stretch gör.
- **En mod gäller i stället för hitens** dist eller filter. Om A och B rör samma mål vinner B.
- **Dist läggs på ljudet innan pitch ändrar hastigheten.** Ljudet räknas fram i renderaren per sample, region och inställning, och sparas i cache. Nivån mäts över regionen som spelas.
- **Mängden:**
  - **Drive:** 0 är rent och 1 är nästan fyrkant. Funktionen är tanh med förstärkning 1–50.
  - **Crush:** 16 bitar vid 0 och 2 vid 1.
  - **Decimate:** full samplingsfrekvens vid 0 och 1/32 av den vid 1.
- **Filter i Web Audio:** BiquadFilter per röst.
  - Resonansen går från 0 till 1 och motsvarar Q 0,7–12.
  - Över Q 4 dämpas nivån så att toppen inte stiger mer än 6 dB.
  - Brytfrekvensen går från 20 Hz till 20 kHz.
- **MIDI-exporten:** dist och filter räknas in när ljud jämförs. Ett krossat slag blir alltså en egen bit.
- **Längdlinjen i Loops** påverkas inte av dist och filter.
