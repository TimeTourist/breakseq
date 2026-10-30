# VST fas 4 – sammanfattning

Magnus provade bygget (Actions-körning 41078000624) i Reason 13 2026-10-30: "rex funkar". Beslut: "vi kan ha kvar allt så länge så får vi se hur jag använder det" – Song to Audio, Song to MIDI och Song to REX finns alla kvar.

## Gjort

- **Song to REX:** `songToRex` i `vst/web/src/engine/render-song-to.ts`, webbappens `rexExport` i Reasons samplingsfrekvens med dess normalisering; högst 92 bitar från C1.
- **Listen:** knappen *Song to REX* och fälten *REX* (`…​.rx2`) och *MIDI for REX* (`…-rex.mid`); *Reverb/delay* fylls som av Song to MIDI (`vst/web/src/ui/plugin/song-to.ts`, `vst/src/PluginEditor.*`, `Clips::fields = 5`).
- Inget fryses och tangenterna rörs inte.

Tester: Song to REX ger en REX som läses tillbaka med rätt antal slices, MIDI-klippet och fälten, och rör inte de frysta bitarna.

## Claudes val, att granska

- REX:en normaliseras (som webbappens export), Song to MIDI har Play-nivå; de två låter alltså olika starkt.

## TODO(spec)

Inga.
