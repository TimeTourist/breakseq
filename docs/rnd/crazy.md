# Crazy madness (Rnd)

**Inte planerad.** Det här är en idé under diskussion. Ingen fas bygger något härifrån förrän Magnus flyttar in det i `docs/spec.md`. Allt nedan är Magnus beslut om inget annat sägs.

Mottot "Gör kaos lätt" taget till sin spets: slica ett break och få en låt direkt.

## Två lägen i headern

- **Total control:** som idag. Den automatiska kedjan gör en matrix och en loop, inget mer.
- **Crazy madness:** när ett break slicas bygger appen hela vägen till Song: hit-varianter i matrisen, loopar, klipp i Song och mods från förvalen.
- Läget är en enda knapp i headern som visar läget som gäller och byter vid klick. Muspekaren över den säger läget och vad ett klick gör (Crazy madness. Click for Total control).
- Ikoner: Total control är en vanlig glad acid smiley. Crazy madness är en acid smiley som ser lurig, ond och galen ut. Skiss: https://claude.ai/artifact/58XVrKMadNg59Wt67jASQj
- Crazy är förvalt, och läget sparas i projektet.

## Fire and forget

- Crazy bygger allt som om användaren gjort det själv. Inget följer med markörerna i efterhand, och allt går att ändra som vanligt.
- Läget styr bara vad som byggs automatiskt; inga reglage döljs.
- **🎲 (Reroll)** fungerar som idag: bara nya seeds, rör aldrig det som är byggt eller ändrat.
- **En egen knapp för Crazy** (namn ej bestämt) bygger om allt Crazy har skapat med ett nytt recept. Ändringar man gjort i det Crazy skapade försvinner, men Undo tar tillbaka dem. Det man skapat själv rörs inte.

## Recept

- Crazy bygger efter ett recept. Receptet är helt dolt: det ska överraska, man hör bara resultatet.
- Ett recept består av regler, och varje regel har flera varianter. Ett recept rullas genom att en variant väljs per regel, ur en seed. Inne i varje variant slumpas det också (till exempel vilka takter som blir fills).
- Tider i reglerna räknas i takter av 16 ("main 1–3/16" = main spelar 1–3 takter i sträck; "fill 3/16" = 3 fill-takter på 16).
- Ett recept gäller hela låten. Om nya breaks följer samma stil eller får en egen är också en regel i receptet.
- Ett nytt break fogas in enligt receptet: ibland blir det main, ibland fill.
- Varianterna är en fast lista i specen (egna recept: utanför v1).

Exempel på regler (varianterna är exempel, inte bestämda):

| Regel | Varianter |
|---|---|
| Breaks roll | varannan main, varannan fill · första main, resten fill · alla blandas |
| Form | main 1–3 takter i taget, fill emellan · 3 fills på 16 · fill var 8:e takt |
| Mods | 1 extrem och 4 subtila på 16 · många små · en enda stor |
| Slut | mod på sista 2 takterna · tape stop · inget särskilt |
| Hit-varianter | samma hit med x inställningar ändrade upp till y % · hit från en annan slice eller ett annat break · samma hit baklänges · … |
| Nya breaks | samma stil · egen stil |

## Mod-förval

- Förvalen ligger fasta på en hylla i Song och kan alltid läggas ut, utan att man först skapar dem i Mods.
- Förvalen skapas som vanliga mods i varje nytt projekt, med en flagga (`isPreset`). Alla andra mods är egna (custom), utan flagga. På hyllan syns det vilka som är förval och vilka som är egna. Eftersom förvalen sparas i projektet låter ett gammalt projekt likadant även om appens förval ändras senare.
- Ändrar man ett förval i Mods blir det en egen mod, och klippen som spelade förvalet spelar ändringen. Förvalet på hyllan är oförändrat. Vill man ha en kopia klonar man först och ändrar sedan.

## Öppet

- TODO(spec): knappens namn för att bygga om med nytt recept, och var den sitter.
- TODO(spec): den fasta listan med regler och varianter.
- TODO(spec): hur förvalen visas i Mods (listan, låsta, hur man öppnar ett).
