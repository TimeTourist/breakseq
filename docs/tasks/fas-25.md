# Fas 25 – Song-v2

## Mål

Song ska gå att arbeta i med många loopar och mods, och slumpen per klipp ska synas. En egen lista med nålar bestämmer vad som ligger på hyllan Loops and mods, så att hyllan inte blir lång med många fills och mods. Varje klipp visar sin seed, och det markerade klippet visar om det låter som andra klipp och kan slås om eller kopieras därifrån.

Skissen: `Song-v2.dc.html` i skissprojektet Breakseq Samples redesign ("Song – v2 reroll per clip"). Specen: `docs/spec.md`, Song (punkt 5) och **Listan och hyllan i Song** (Magnus beslut 2026-10-22), Listan MATRICES i Loops, och Slump och seeds.

**Redan byggt (24a och tidigare), rörs inte:** seed på varje klipp, en kopia behåller sin seed (drag med Ctrl/Alt, Ctrl+C/V, Ctrl+D, delade klipp), 🎲 på det markerade klippets högra kant med Undo ("reroll clip M1"), 🎲 Reroll everything i headern, att Song låter likadant varje varv, linjalen med loopområde och startpunkt, och länkraden med klippets loop eller mod före Song.

**Förslag på delning:** 25a är listan, nålarna och hyllan (helt bestämt i specen). 25b är seeden på klippen och panelen för det markerade klippet . Var del har eget Klart när och egen sammanfattning.

**Klart när (25a):**
- Song har till vänster en lista med loopar och mods, en nål per rad. Allt är fäst från början; en ny loop eller mod syns direkt på hyllan; en nål som tas bort tar bort raden från hyllan.
- Hyllan Loops and mods visar bara det fästa, och klipp dras därifrån som i dag.
- Nålarna sparas inte och går inte att ångra; efter Load är allt fäst igen. Nålarna i Song har inget med nålarna i Loops eller Matrices att göra.

**Klart när (25b):**
- Varje klipp visar sin seed (◆ 7f3). En kopia visar samma seed; 🎲 på klippet ger en ny, och Undo tar tillbaka den gamla.
- Ett markerat klipp har en panel under tidslinjen med namn, rad och takter, seed, om andra klipp låter likadant, en kopieringsknapp och 🎲 Reroll this clip.
- 🎲 Reroll everything låter kopior förbli kopior: klipp som hade samma seed får samma nya seed.

**Båda:** varje beteende har ett test, testerna går igenom, typecheck och lint är gröna, drag från hyllan och nålarna är provade i en riktig webbläsare (egen port, inte Magnus autosparning), och det finns en sammanfattning i `docs/tasks/fas-25a-sammanfattning.md` respektive `fas-25b-sammanfattning.md`.

## Beslut (Magnus)

Ur specen (Listan och hyllan i Song, 2026-10-22):

1. **Song har en egen lista med loopar och mods**, som listan MATRICES i Loops, med en nål per rad.
2. **De fästa fyller hyllan Loops and mods**, som klippen dras från.
3. **Allt är fäst från början**, också en ny loop eller mod; man tar bort det man inte vill se.
4. **Nålarna i Song är egna och vyns val:** de sparas inte i projektet och går inte att ångra; efter Load är allt fäst igen. (Som i Loops: att fästa på en flik ändrar inget på en annan.)

Ur skissen Song-v2:

5. **Sidan som Loops:** ingen rubrik, listan till vänster, Song-rutan till höger. Bars och läget (spelhuvud / takter) står i en rad överst i Song-rutan.
6. **Grupperna Main, Fill och Mods**, i loopens respektive modens färg (gul, blå, lila), med längd (4 bars, 2 beats) eller antal effekter (4 effects) på varje rad.
7. **Varje klipp visar sin seed** som ◆ och en kort kod i klippets nedre vänstra hörn, och muspekaren säger klippets namn, takter och seed, och vilka klipp som har samma (same as bar 4).
8. **Panelen för det markerade klippet**, under tidslinjen: namnet i klippets färg, raden och takterna (Fill · bar 4), seeden, en mening om andra klipp med samma seed (Same seed as the clip at bar 2: they sound the same. / Its own roll.), en kopieringsknapp och 🎲 Reroll this clip. 🎲 på klippets kant finns kvar.
9. **Reroll everything behåller kopior:** klipp som delade seed får samma nya seed, så kopior förblir kopior. (Står i skissens kod; ska skrivas in i Slump och seeds.)
10. **Hjälptexten i Song-rutan** säger att varje klipp har en egen seed, att en kopia behåller den och låter likadant, att 🎲 på ett markerat klipp bara slår om det klippet, och att låten låter likadant varje varv, som Export WAV skriver den.

Besluten står i `docs/spec.md` (se Svar nedan).

## Förslag (granska gärna)

- **Raden i listan:** nålen, namnet (kortat med `middleEllipsis`), längden eller antalet effekter, och ♪ när den hörs i låten, som i de andra listorna. Muspekaren över nålen säger Pin: show it in the shelf below. Raden dras inte (se q1).
- **Hyllan** står under Song-rutan som i dag och som Pads to use i Loops: grupperna Main, Fill och Mods med fästa chips i listans ordning. Utan något fäst ber hyllan om en nål; utan loopar eller mods står No loops yet ← Loops som i dag.
- **Ordningen** i listan och på hyllan är Loops-listans (Main, sedan Fill) och Mods-listans.
- **Nålarna i store:** `Focus` får `songUnpins` (loopar och mods som tagits bort), som `loopUnpins`: rensas i `settleFocus` när objektet försvinner och töms vid Load.
- **Klippens färger:** fyllda i radens färg med mörk text, som i skissen; markerat klipp får ljus ram. Modklippen behåller effekttexten (pitch + ratchet) om den får plats.
- **Seedkoden** är tre hexsiffror ur klippets seed. "Samma seed" i meningen och muspekaren jämför hela seeden, inte koden.
- **Länkraden** visar det markerade klippets takter och seed svagare efter Song (bar 4 · ◆ 7f3), som Loops visar T2 · step 03.
- **Läget** står som i skissen (1.1 / 8) om Loop-knappen flyttar ut ur raden (q4); annars som i dag.
- **Tidslinjen** behåller 10 px per 1/16 och sidscroll; skissens anpassning till bredden och etiketterna till vänster om spåren ses som förenklingar i skissen.
- **Muspekartexterna** på 🎲 följer skissen: Reroll this clip: new random here only. A copied clip keeps its seed, so it sounds the same until you reroll it.

## Utanför fasen

- Mod-förvalens egen grupp på hyllan (specen nämner Crazy och Rnd; Crazy ligger i `docs/rnd`, inte planerat). Lämna en `TODO(spec)` där grupperna byggs.
- Mönstret i fill-klippen som visar vad slumpen väljer, om q5 blir b.

## Lämnas till byggaren

- Komponentuppdelning: listan kan dela kod med listan MATRICES i Loops (nål, rad), och hyllan med Pads to use.
- Exakta mått, färger och ikoner, inom appens nuvarande stil.

## Svar (Magnus, 2026-10-22: "kör på dina förslag")

q1 a (raderna dras inte), q2 a (klick spelar en gång), q3 a (Copy after it, som Ctrl+D), q4 a (Songs Loop-knapp kvar), q5 b (inget mönster i fill-klippen nu), q6 a (ingen ruta Where 🎲 is), q7 a (inga meddelanden), q8 a (samma loop eller mod, seed, längd och start i loopen), q9 a (Reroll everything behåller kopior), q10 a (25a, sedan 25b).

Besluten 5–10 och svaren står redan i `docs/spec.md` (Song, **Song-v2**, och Slump och seeds). Byggaren tar bort "inte byggt än" när det är byggt.
