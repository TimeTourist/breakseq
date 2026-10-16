# Fas 13 – Breaks som egna objekt

## Mål

Sample och Break blir två saker. Ett **Sample** är bara ljud. Ett **Break** klipper upp ett sample i platser 01…N, med en pad per plats. Allt som påverkar ett break slår igenom direkt, utan varningar, eftersom undo och snapshots är skyddsnätet. Målet är happy accidents, inte att skydda det man byggt.

**Klart när:** Amen kan bytas mot Think i en loop och tillbaka. En markör kan flyttas medan M1 ligger i Song, och det hörs direkt. Samplet under ett break kan bytas. Ett gammalt projekt öppnas och låter som förut. Testerna går igenom, typecheck och lint är gröna, och det finns en sammanfattning i `docs/tasks/fas-13-sammanfattning.md`.

## Beslut (Magnus, 2026-10-16)

1. **Platser räknas efter nummer.** Pad 05 är alltid breakets femte slice. Tas en markör bort flyttar allt efter den ett steg, och den sista platsen blir tyst. Läggs en till dyker en ny pad upp.
2. **En hits region är i procent av dess slice** och följer med när slicen ändras.
3. **Byt sample under ett break:** markörerna stannar på sina steg i takten, och ljudet under dem byts.
4. **Byt hit:** en hit kan spela en annan slice eller one-shot och behåller pitch, volym, fade och riktning.
5. **Byten görs med en knapp "Replace…"**, inte med drag.
6. **Knappen Slice försvinner.** Ett break har alltid platser. M1 skapas en gång när filen importeras som Break, och ändras aldrig av sig själv.
7. **Break mot break byts per loop:** "Break: Amen → Think". Ett steg som spelade plats N spelar plats N i det nya breaket.
8. **"Replace sample…" ligger i Slice.**
9. **En one-shot är ett break med en enda plats**, utan markörer. Den staplas och byts som ett break.

## Modell (min tolkning, granska gärna)

```
Sample  { id, name, audioId, offset, duration }               bara ljud
Break   { id, name, sampleId, bars | null,                     null = one-shot
          markers: andel 0–1 av längden, den första 0,
          pads: Id[]   en per plats, växer men krymper aldrig,
          parent: Id   förälderns hit }
Hit     { id, name, breakId, slot | null,                      null = hela breaket (föräldern)
          region: andel 0–1 av slicen, direction, pitch, volume, fadeOut, variantOf }
```

- **Markörer i andelar** av breakets längd, så att de stannar på sina steg när samplet byts. Trimmas samplet följer markörerna därför med i takt med fönstret (i dag behåller egna markörer sin plats i filen).
- **Platser utöver antalet slices:** padsen finns kvar men är tysta, och de visas nedtonade i hyllan. Kommer platsen tillbaka hörs paden igen.
- **Byte av break i en loop:** steg på plats N i det gamla breaket får det nya breakets pad N. Saknas den skapas den, tyst. En vald medlem som inte finns i den nya paden nollställs. Pads man byggt själv rörs inte.
- **Ändrade takter:** markörerna ligger kvar på samma ställen i ljudet. Rutnätsknapparna (1/4, 1/8, 1/16) lägger om dem.
- **Det gamla samplet** ligger kvar i projektet efter ett byte, så att det kan väljas igen.
- **Gamla projekt** (fil, autospar, snapshots) uppgraderas när de öppnas. Slice-samples blir platser och deras hits får region i andelar. Osliceade breaks får platser och pads men ingen M1. One-shots blir breaks med en plats och behåller sin pad.
- **Re-slice, unslice och varningar om användning** tas bort.

## Tester

- Att flytta, lägga till och ta bort markörer räknar om slicesen, och sista platsen blir tyst.
- En trimmad hit följer sin slice i procent.
- Byte av sample behåller markörerna på sina steg.
- Byte av hit behåller inställningarna.
- Byte av break i en loop följer platsnumren. Färre platser blir tysta, och fler ger nya pads.
- One-shot som break med en plats.
- Uppgradering av ett projekt från fas 12.
- UI: Replace sample i Slice, Replace på en hit, Break-bytet i Loops.
