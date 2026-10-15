# Fas 4 – Mods

## Mål

Alla mod-mål och mod-former enligt specen, Mods-vyn, och raderna Mod A och Mod B i Song.

**Klart när:** ett break med stutter-rullar, pitchtrappa och 1/3-tempo låter som avsett. Testerna nedan går igenom, typecheck och lint är gröna, och det finns en sammanfattning i `docs/tasks/fas-4-sammanfattning.md`.

## Ingår

### Model

1. **Mål:** `padMember`, `pitch`, `volume`, `direction`, `ratchet`, `tempo` och `sourceLoop` (Borrow).
2. **Former:** `list`, `cycle`, `ramp` och `random`.
3. **Borrow:** `Mod.sources` är en lista med loopar som Borrow väljer bland. Formens värden är index i listan.
4. **Kommandon:** `createMod`, `updateMod`, `remove('mod')` och `setSongCell('modA' | 'modB')` finns redan och används.

### Engine (fast ordning, oavsett rad)

1. **Borrow:** steget byts mot samma steg i vald loop, med dess pad, medlem och locks.
2. **Pad member:** värdet är medlemsnummer (1, 2, …). Det räknas runt padens storlek, så 5 på en pad med 4 medlemmar ger medlem 1.
3. **Ratchet:** n jämna triggers inom steget, 1–8.
4. **Pitch, volym och riktning:** gäller varje retrigger. Pitch och volym adderas till hittens. Riktning: 0 = framåt, 1 = baklänges.
5. **Tempo (slip):** värdet är en faktor där 1/3 ger tre gånger glesare steg.
   - Ett lokalt spelhuvud startar på huvudklockans position och går i det modulerade tempot. Samples spelas i normal hastighet.
   - Efter körningen fortsätter allt där huvudklockan är.
   - Samma mod i takter som följer på varandra är en sammanhängande körning.
   - Triggerns takt och steg är innehållets position, så att spelhuvudet tänds i det långsamma tempot.

**Former:**
- **List:** värdena i tur och ordning, ett per intervall, och sedan om från början.
- **Cycle:** går ett värde framåt för varje intervall där moden faktiskt träffar ett steg. Med rate "step" blir det round robin per slag. Utan värden går Pad member runt alla padens medlemmar.
- **Ramp:** från–till över körningens längd. Första intervallet får från-värdet och sista intervallet till-värdet. Värdet hålls inom intervallet, och diskreta mål avrundas.
- **Random:** finns redan, men gäller nu alla mål.

**Kombination av A och B på samma mål:**
- Pitch och volym adderas.
- Medlem, riktning, ratchet, tempo och Borrow räknas som lägesvärden, så B vinner.

### UI

1. **Mods-vyn:**
   - En lista med "+ New mod".
   - En editor med namn, mål, omfång (alla steg, huvudtagg, pad eller stegintervall), rate och form med formens värden. För Borrow väljs käll-loopar.
   - "Used in" och Delete.
   - Värden skrivs som text, till exempel `0 3 5 7`, `1/3`, `F R`, med enheter per mål.
   - **Prova:** välj en loop, så spelar Play i Mods den loopen med moden på hela loopen. Export sparar det man hör.
2. **Song:** raderna Mod A och Mod B är påslagna, och biblioteksraden visar mods.

## Tester som krävs

- [ ] **Stutter:** Ratchet 4 på snares (tagg S) ger fyra jämna triggers per snare-steg, och bara där.
- [ ] **Pitchtrappa:** Ramp 0 → 12 per beat över en takt ger 0, 4, 8, 12 och håller värdet inom varje slag.
- [ ] **1/3-tempo:** en takt med slip 1/3 spelar innehållets steg 0–5 på 0, 3, 6, 9, 12 och 15 steg på huvudklockan. Nästa takt börjar på takt 2, steg 0, i rätt tid.
- [ ] **Slip över flera takter** är en körning, där spelhuvudet inte startar om.
- [ ] **Borrow** byter steget mot samma steg i källoopen, med pad, medlem och locks.
- [ ] **Pad member List** `2` spelar medlem 2, och värden runt padens storlek räknas runt.
- [ ] **Cycle** på snares med rate step går 1, 2, 3, 4, 1 per snare-slag.
- [ ] **Volym och riktning** sätts per trigger. A och B adderas för volym, och B vinner för riktning.
- [ ] **Fast ordning:** Borrow före medlem, och omfånget prövas efter Borrow.
- [ ] **UI:** en mod skapas, värden matas in, moden läggs i Mod A, och triggarna påverkas.

## Ingår inte

Låsbara seeds, nudge, och fler former än de fyra.
