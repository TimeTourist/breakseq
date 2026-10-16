# Fas 13 – sammanfattning

## Gjort

**Modell**
- `Sample` är bara ljud (`id, name, audioId, offset, duration`).
- Nytt objekt `Break`: `sampleId`, `bars` (null för one-shot), `markers` som andelar 0–1, `pads` (en per plats, krymper aldrig), `parent` och `loop`. Det ligger i `project.breaks`.
- `Hit` har `breakId` och `slot` (null = hela breaket) i stället för `sampleId`. `region` är andelar av slicen.
- `src/model/breaks.ts`:
  - `hitSound` säger var en hit låter i sekunder, eller null när platsen är tyst.
  - `sliceWindow`, `ensureSlots`, `breakSequence`, `markerGrid`, `bpmOf`.
  - Föräldern (`parentHit`, `effectiveHit`) flyttade hit.
- `src/model/chain.ts` är omskriven:
  - `addSample` gör en one-shot, eller ett break om filen har cues.
  - `setBreak` byter typ.
  - `setBreakBars`, `setMarkers` och `setGrid` gäller alltid och varnar aldrig.
  - `trimSample`, `replaceSample`, `replaceSampleWithFile`, `setHitSource`, `swapBreak`, `loopBreaks`, `sliceBreak`.
- Borttaget: `sliceAtMarkers`, `unsliceBreak`, låsningen av slicade breaks och varningarna om användning.
- `remove`: ett breaks pads och förälder räknas som använda av breaket.
- `src/model/upgrade-breaks.ts` gör om gamla projekt:
  - Slices blir platser som behåller sina pads och hits, med regionen omräknad till andelar.
  - One-shots blir breaks med en plats.
  - Nya id:n görs av breakets, så en uppgradering blir alltid likadan.
- Projektfilens version är nu 2, så v1.0 vägrar öppna nya filer i stället för att läsa dem fel.

**Motor**
- `generate` och `render` hittar ljudet via `hitSound`. En tyst plats ger ingen trigger.
- Eftersom alla slices nu spelar ur samma buffer startar en röst på en hel frame och slutar en halv frame före nästa start. Annars hördes en frame av nästa slice. Rundturstestet (ett slicat break blir bit för bit som originalet) går igenom.

**UI**
- **Import:** en rad per break. Break/One-shot går alltid att byta.
- **Slice:** markörerna går alltid att ändra. "Apply slices" och "Re-slice" är borta. En ny panel "Sample" har "Plays [▾]" och "Replace sample…".
- **Hits:**
  - Hiten har "Replace…", där man väljer break och plats (eller hela breaket).
  - Regionen visas inom slicen.
  - Tysta platser är nedtonade.
- **Loops:**
  - En rad "Break Amen-break.wav → [swap for…]" per break som loopen spelar.
  - Tysta steg och pads är nedtonade.

## Tester

- `src/model/breaks.test.ts` har 12 tester, varav 2 för uppgradering.
- Ett test för tysta platser i `generate.test.ts`.
- Gamla slicing-tester är borttagna eller omskrivna.
- Totalt 214, och typecheck och lint är gröna.
- Kontrollerat i Chrome mot Magnus autospar (ett fas 12-projekt): uppgraderingen, Break-bytet i M3, Replace sample i Slice och Replace på en hit. Bytena är ångrade, så projektet är som förut.

## TODO(spec)

Inga.

## Att granska

- **M1 följer breaket** så länge den är orörd (takter, rutnät och markörer). Specen sa först "ändras aldrig". Jag ändrade det, eftersom en M1 gjord med fel antal takter annars är fel från början.
- **Tysta pads syns i hyllorna** bara om en loop spelar dem. Annars blir det 12 nedtonade pads när man väljer 1/4 på ett break som började på 1/16.
- **När en one-shot blir break** blir dess pad plats 01 (och döps om till "amen 01"), och breaket får en ny förälder.
- **Trim i Import** drar nu med sig markörerna, eftersom de är andelar av breaket.
- **Ett gammalt break som inte var slicat** får pads för sina markörer men ingen M1.
- **"Replace sample…"** med en ny fil lägger till ljudet som ett sample utan egen rad i Import. Det går att välja i "Plays" i Slice.
