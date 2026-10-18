# Fas 22b – REX2-import

## Mål

En REX2-fil (.rx2) går att importera som ett slicat break, lika enkelt som en WAV. Exporten finns redan (fas 17, en TypeScript-version av skrivdelen i VelociLoops); importen är läsdelen av samma bibliotek.

**Klart när:**
- En .rx2 importeras i Import (Browse och drag) och blir ett sample som redan är slicat: REX-filens slicer är markörer, takterna kommer från filen, och matrisen och loopen skapas som när man slicar själv. Loopen låter som filen.
- Testfilerna från VelociLoops (`120Stereo.rx2`, `120Mono.rx2`, `120FourBeats.rx2`) avkodas till samma ljud som deras WAV-facit, inom avrundningen från heltal till flyttal.
- En fil som Breakseq själv exporterat som REX läses tillbaka med samma antal slicer, samma tempo och samma ljud.
- En trasig eller okänd fil ger ett tydligt fel i Import, ingen krasch.
- Testerna går igenom, typecheck och lint är gröna, och det finns en sammanfattning i `docs/tasks/fas-22b-sammanfattning.md`.

## Beslut (Magnus, 2026-10-18)

1. Bygg det nu, om det går snabbt.
2. Källan är VelociLoops (Unlicense), läsdelen, som exporten använder skrivdelen av.

## Förslag (granska gärna)

- **Bara REX2 (.rx2).** Äldre REX (.rex) och ReCycle (.rcy) är andra format i biblioteket och väntar.
- **Importen slicar direkt:** filen vet sina slicer och sin längd i takter, så den blir ett slicat sample (som om man valt Cue markers i Slice), inte ett sample markerat för slicing. Takterna avrundas uppåt till hela takter om filen inte är en hel takt lång.
- **Slicer som är avstängda (muted) i REX-filen** blir ändå markörer; ljudet tas som det ligger i filen.
- **Ljudet** är hela loopens vågform, i filens samplerate och kanaler; en monofil spelas i båda kanalerna, som andra filer.
