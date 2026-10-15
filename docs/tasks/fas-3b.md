# Fas 3b – Trimning och slice-markörer

Ett tillägg till fas 3, efter test med riktigt Amen (`samples/Amen-break.wav`). Med ett jämnt grid över hela filen börjar varje slice i snitt cirka 20 ms före sitt slag (spann −8 till +42 ms). Trimning halverar felet, och resten är trummisens timing, som bara markörer kan fånga.

**Klart när:** Amen kan trimmas till första slaget och nästa takts nedslag, slicas med justerade markörer, och slicas om så länge M1 inte används. Testerna nedan går igenom, typecheck och lint är gröna, och det finns en sammanfattning i `docs/tasks/fas-3b-sammanfattning.md`.

## Ingår

### Model

1. **Trimning:** `trimSample(sampleId, start, end)`, med tider i sekunder i originalfilen.
   - Ändrar samplets fönster (`offset`, `duration`) och räknar om BPM för ett break.
   - Hits behåller sin position i filen och kapas till det nya fönstret. En hit som täckte hela det gamla samplet täcker hela det nya.
   - Nekas för slices och för slicade breaks.
2. **Markörer:** `BreakInfo.markers`, med slice-starter i sekunder från breakets början, sorterade och med den första på 0.
   - `setBreak` och `trimSample` sätter dem till ett jämnt 1/16-grid.
   - `setMarkers(sampleId, markers)` sätter dem.
3. **Slicing:** `sliceBreak(sampleId)` slicar vid markörerna. M1 lägger varje slice på närmaste 1/16. Om två hamnar på samma steg får den första steget, och den andra får sin pad men hamnar inte i M1.
4. **Omslicing:** `unsliceBreak(sampleId)` tar bort breakets slices, deras hits och pads, och loopen som bara spelar dem. Den nekas och listar orsaken om:
   - en slice-hit finns i en pad som inte är dess egen, eller har en variant,
   - en slice-pad används i en annan loop,
   - eller M1 ligger i Song.

### UI

1. **Import:** varje rad får "Trim", som fäller ut hela filens vågform.
   - Start- och slutmarkören går att dra. Fält i ms ger exakt läge.
   - "Play trimmed" och Reset.
   - Ett drag blir ett ångra-steg.
2. **Slice:**
   - Grid-knapparna sätter markörerna till ett jämnt grid.
   - Markörerna går att dra. Klick på en markör väljer den, och ←/→ nudgar 1 ms (med Shift 10 ms).
   - "Add marker" delar den valda slicen på mitten, och dubbelklick i vågformen lägger en markör där. "Remove marker" tar bort den valda markören.
   - Klick på en slice spelar den. "Apply slices" använder markörerna.
   - Ett slicat break har "Re-slice", som visar varför det är spärrat om det är det.

## Tester som krävs

- [ ] `trimSample`: nytt fönster och ny BPM, hits kapas eller följer med, nekas för slicade breaks.
- [ ] `sliceBreak` med egna markörer ger rätt offset och längd per slice. M1 kvantiseras till 1/16, och en krock lämnar den andra slicen utanför M1.
- [ ] `setBreak` och `trimSample` återställer markörerna till ett jämnt 1/16-grid.
- [ ] `unsliceBreak` tar bort allt den skapat, och nekas när M1 ligger i Song eller en slice-pad används i en annan loop.
- [ ] UI: trimfälten ändrar fönstret, ←/→ nudgar en vald markör, och Add och Remove marker fungerar.
- [ ] Ett äldre projekt utan `markers` laddas med ett jämnt 1/16-grid.
