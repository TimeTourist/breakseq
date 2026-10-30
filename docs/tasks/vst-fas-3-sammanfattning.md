# VST fas 3 – sammanfattning

Magnus provade bygget (Actions-körning 41078000624) i Reason 13 2026-10-30: "save verkar funka. jag importerade ett gammalt projekt, sparade i nya formatet och laddade det igen i ny reason." Import folder…, Save och att filen öppnas igen från låten är alltså provade; New, Save as… och Open rapporterades inte en och en.

## Gjort

- **.breakseq:** `vst/web/src/engine/breakseq-file.ts`, en zip (fflate) med `breakseq.json`, `snapshots/` och `audio/`. `breakseqFolder` är en `Folder` i minnet som skrivs till filen vid `flush`; snapshot-koden i `project-folder.ts` är oförändrad utom `flush?` och `copyProject`. WAV packas inte (nivå 0), JSON med nivå 6. En fil som inte är ett projekt ger "“namn” is not a Breakseq project".
- **Filerna i C++:** `openProjectFile`, `newProjectFile` (Windows dialoger, `.breakseq` läggs till), `projectFile`, `readProjectFile`, `writeProjectFile` i `vst/src/PluginEditor.cpp`. Sökvägen sparas i state som `projectFile`.
- **Project-fliken:** Open, New, Save as… och Import folder… (`vst/web/src/ui/ProjectView.tsx`, `ui/plugin/plugin-files.ts`); texten säger vilken fil man arbetar i. Project file (Export/Import .zip) är borta ur `vst/web`.
- **Klippfilerna** (beslutat efter fas 2): `vst/src/Clips.*`, en ersatt fil tas bort när instansen försvinner om ingen annan instans pekar på den, och bara filer i klippmappen.

Tester: 7 för .breakseq, 6 UI-tester med falsk värd (New, Save/öppna igen, Save as, Open, Import folder, fel fil), 5 för klippen i C++.

## Claudes val, att granska

- Filen skrivs om hel vid varje Save, New snapshot och Load; stora projekt med många ljud blir långsammare att spara.
- Save as… sparar arbetet över den aktiva snapshoten i den nya filen om det ändrats, inte i den gamla.
- Import folder… använder webbläsarens mappdialog i WebView2, som förut.

## TODO(spec)

Inga.
