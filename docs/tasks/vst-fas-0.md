# VST fas 0 – Spik i Reason 13

Specen: `docs/vst-spec.md`. Allt där markerat Magnus beslut gäller.

## Mål

Innan webbkoden flyttas in: bevisa med en minimal VST3 att det som pluginen hänger på fungerar i Magnus Reason 13 på Windows. Inget av Breakseq ingår ännu.

## Innehåll

1. **Bygget.** `vst/` med CMake och JUCE 8 (hämtas av CMake), ett VST3-instrument som heter Breakseq, stereo ut, MIDI in. Ett workflow i `.github/workflows/` bygger det på en Windows-runner vid push som rör `vst/` (och manuellt) och lägger upp `Breakseq.vst3` som nedladdningsbar fil.
2. **WebView2.** Pluginfönstret visar en liten webbsida som ligger inbyggd i pluginen (ingen nätåtkomst). WebView2:s datamapp ligger i användarens AppData, inte bredvid Reason.
3. **Webb ↔ C++.** En knapp på sidan anropar C++, som svarar; sidan visar svaret. Sidan visar också Reasons tempo, som C++ skickar.
4. **Ljud på en not.** C1 spelar ett kort testljud som sidan har räknat fram i JS (en sinus med fade) och skickat till C++, för att bevisa vägen bitarna ska ta i fas 2. Note-off klipper.
5. **State i låten.** En räknare på sidan (+1) sparas i instansens state. Efter att Reason-låten sparats och öppnats igen står samma tal kvar.
6. **MIDI ut.** Ett fält i JUCE under webbsidan, *Drag MIDI*, som dras ut som en `.mid` med fyra noter på C1 under en takt. Bredvid det en knapp *Save .mid* som sparar samma fil via en filväljare.

## Klart när

- Workflowet är grönt och ger en `Breakseq.vst3` att ladda ner.
- Magnus har provat i Reason 13 och rapporterat: laddas den, syns sidan, svarar C++, stämmer tempot, låter C1, överlever räknaren omöppning, och går *Drag MIDI* att släppa i sekvensern (annars: går filen att dra in från Utforskaren).
- Svaren och vad det betyder för fas 2 står i `docs/tasks/vst-fas-0-sammanfattning.md`, och `docs/vst-spec.md` är uppdaterad om något ändrades.
