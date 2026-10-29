# Breakseq VST – spec

Oct 29, 2026 · @Magnus

Pluginen är Breakseq som VST3-instrument i Reason 13 på Windows, bara för Magnus. Den gäller för allt i `vst/`; för det den inte nämner gäller `docs/spec.md`, som webbappen redan gör. *(Magnus beslut.)*

## Översikt

Arbetssättet: ladda in några REX-loopar, bygg Matrix, Loops och Song med mods och alternativa hits, och när låten är klar gör **Song to MIDI**. Det ger ett MIDI-klipp som läggs i Reasons sekvenser, och sedan fortsätter arbetet i Reason. Pluginen är både editorn och samplern som spelar klippet. *(Magnus beslut.)*

- **Fristående.** `vst/` har en egen kopia av webbkoden och delar inget med `app/`; den som inte vinner tas bort. Webbappen ändras inte. *(Magnus beslut.)*
- **Not = bit.** Song to MIDI använder samma bitar som Export MIDI i webbappen (`midiPlan`): varje unikt ljud som hörs i låten, med val, overrides, slump och mods inbakade, blir en bit på en tangent från C1 (not 36) och uppåt, högst 92. *(Magnus beslut.)*
- **En instans, en uppsättning tangenter.** Instansen fryser bitarna från senaste Song to MIDI och spelar dem när Reason skickar noter. Att redigera i pluginen ändrar inte vad Reason spelar. Görs Song to MIDI igen och bitarna skulle ändras varnar pluginen att tangenterna byggs om och att klipp som redan ligger i Reason kan spela fel ljud; bitarna byts bara om man godkänner. Den som vill behålla det gamla gör en ny instans, eller *Duplicate Device* i Reason, som tar med projektet och bitarna. *(Magnus beslut.)*
- **Bara Song to MIDI.** Ingen Loop to MIDI; en enskild loop görs som en Song med den loopen. *(Magnus beslut; Loop to MIDI kan komma senare.)*

## Arkitektur

- **Skal:** JUCE 8 (C++), VST3, Windows 64-bit. GUI:t är webbkoden i en `WebBrowserComponent` (WebView2), serverad ur pluginen själv, inte från nätet. *(Magnus beslut.)*
- **Webbkoden** i `vst/web` är en kopia av `app/` med egna `Services` (se `src/ui/services.ts`): lagring i plugin-state, uppspelning ut genom pluginen, Song to MIDI i stället för exporterna. Rendering sker som i webbappen, med `OfflineAudioContext` i WebView2.
- **Samplern** i C++ spelar de frysta bitarna: note-on startar biten på sin tangent, note-off klipper den (som noternas längd i Export MIDI). *(Claudes val att note-off klipper, i linje med Export MIDI.)*
- **Bygget** görs av ett GitHub Actions-workflow på en Windows-runner i samma repo; `.vst3` laddas ner från körningen. *(Magnus beslut.)*

## Song to MIDI

Knappen gör `midiPlan` på låten som den är nu, renderar bitarna i Reasons samplingsfrekvens och fryser dem i instansen. MIDI-klippet kommer ut på ett av två sätt, beroende på vad fas 0 visar att Reason 13 klarar:

1. **Dra:** ett fält i pluginfönstret (byggt i JUCE, inte i webbsidan) som dras till ett spår i Reasons sekvenser.
2. **Fil:** pluginen sparar en `.mid` som man drar in från Utforskaren eller importerar.

En VST kan inte själv lägga ett klipp i Reasons sekvenser som Dr. Octo Rex gör (*Copy Loop to Track*), och tredjeparts-VST:er i Reason kan inte skicka MIDI ut. *(Utrett 2026-10-29.)*

Fler än 92 bitar ryms inte; då säger Song to MIDI ifrån, som Export MIDI gör.

## Uppspelning och tempo

- **Play i pluginen** gör som i webbappen och är oberoende av Reasons transport; ljudet går ut genom pluginens utgång, ihop med bitarna som noterna spelar. *(Magnus beslut; Play som följer Reasons transport kan komma senare.)*
- **Tempo:** låtens tempo är Reasons tempo. *(Magnus beslut.)* TODO(spec): frysta bitar med stretch eller Tape är renderade i tempot vid Song to MIDI. Ska en senare tempoändring i Reason bara gälla nästa Song to MIDI, eller varna?

## Lagring

Projektet och de frysta bitarna sparas i Reason-låten som instansens state, så låten är självbärande. *(Magnus beslut.)* Autosave i IndexedDB och projektmappar på disk behövs inte i pluginen. TODO(spec): ska Load/Save av projektfil, snapshots och Export WAV/MIDI/REX finnas kvar i pluginens Project-flik? (Förslag: Load/Save och snapshots kvar, exporterna bort eftersom Reason bouncar.)

## Faser

| Fas | Innehåll |
| --- | --- |
| 0 | Spik: en minimal VST3 som bevisar i Reason 13 att den laddas, visar WebView2, spelar ett ljud på en not, sparar state i låten och att ett MIDI-klipp går att dra ut. Workflowet som bygger den. |
| 1 | Webbkoden kopieras till `vst/web` och körs i pluginen: alla vyer, Play ut genom pluginen, projektet sparat i Reason-låten, Reasons tempo. |
| 2 | Song to MIDI: frysning av bitar, samplern, varningen, dragning eller fil enligt fas 0. |
