# Fas 24f – Rättelser efter granskningen av fas 24

En granskning av fas 24a–24d (2026-10-22) hittade felen nedan, och Magnus sa ja till att rätta dem. Specen säger redan vad som gäller; punkt 4–6 står under Gamla projekt och punkt 5 i tabellen Raderna per mål. Varje punkt får ett test som fallerar före rättelsen.

1. **Trim och delning slår om slumpen.** `generate.ts` räknar platsen för en loops val som `content - clip.start + clip.offset`, och `wrapOffset` i `src/model/clips.ts` slår runt offset till loopens längd när vänsterkanten dras (`resizeClip`) eller klippet delas (`placeClip`). Då flyttas platsen för samma steg i låten med en hel looplängd, och Random och No repeat väljer om. Specen: "En ändring slår inte om slumpen". Test: triggers efter trim och delning är desamma som före i den del som är kvar.
2. **Scratch: sista steget står still vid 0 eller 1.** `scratchEnd` i `src/model/scratch.ts` begränsar slutpunkten till [0,1], så sista steget får fart 0. Specen (Magnus beslut): sista steget fortsätter i den fart det kom med, och nålen får läsa strax utanför inspelningen. Test: Clear, Ramp ↗, Ramp ↘ ger ett hörbart sista steg; kortet visar farten.
3. **Svansen vid blockgränsen.** När Play renderar varv i block (`src/ui/services.ts`, `folded()` i `render.ts`, `Player.queue`) viks varje blocks svans in i dess egen början. Specen: det som klingar efter slutet hörs i början av nästa varv. Svansen från block n ska alltså höras i början av block n+1 (och sista blockets i första, när det loopar).
4. **Gamla projekt: Random med `whole: true`** ska slå hela tal också i stegraden (`upgrade-mods.ts` tappar `whole`). Lägg ett sådant fall i den gyllene fixturen.
5. **Gamla projekt: tom List eller Cycle** tas bort i stället för att bli ett steg med nollvärdet.
6. **Pad member har off, och en ny Pad member börjar off** (alla steg). Off låter paden välja som vanligt. Clear sätter off. 🎲-steg och ritning på raden når off. Gamla projekt: oförändrade värden 1–8.
7. **Exporten, Tape över ett klipp med ljudmodd eller Scratch:** beslutet står nu i specen; ta bort `TODO(spec)` i `src/engine/midi.ts` och se till att det finns ett test.

Utanför fasen: prestandan när varje ändring räknar om tidigare block (vänta tills det märks).

## Klart när

- Varje punkt har ett test, och testerna går igenom; typecheck och lint är gröna.
- Punkt 1, 2 och 6 är provade i en riktig webbläsare (skriv inte över Magnus autosparning: använd en egen webbläsarprofil eller spara och lägg tillbaka den).
- En sammanfattning i `docs/tasks/fas-24f-sammanfattning.md`, och raden Aktuell fas i `CLAUDE.md`.
