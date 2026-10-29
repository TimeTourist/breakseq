# VST fas 2 – Song to Audio och Song to MIDI

Specen: `docs/vst-spec.md` (Översikt, Song to Audio och Song to MIDI, Uppspelning och tempo). Fas 0 visade att ett MIDI-klipp går att dra från pluginfönstret till Reasons sekvenser; fas 1 att webbappen och mixern fungerar i Reason.

## Mål

Två sätt att få låten till Reason, helt skilda åt *(Magnus beslut 2026-10-29)*:
- **Song to Audio** ger en WAV av låten som läggs på ett audiospår. Det är en engångsgrej: pluginen spelar den inte sedan.
- **Song to MIDI** ger ett MIDI-klipp vars noter pluginen spelar med frysta bitar, som rx2-exporten i webbappen, och reverb/delay som en egen WAV. Det man ändrar i pluginen efteråt rör inte det som ligger i Reason förrän man gör Song to MIDI igen och godkänner det.

## Innehåll

1. **Listen.** Längst ner i pluginfönstret, alltid synlig: knappen *Song to Audio* med sitt dragfält *Audio*, knappen *Song to MIDI* med sina dragfält *MIDI* och *Reverb/delay*, och varningarna. Knapparna och varningarna är i webbsidan, dragfälten i JUCE (fas 0 visade att dragning därifrån fungerar). Ett fält går att dra när dess fil finns och visar vad den är (takter, antal ljud och tangenter för MIDI). Filerna sparas i Breakseqs mapp i AppData med namn som webbappens exporter (breakseq-172bpm-<tid>.wav, .mid, -reverb-delay.wav). *(Magnus beslut om listen, q2 a.)*
2. **Bara på knapptryck.** Inget renderas av sig självt. *(Magnus beslut, q3 a.)* Hela låten blir klipp, också när låtens loopområde är på. Nivån är som Play: inget normaliseras, så klippen låter lika starkt som i pluginen. *(Claudes val; webbappens exporter normaliserar till −0,3 dBFS.)*
3. **Song to Audio:** låten som den hörs, med det som klingar ut efter slutet, i Reasons samplingsfrekvens.
4. **Song to MIDI:** som rx2-exporten (`rexExport`), men bitarna fryses i pluginen i stället för att skrivas till en REX-fil. *(Magnus beslut, q1.)*
   - Varje unikt ljud blir en bit, högst 92, från C1 (`midiPlan`). Ett slag renderas för sig med all bearbetning utom reverb och delay; Tape, Scratch och ljudmods klipps ur låten som den hörs.
   - Reverb och delay är en egen WAV, tyst under det som klipps ur låten (`spaceStem`), och har ett eget dragfält. Utan reverb och delay i låten finns inget sådant fält.
   - Bitarna skickas till C++ binärt (base64) och fryses i instansen.
5. **Frågan när tangenterna byggs om.** Har instansen redan frysta bitar och de nya skulle bli andra, frågar pluginen först: tangenterna byggs om, och MIDI-klipp som redan ligger i Reason kan spela fel ljud. Bitarna byts bara om man godkänner; avbryter man blir allt som det var. Blir bitarna desamma ställs ingen fråga. *(Magnus beslut.)*
6. **Varningen om tempot.** Är Reasons tempo ett annat än när bitarna frystes säger listen det, med båda tempona, tills man gjort Song to MIDI igen eller Reasons tempo är tillbaka. *(Magnus beslut.)*
7. **Samplern** i C++ spelar de frysta bitarna: note-on på C1 + n startar bit n från början, en ny note-on på samma tangent startar om den, olika tangenter klingar samtidigt. Note-off klipper med samma korta övertoning som i webbappen (3 ms). Velocity 100 är nivån som hörs i pluginen, andra värden skalar linjärt. *(Claudes val om velocity.)* Byte av bitar sker utan lås på ljudtråden. Samplern och mixern för Play spelar ut på samma utgång.
8. **State.** De frysta bitarna och tempot de frystes i sparas i låten, så MIDI-klippen spelar rätt efter omöppning och efter *Duplicate Device*. Det sparade läget får ett versionsnummer; en instans från fas 1 läses som utan frysta bitar.
9. **Ingen tangentlista** i den här fasen. *(Magnus beslut, q4 b.)*
10. **Tester.** Webbsidan: samma låt ger samma bitar (ingen fråga), en ändrad låt ger frågan, avbryt lämnar allt orört. C++: samplern (start på rätt sampel, omstart, note-off med övertoning, velocity) och att state med bitar läses tillbaka.

## Klart när

- Workflowet är grönt och ger en `Breakseq.vst3`.
- Magnus har i Reason 13 gjort Song to Audio och dragit WAV:en till ett audiospår; gjort Song to MIDI, dragit MIDI-klippet till Breakseqs spår och reverb/delay till ett audiospår och hört det låta som låten i pluginen; ändrat låten och fått frågan; avbrutit och hört att klippet i Reason är oförändrat; ändrat tempo i Reason och sett varningen; sparat, öppnat igen och hört att MIDI-klippet fortfarande spelar rätt.
- Det finns en sammanfattning i `docs/tasks/vst-fas-2-sammanfattning.md`, och `docs/vst-spec.md` har med det som bestämts.
