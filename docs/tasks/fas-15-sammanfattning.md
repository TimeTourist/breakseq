# Fas 15 – sammanfattning

## Gjort

- **Modell:**
  - `Hit.stretch` har fälten `mode` ('off' | 'fit' | 'factor'), `factor`, `grain` (ms eller null) och `from` ('break' | 'hit' eller null).
  - `hitStretch(project, hit)` räknar ut hur hiten stretchas. Hitens faktor multipliceras med förälderns. Bitlängd och var bitarna börjar tas från hiten, annars från föräldern, annars förvalen (30 ms, Break).
  - Fit to tempo är breakets tempo delat med låtens. För en one-shot är den 1.
  - Gamla hits får Off.
- **Mods:**
  - Stretch är ett nytt mål mellan Direction och Tempo.
  - Effekten har `stretch: { grain, combine: 'multiply' | 'replace' }`.
  - Om A och B rör stretch på samma steg vinner B. Ignore mods behåller hitens egen stretch.
- **Generatorn:** varje trigger bär `stretch` (faktor, bitlängd, start) eller null. Faktor 1 ger null, eftersom bitar i 1× ändå låter som originalet.
- **Bitarna** räknas av en ren funktion, `src/engine/stretch.ts` (`grainPlan`, `grainCurve`):
  - Hann-fönster med halv överlappning, som summerar till jämn nivå.
  - **Break:** rutnätet räknas från breakets början. En slice får exakt de bitar som en stretch av hela breaket har där, inklusive biten som redan är igång när slicen börjar.
  - **Hit:** bitarna börjar med hiten, och första biten har full nivå från start så att attacken behålls.
  - Nära slutet läser bitarna det sista av ljudet i stället för förbi det.
- **Renderaren** spelar bitarna i en röst. Volym, fade och choke fungerar som förut. `scheduleHit` returnerar en röst med `stop()`.
- **Längdlinjen i Loops** räknar med hitens och förälderns stretch.
- **Hits:** panelen Stretch med:
  - Off / Fit to tempo / Factor (Fit är avstängd för one-shots).
  - Factor-reglage från 1/16× till 16×.
  - Grain-reglage från 5 till 500 ms, med "(parent)" eller "(default)" när det ärvs.
  - Grains from: Parent / Break / Hit.
- **Mods:** för Stretch finns Multiply/Replace och Grain.
- **Tester:**
  - `src/engine/stretch.test.ts` (7)
  - `src/engine/render.stretch.test.ts` (10, med rendering)
  - `src/ui/stretch.test.tsx` (2)
  - Totalt 245, alla gröna. Typecheck och lint är gröna.
- **Verifierat i Chrome** (på 127.0.0.1, separat lagring): Amen med Fit to tempo på föräldern spelas i 170 BPM, och längdlinjerna fyller sina steg.

## Avvikelse från min tolkning i fas-15.md

Bitarna delas inte upp i generatorn utan i renderaren. Generatorn ger en trigger per slag, med stretch som egenskap. Skälen:
- Choke ska klippa alla bitar i ett slag på en gång.
- Bitarna får inte klippa varandra.
- MIDI-exporten (fas 17) behöver en not per slag.

Planen för bitarna är en ren funktion och testas för sig.

## Att granska

- **Gränser:** faktorn går från 1/16 till 16 och bitlängden från 5 till 500 ms. Gränserna är tillagda i specen.
- **Pitch och stretch:** pitch påverkar fortfarande längden. Fit to tempo med pitch +12 blir alltså halva stegen lång.
- **Break-läget läser före slicen:** biten som redan är igång när slicen börjar läser lite av slicen före. Det är så en stretch av hela breaket låter, men kan höras som en svans.

## Fel som hittades: autosparen raderade projektet

Medan jag byggde fasen fanns `project.ts` under 13 sekunder i ett trasigt mellanläge. Vite laddade då om sidan i testwebbläsaren, laddningen misslyckades, och appen autosparade det tomma startprojektet över det sparade. Projektet i webbläsaren på localhost är därför tomt.

Rättat i commit 820f281: misslyckas laddningen sparar autosparen ingenting och visar ett fel. Ett test täcker det.

Snapshotarna "Start" och "Hek-tick Amen groove" i mappen breakseq-test är orörda.

## TODO(spec)

Inga.
