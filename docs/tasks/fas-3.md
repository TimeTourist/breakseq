# Fas 3 – Eget material

## Mål

Bygg vyerna Tag, Hits, Pads och Loops, och sätt på Fill-raden i Song och projektfilen. Efter den här fasen syns hela kedjan sample → hit → pad → loop → song i GUI:t och kan redigeras där.

**Klart när:** fyra snares kan bli en pad som placeras i en loop och hörs i Song. Testerna nedan går igenom, `npm run typecheck` och `npm run lint` är gröna, och det finns en kort sammanfattning i `docs/tasks/fas-3-sammanfattning.md`.

## Ingår

### Model

1. `Hit.variantOf: Id | null`. `duplicateHit` sätter den.
2. `Pad.auto: boolean`, som är sant för pads som kedjan skapat. Det används bara för att gruppera i GUI:t.
3. Nya kommandon:
   - `renameHit`, `setLoopBars` (förlänger med tomma steg eller kortar), `renameLoop` (finns) och `replaceProject` (öppna projektfil som ett steg som går att ångra).
   - `createLoop` utan namn ger nästa lediga M- eller F-nummer.
4. **Sammanslagna undo-steg:** `apply` tar en valfri nyckel. Kommandon med samma nyckel i följd blir ett ångra-steg, så att ett dragreglage eller ett tal man skriver inte ger hundra steg.

### Engine

1. **En gemensam röst:** `scheduleHit(context, …)` används både av renderaren och av direktuppspelning, så att en hit låter likadant i Hits som i låten.
2. **Spela en loop:** `loopSong(project, loopId)` ger en låt som bara spelar en loop, så att den kan renderas och spelas i Loops.
3. **Projektfil:**
   - `writeProjectFile(project): Uint8Array` skriver en zip med `project.json` och en 32-bitars float-WAV per ljud.
   - `readProjectFile(bytes): Project` läser filen och kontrollerar versionen.

### UI

1. **Tag:**
   - Ett kort per sample med play-knapp, namn, status (taggad eller otaggad), minivågform och knappar för huvudtaggen.
   - Extra taggar under "Also".
   - Filter: All eller Untagged.
   - Egna taggar och autotaggning kommer i fas 5.
2. **Hits:**
   - En lista grupperad som Variants och per källfil.
   - En editor med namn, vågform med region (start och slut), riktning, pitch (−24 till +24 halvtoner), volym (−24 till +6 dB) och fade out (0–200 ms).
   - Preview, "Duplicate as variant", "Used in" med länkar, och Delete när hitten inte används.
3. **Pads:**
   - Grupper: Built och per källfil, samt "Hide unused".
   - En editor med namn och medlemmar i ordning, där medlem 1 är default. Ordningen ändras med upp/ned eller genom att dra, och × tar bort en medlem.
   - "Add hits" med sökfält.
   - Preview spelar medlem 1.
   - "Used in" och Delete.
   - "+ New pad".
4. **Loops:**
   - Listan delas i Mains och Fills, med "+ New loop".
   - En editor med namn, typ och antal takter.
   - Rutnätet har en rad per takt och 16 steg.
   - Pads läggs på steg genom att dra från hyllan, eller genom att välja en pad och klicka på steg.
   - Panelen för ett valt steg visar pad (med länk), medlemsval, "Ignore mods" och Nudge (avstängd tills senare).
   - Delete tömmer ett steg.
   - Play spelar den valda loopen. Spelhuvudet tänder steget, och Export sparar loopen.
5. **Song:**
   - Fill-raden är påslagen, och biblioteksraden visar både Mains och Fills.
   - En Fill täcker sina takter, och Main visas som dold under den.
6. **Projektfil:** "Save project" och "Open project" i Import. Öppna kan ångras.
7. **Play och Export per vy:**
   - Tag, Hits och Pads spelar ett ljud direkt.
   - Loops spelar och exporterar den valda loopen.
   - Song, Import och Slice spelar och exporterar låten.

## Tester som krävs

Model:

- [ ] `duplicateHit` sätter `variantOf`. Chain-pads har `auto`, och `createPad` ger `auto: false`.
- [ ] `setLoopBars` förlänger och kortar utan att ändra stegen som blir kvar.
- [ ] `createLoop` utan namn ger M2 efter M1, och F1 för den första fillen.
- [ ] Kommandon med samma undo-nyckel blir ett steg, och ett annat kommando däremellan bryter sammanslagningen.

Engine:

- [ ] `loopSong` spelar loopen från takt 1 och är exakt så lång som loopen.
- [ ] Projektfilen kan skrivas och läsas tillbaka till samma projekt, med ljudet bitexakt. En okänd version ger ett fel.
- [ ] Renderaren låter som förut. De befintliga testerna, även round-trip-testet, går igenom efter att `scheduleHit` brutits ut.

UI:

- [ ] Klart när-flödet: fyra one-shots taggas S, en pad byggs av dem, padden läggs i en ny loop, loopen läggs i Song, och den renderade låtens triggers spelar hits från padden.
- [ ] Hits: pitch-reglaget ändrar hitten, och ett helt drag blir ett enda ångra-steg.
- [ ] Pads: att flytta upp en medlem gör den till medlem 1.
- [ ] Loops: att välja en medlem på ett steg sätter `memberId`, och Delete tömmer steget.
- [ ] Song: en Fill på Fill-raden visas och döljer Main.

## Ingår inte

Mods-vyn och mods i Song (fas 4), egna taggar och autotaggning (fas 5), "Copy bar" i Loops, nudge.
