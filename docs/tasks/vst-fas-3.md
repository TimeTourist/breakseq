# VST fas 3 – projektet som en fil

Specen: `docs/vst-spec.md`, Lagring. Magnus: "När jag sparar måste jag skapa en mapp per projekt. Det håller inte!" *(Magnus beslut 2026-10-30: q1 a, q2 a, q3 a, q4 a och Save as…)*

## Innehåll

1. **.breakseq** är projektmappen i en zip. Snapshot-koden (`engine/project-folder.ts`) är oförändrad och skriver till en `Folder` som ligger i minnet och skrivs till filen när en Save, New snapshot, Load eller ny fil är klar, inte vid varje enskild fil. Ljuden packas inte (de är redan WAV), JSON packas.
2. **Filerna** öppnas och skrivs av C++: öppna- och spara-dialogerna i Windows och läsning och skrivning av filen. Sökvägen sparas i instansens state.
3. **Project-fliken:** Open, New, Save as… och Import folder…; texten säger vilken fil man arbetar i. Header-knapparna säger "Open or make a project in Project first" utan fil.
4. **Import folder…** använder webbläsarens mappdialog, som förut, och kopierar mappen till en ny .breakseq.
5. **Project file** (Export/Import .zip) tas bort ur `vst/web`.
6. **Tester:** .breakseq i minnet (läs, skriv, lista, skrivs bara vid flush, ljud opackat), kopiering av en mapp, Open/New/Save as/Import folder i Project med en falsk bridge, att filen öppnas igen från låten.

## Klart när

- Workflowet är grönt.
- Magnus har i Reason gjort New (crazy-amen.breakseq), två snapshots, stängt låten, öppnat den igen och sett samma fil och snapshots; Save as… till en ny fil; Open av den första; Import folder… av en gammal mapp.
- Sammanfattning i `docs/tasks/vst-fas-3-sammanfattning.md`.
