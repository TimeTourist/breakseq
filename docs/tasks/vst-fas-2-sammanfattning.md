# VST fas 2 – sammanfattning

Magnus provade bygget (Actions-körning 40963651985) i Reason 13 2026-10-30 efter listan i Klart när och svarade "det funkar hur bra som helst!". Punkterna rapporterades inte en och en.

## Gjort

- **Listen:** längst ner i pluginfönstret, i JUCE (`ReasonBar` i `vst/src/PluginEditor.*`): knapparna *Song to Audio* och *Song to MIDI*, dragfälten *Audio*, *MIDI* och *Reverb/delay*, och en statusrad med varningen om tempot. Knapparna skickar en händelse till sidan, som renderar och svarar. *(Avvikelse från uppdraget: knapparna och varningen ligger i JUCE, inte i webbsidan, så att hela listen är en komponent; bara frågan om tangenterna är i sidan.)*
- **Song to Audio:** `songToAudio` i `vst/web/src/engine/render-song-to.ts`, hela låten med utklingningen, nivå som Play.
- **Song to MIDI:** `songToMidi`, med `midiPlan`, `pieceAudio` och `spaceStem` från rx2-exporten. Bitarna skickas binärt till C++ och fryses med tempot och ett fingeravtryck (FNV-1a över bitarna). Klippen sparas i `AppData/Breakseq/Clips`.
- **Frågan:** "Rebuild the keys?" när fingeravtrycket skiljer sig från de frysta bitarnas; Cancel lämnar allt orört (`vst/web/src/ui/plugin/SongTo.tsx`).
- **Samplern:** `vst/src/Sampler.*`, C1 = bit 0, omstart på samma tangent, 3 ms övertoning vid note-off, velocity/100. Bitarna byts under ett SpinLock som ljudtråden bara provar, gamla bitar städas på meddelandetråden.
- **State v2:** projektet, bitarna (MemoryBlock) och dragfälten. En instans från fas 1 läses som utan bitar.

Tester: 1028 i `vst/web` (nya: render-song-to, song-to, plugin-services), 13 i C++ (7 mixer, 6 sampler) som körs i workflowet.

## Claudes val, att granska

- Klippen har Play-nivå, inte normaliserade som webbappens exporter.
- Velocity skalar linjärt, 100 = nivån i pluginen.
- Klippfilerna i AppData städas aldrig; dragfälten i en låt pekar på dem, så tas de bort spelar Reasons kopior fortfarande men fälten blir tomma.
- Från fas 1, fortfarande öppna: hela projektet skickas vid varje autospar, mixern allokerar lite på ljudtråden, en fas 0-instans börjar tomt, Play slutar när fönstret stängs.

## TODO(spec)

Inga.
