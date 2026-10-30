# VST fas 4 – Song to REX, ett försök

Specen: `docs/vst-spec.md`, Song to Audio och Song to MIDI. *(Magnus beslut 2026-10-30: prova alternativ 2 bredvid det som finns; Reason gör ibland en rx2 till ett audioklipp om den hamnar fel, så det ska provas innan något tas bort.)*

## Innehåll

1. Knappen *Song to REX* i listen, med fälten *REX* (`…​.rx2`) och *MIDI for REX* (`…-rex.mid`). *Reverb/delay* fylls som av Song to MIDI.
2. REX-filen och MIDI-klippet är webbappens `rexExport` i Reasons samplingsfrekvens, med dess normalisering, så att REX:en inte klipper.
3. Inget fryses och tangenterna rörs inte; Song to MIDI, samplern och frågan är som förut.
4. Tester: Song to REX ger en REX som går att läsa tillbaka med lika många slices som ljud, ett MIDI-klipp och rätt fält, och rör inte de frysta bitarna.

## Klart när

- Workflowet är grönt.
- Magnus har dragit REX till racket och fått en Octo Rex, dragit MIDI for REX till dess spår och hört låten, och bestämt om Song to REX ska stanna och om Song to MIDI ska bort.
