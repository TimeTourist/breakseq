# Fas 21 – Reverb och delay (förslag)

## Mål

Ett break kan plötsligt få reverb eller eko en kort stund, eller bara på slumpvisa slag, som en del av själva breaket. Reverben på hela låten läggs i Reason eller Digitakt; det här är kasten.

**Klart när:**
- En mod med reverb över två takter ger ett kast som klingar ut efter moden, utan att klippas av nästa slag.
- En Random-mod med delay ger eko på ungefär vart tredje slag.
- Testerna går igenom, typecheck och lint är gröna, och det finns en sammanfattning i `docs/tasks/fas-21-sammanfattning.md`.

## Beslut (Magnus, 2026-10-17)

1. **Reverb och delay är mål i Mods**, med samma rate och former som de andra (List, Cycle, Ramp, Random med chans). De finns också som reglage på hitten (och föräldern), för ett slag som alltid ska ha lite rymd.
2. **Svansen klingar ut bredvid rösten.** Allt spelas på en röst där varje slag klipper det förra; reverben och delayen ligger utanför den. Ett slag skickar en kopia av sitt ljud dit, och svansen klipps inte av nästa slag eller av att moden tar slut.
3. **Inga fler spår.** Breakseq gör breaks som läggs i lager i en riktig DAW (se `bordlagt.md`).

## Förslag (granska gärna)

- **Reverb:** mängd (0–100 %, hur mycket av slaget som skickas) och storlek (kort rum till stor hall). Rumsljudet görs i koden av brus som klingar av, med det injicerade slumptalet, så samma låt låter likadant varje gång.
- **Delay:** mängd (0–100 %), tid i notvärde i låtens tempo (1/16, 1/8, 3/16, 1/4) och feedback (hur länge ekot håller i sig).
- **A och B:** mängderna adderas och begränsas till 100 %, som volym; storlek, tid och feedback är lägesvärden där B vinner, som dist och filter.
- **Loopar:** svansen från slutet av en loop hörs i början av nästa varv, så att det inte hackar vid varvet.
- **Låtens slut:** Export WAV blir så mycket längre att svansen hinner klinga ut.

## Öppet

- **MIDI-, slices- och REX-exporten:** svansen hör inte till ett enskilt slag, och Dr. Octo Rex klipper föregående slice. Förslag: svansarna blir egna bitar, ungefär som Tape-segment, på egna noter.
