# Fas 22 – Matrix: en modell för breaks och one-shots (förslag)

## Mål

Break och one-shot är i grunden samma sak, men appen behandlar dem som två. Det gör det svårt att samla ljud i påsar (*Snares*, *Kicks*, *Fx*) och lägga in dem i ett break. Fasen byter modellen till en enda kedja där en påse, en one-shot och ett break är samma sorts objekt: en **Matrix**. Gränssnittet ändras bara så mycket att allt fortsätter att fungera; det nya gränssnittet (fokus, dragsida, flikar) utformas i fas 23.

Filosofin är "drill n bass snabbt och enkelt".

Läget före fasen är taggat i git: `fas-21-fore-matrix`.

**Klart när:**
- Amen slicas och blir en matrix med 64 pads som spelar som i dag i sin loop.
- En ny matrix *Snares* kan fyllas med fyra snares från olika filer, ställas på Round robin och spela en ny snare varje gång på ett steg i Loops.
- *Snares* kopieras till Amens rad 07 och ger fyra nya hits där. Pitchas en av kopiorna ändras inte snaren i *Snares*, och tvärtom.
- Sänks volymen på Amens pad 07 sänks alla dess hits; sänks Amens matrix sänks allt i Amen, även kopiorna.
- Ingen kod, typ eller text i gränssnittet använder Break eller One-shot som objekt; de finns bara som klassificering (ikon).
- Testerna går igenom, typecheck och lint är gröna, och det finns en sammanfattning i `docs/tasks/fas-22-sammanfattning.md`.

## Beslut (Magnus, 2026-10-18)

1. **Kedjan:**
   ```
   file   1→n   trim                     som i dag
   trim   1→1/n sample                   osliced ger ett sample, slicad ett per slice
   sample n→m   hit                      ett sample kan spelas av många hits
   hit    n→1   pad   (x-led)            varje hit sitter i exakt en pad
   pad    n→1   matrix (y-led)
   pad/matrix → loop n→1 song
   ```
2. **Sample** är ett rått utklipp: bara den trimmade filen, eller en slice av den. Inga inställningar.
3. **Hit** spelar ett sample med egen config: region, riktning, pitch, volym, pan, fade, stretch, dist, filter, reverb, delay. En variant är en ny hit på samma sample.
4. **Pad** är en rad hits i x-led. Den har config för alla sina hits (samma reglage som hitten) och väljer bland dem: Top, Round robin, Random, No repeat.
5. **Matrix** är pads i y-led (01, 02 …) och config för alla sina pads (dagens förälder). Den ersätter både break och one-shot.
6. **Config läggs i tre lager**, hit → pad → matrix, på samma sätt som föräldern läggs ovanpå i dag (pitch, volym och pan adderas, stretch multipliceras, ett läge på en högre nivå gäller det som saknar eget). En hit följer padens och matrisens config där den bor, inte där den kom ifrån.
7. **Break och one-shot är en klassificering**, inget man väljer: en matrix med flera pads är ett break, en med en pad en one-shot. Det visas med en ikon.
8. **Drag ger kopior.** En hit, en pad eller en hel matrix som dras till en annan pad eller matrix blir nya hits (och pads) där, med samma inställningar och samma sample. Ändringar i en kopia rör inte originalet, och tvärtom. Det finns ingen koppling efteråt. Vill man att allt följer en matrix lägger man den direkt i Loops.
9. **Samples lever så länge något använder dem.** Tas en matrix bort går bara dess egna pads och hits. Tas en trim eller fil bort frågar Delete först och listar var den används, som i dag.
10. **Gamla projekt behöver inte öppnas eller låta som förut.** Ingen använder programmet ännu.
11. **Att byta sample under ett break tas bort**: Replace with file och Plays (vilken trim breaket spelar). Det kommer aldrig att användas. Matrisen visar i stället vilken trim den kommer från, som en länk till trimmen.
12. **En matrix är fri att ändra.** Man kan ta bort en pad, byta den mot en annan och lägga till pads sist (till exempel en one-shot). Det matrisen innehåller är det som spelas när den läggs i en loop.
13. **Små justeringar av slicingen följer med överallt.** Flyttas en markör ändras slicens ljud i alla hits som spelar den, även kopior och varianter i andra matriser.
14. **Ändringar som byter numrering frågar först.** Läggs en markör till eller tas bort, så att slicer får nya nummer eller försvinner, och någon slice som byter nummer eller försvinner spelas av mer än en hit (varianter och kopior räknas lika, var de än ligger), frågar en dialog: "Du använder slice 07, 09 i: pad 2 och pad 3. Vill du skapa en ny trim och sample för detta?" Ja: det gamla lämnas som förut och en ny trim skapas med ändringen. Nej: slicer räknas efter nummer, så det som var 06 blir nya 07 där 07 används.
15. **En matrix spelas i padordning, pad efter pad.** Varje pad är lika lång som sin första hit. Dras matrisen till en loop läggs paddarna ut efter varandra från steget:
    ```
    pad:     01   02   03
    hits:    x-|  x-|  x---
             x    |    x-
    loop:    steg 1 (2), steg 3 (2), steg 5 (4)
    ```
    Tas en pad bort flyttas allt efter den fram. Loopar som redan lagts ut ligger kvar som de är.
16. **Ja i dialogen (beslut 14)** flyttar matrisen man redigerar till den nya trimmen med ändringen; kopior i andra matriser ligger kvar på den gamla.
17. **Den automatiska loopen följer matrisen** när markörerna ändras, tills man själv ändrar i loopen, som i dag. Andra loopar ligger kvar som de lades ut.

## Förslag (granska gärna)

- **Slicingen hör till trimmen.** Takter och markörer ligger på trimmen, som är det som slicas i Slice. Varje slice är ett sample (ett fönster i trimmen). Flyttas en markör ändras slicens sample, och hits som spelar det följer med (regionen är i procent, som i dag).
- **Att slica en trim skapar en matrix**: en pad per slice med slicens hit, och en loop med trimmens namn, som den automatiska kedjan gör i dag. En osliced trim skapar en matrix med en pad och en hit. Matrisens rader följer markörerna (beslut 13–14); loopen följer bara så länge den är orörd, som i dag. Slicas en trim som redan har en matrix med en pad blir den matrisen den slicade, med pad 01 kvar som första slicerad.
- **New matrix** skapar en tom matrix (en påse) med en tom pad, som man döper.
- **Tempo för Fit to tempo** kommer från hittens sample, alltså trimmen den slicades ur, inte från matrisen. En snare från ett annat break sträcks efter sitt eget tempo. Ett sample ur en osliced trim har inget tempo och kan inte Fit to tempo, som en one-shot i dag.
- **Byte i en loop** (Amen → Think) byter rad N mot rad N, som i dag.
- **Längden på en hit i steg** räknas som i dag: en slice tar stegen från där den börjar på trimmens grid till där nästa börjar, ett helt sample sin längd i låtens tempo avrundat uppåt.
- **Gränssnittet tills fas 23:** Hits visar matriser i stället för breaks, med matrisens config där föräldern är i dag och padens config ovanför dess hits. Import och Slice fortsätter att fungera; valet Break/One-shot i Import blir "slica" eller "inte slica".
- **Ordlistan i specen och i `CLAUDE.md`** byts: Sample, Hit, Pad, Matrix. Break och One-shot står kvar som namn på klassificeringen. Ordet Matrix används bara för detta, aldrig i Mods (ingen "mod matrix").
- **Kopior tar bara hittens egna inställningar** (beslut 6): padens och matrisens config där kopian kom ifrån följer inte med, utan den nya platsens gäller. Dras en matrix till en matrix läggs dess pads sist, med sin egen padconfig och sitt val. Dras en matrix eller pad till en pad läggs alla dess hits sist på den paden.
- **Region finns bara på hitten.** Pad och matrix har inte region. Fit to tempo räknas en gång, oavsett hur många lager som har det; faktorer multipliceras som i dag.
- **Spela en pad** betyder att paden väljer. **Spela en matrix** spelar den som den läggs ut i en loop.

## Lämnas till byggaren

- Hur trim, sample och slice lagras (till exempel om ett slice-sample är ett eget objekt eller en trim plus ett nummer).
- Hur dagens kommandon (Clone break, Make one-shot, Delete) skrivs om mot matrix.
- Namn på kopior och nya pads.
