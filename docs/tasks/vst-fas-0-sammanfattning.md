# VST fas 0 – sammanfattning

Magnus provade spiken i Reason 13 på Windows 2026-10-29, med bygget från GitHub Actions.

## Resultat

| Prov | Resultat |
| --- | --- |
| Laddas som VST3-instrument, sidan syns (WebView2) | Ja |
| Webb → C++ → webb (Say hello) | Ja: "Hello Reason, from C++" |
| Reasons tempo på sidan | Ja, och det följer med i realtid när tempot ändras |
| Ljud räknat i JS, skickat till C++, spelat på C1 | Ja: 13230 samples (0,3 s i 44,1 kHz) och pipet spelar från MIDI-klippet |
| State i låten (räknaren) | Ja, kvar efter att låten sparats och öppnats igen |
| Drag MIDI till sekvensern | Ja: ett klipp med fyra 1/8-noter på C1 under en takt |

Inte provat: Save .mid, och att note-off klipper ljudet (testklippets noter är 0,25 s vid 120 BPM, kortare än pipet, men det är inte uttryckligen lyssnat på).

## Vad det betyder för fas 2

- Clip to Reason görs som **dragning** från ett fält i JUCE i pluginfönstret, inte som fil. Save .mid behövs inte som huvudväg; specen är uppdaterad.
- Vägen för bitarna fungerar: rendera i webbsidan, skicka till C++, spela på noter. Fas 0 skickade talen som en JSON-array; för 92 bitar i stereo blir det stort, så fas 2 bör skicka binärt (t.ex. base64 eller via resursleverantören). *(Claudes bedömning, att avgöra i fas 2.)*
- WAV-dragning är inte provad, men går samma väg (en fil som dras ut) och bör fungera likadant.

## Att granska

- `vst/src/PluginProcessor.cpp`: ljudtråden tar bara låset om det är ledigt (`ScopedTryLockType`), annars blir blocket tyst. Det duger för spiken; samplern i fas 2 bör byta bitar utan lås.
- `.github/workflows/vst.yml`: WebView2 SDK 1.0.3485.44 hämtas med nuget; JUCE 8.0.12.
