# Fas 17 – MIDI-export

## Mål

Låten exporteras som en MIDI-fil och en WAV-fil med bitar. När de laddas i en sampler låter de som låten i Breakseq.

**Klart när:** exporten, laddad i Dr. Octo Rex via Bounce to REX, låter som låten. WAV-filen går också att dela på ett rutnät, som på Digitakt. Testerna går igenom, typecheck och lint är gröna, och det finns en sammanfattning i `docs/tasks/fas-17-sammanfattning.md`.

## Beslut (Magnus, 2026-10-16)

1. **En bit** är varje unik variant som hörs i låten. Det är hiten tillsammans med pitch, riktning, stretch och volym, med mods inräknade. MIDI-filen innehåller bara noter.
2. **Ordning:** bitarna ligger efter break och plats (Amen 01, 02 …), sedan varianter och one-shots.
3. **Lika långa rutor:**
   - Varje bit får en ruta lika lång som den längsta biten. Resten av rutan är tyst.
   - Antalet rutor avrundas uppåt till 4, 8, 16, 32 eller 64.
   - Varje ruta har en cue-markör.
4. **Ett Tape-segment** blir en egen bit.
5. **Noterna:**
   - Bit 1 ligger på C1 (not 36), och varje följande bit en halvton upp.
   - Fler än 92 bitar ryms inte, och då säger exporten ifrån.
6. **MIDI-filen** har låtens tempo, och varje not är så lång som ljudet hörs.
7. **Exporten ligger i Project**, bredvid Export WAV (fas 16).

## Test i Reason

När fasen är klar testar Magnus: WAV-filen laddas som ett klipp i Reason, delas i slice-läget och blir en Dr. Octo Rex med "Create Dr. Octo Rex". Sedan läggs MIDI-filen på, och det ska låta som låten.

## Min tolkning (granska gärna)

- **Normalisering:** WAV-filen med bitar normaliseras med samma faktor som låtens WAV-export. Då stämmer nivåerna mellan bitarna, och velocity är 100 på alla noter.
- **Variant av samma hit:** två triggers räknas som samma bit om pitch, riktning, stretch och volym är lika efter avrundning (0,01 halvton, 0,01 dB).
- **Choke** sköts av noternas längd. I Dr. Octo Rex klipper en ny slice den förra om den ligger i samma mono-läge. Det behöver testas i Reason.
- **Rutor över 64:** med fler än 64 bitar fylls rutorna upp till 92 utan avrundning. En sådan fil går inte att dela jämnt på Digitakt.
