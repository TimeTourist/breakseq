# Fas 3b – sammanfattning

## Gjort

- **Model:**
  - `trimSample`: samplets fönster i filen. Breakets BPM räknas om, och hits följer med eller kapas.
  - `BreakInfo.markers` med `setMarkers` och `gridMarkers`, samt `sliceAtMarkers` som lägger varje slice på närmaste 1/16.
  - `unsliceBreak` tar tillbaka en slicing. `BreakInfo.loop` håller reda på vilken loop slicingen skapade, så att bara den tas bort.
  - `sliceBreak(id, bars, grid)` finns kvar som genväg.
- **Uppgradering:** äldre projekt får markörer på 1/16. Loopen till ett break som redan är slicat letas upp.
- **UI:**
  - **Trim i Import:** dragbara handtag, fält i ms, ←/→ för att nudga, "Play trimmed" och Reset.
  - **Slice:** markörer som går att dra, välja och nudga (←/→, med Shift 10 ms), "Add marker", "Remove marker", dubbelklick för att lägga till, och Re-slice.

- **Lyssna medan man trimmar:**
  - Once eller Loop i Trim och i Slices "Play break". Loop är förvalt för breaks och Once för one-shots.
  - Ett vitt sträck visar var uppspelningen är.
  - En loop som spelar följer start och slut direkt när de ändras, utan omstart (`setAuditionRegion`).

Testerna från uppdraget finns, plus test för loop och sträck (87 totalt). Typecheck och lint är gröna.

## Verifierat i webbläsaren med `samples/Amen-break.wav`

1. Trimning till 25–6964 ms gav 138,35 BPM, samma som analysen.
2. Markör 5 nudgades +20 ms och landade på virvelns början. Statusraden visade "own markers".
3. "Apply slices" och sedan "Re-slice" fungerade, och markörerna fanns kvar efter Re-slice.

Inga fel i konsolen.

## Bakgrund: Amen mot ett jämnt grid

| Gridet räknat på | BPM | Slagen hamnar efter gridpunkten | Typisk avvikelse |
| --- | --- | --- | --- |
| Hela filen | 137,72 | −8 till +42 ms | 21 ms |
| Trimmat 0,025–6,964 s | 138,35 | −16 till +31 ms | 13 ms |

Det som är kvar efter trimning är trummisens timing. Markörerna, och senare transientdetekteringen i fas 5, tar hand om det.

## Att överväga

- **Zoom i vågformerna:** 25 ms syns knappt i en översikt av 7 sekunder. Fälten i ms och ←/→ ger precision.
- **"Snap to zero crossing":** finns i mockupen men är inte byggt.
