# VST fas 2 – Clip to Reason

Specen: `docs/vst-spec.md` (Översikt, Clip to Reason, Uppspelning och tempo). Fas 0 visade att ett MIDI-klipp går att dra från pluginfönstret till Reasons sekvenser; fas 1 att webbappen och mixern fungerar i Reason.

## Mål

När låten är klar gör man Clip to Reason och drar klippet till Reason: som **MIDI**, där varje not spelar en fryst bit i pluginen, eller som **WAV**, låten som ljud. Sedan fortsätter arbetet i Reason, och det man ändrar i pluginen efteråt rör inte det som redan ligger där förrän man gör Clip to Reason igen och godkänner det.

## Innehåll

1. **Clip to Reason** (se q2 och q3 för var och när). Låten renderas som Play renderar den, i Reasons samplingsfrekvens, och ger två klipp:
   - **MIDI:** `midiPlan` på låten (samma bitar som Export MIDI i webbappen, högst 92, från C1) och `encodeMidi`. Bitarna renderas var för sig som i `render-slices.ts` och skickas till C++ (binärt, base64), som fryser dem i instansen.
   - **WAV:** hela låten som den hörs, med det som klingar ut efter slutet.
   Hela låten blir klipp, också när låtens loopområde är på. *(Claudes val.)* Nivån är som Play: varken bitarna eller WAV normaliseras, så MIDI-klippet och WAV-klippet låter lika starkt som i pluginen. *(Claudes val; webbappens exporter normaliserar till −0,3 dBFS.)*
2. **Varningen när tangenterna byggs om.** Har instansen redan frysta bitar och de nya skulle bli andra, frågar pluginen först: tangenterna byggs om, och MIDI-klipp som redan ligger i Reason kan spela fel ljud. Bitarna byts bara om man godkänner; avbryter man blir allt som det var. Blir bitarna desamma byts inget och ingen fråga ställs. WAV-klippet frågar aldrig. *(Magnus beslut.)*
3. **Varningen om tempot.** Är Reasons tempo ett annat än när bitarna frystes säger pluginen det, med båda tempona, tills man gjort Clip to Reason igen eller Reasons tempo är tillbaka. *(Magnus beslut.)*
4. **Dragfälten.** Två fält i JUCE (inte i webbsidan, som fas 0 visade): *MIDI clip* och *WAV clip*. Ett fält går att dra när dess klipp finns och visar vad det är (takter, antal ljud, tangenter C1–…). Klippen sparas som filer i Breakseqs mapp i AppData med namn som webbappens exporter (breakseq-172bpm-<tid>.mid / .wav) och dras som filer.
5. **Samplern** i C++ spelar de frysta bitarna: note-on på C1 + n startar bit n från början, en ny note-on på samma tangent startar om den, olika tangenter klingar samtidigt. Note-off klipper med samma korta övertoning som i webbappen (3 ms). Velocity 100 är nivån som hörs i pluginen, andra värden skalar linjärt. *(Claudes val om velocity.)* Byte av bitar sker utan lås på ljudtråden. Samplern och mixern för Play spelar samtidigt ut på samma utgång.
6. **State.** De frysta bitarna, deras tangenter och namn, och tempot de frystes i sparas i låten, så klippen i Reason spelar rätt efter omöppning och efter *Duplicate Device*. Det sparade läget får ett versionsnummer; en instans från fas 1 läses som utan frysta bitar.
7. **Tester.** Webbsidan: att samma låt ger samma bitar (ingen fråga), att en ändrad låt ger frågan, avbryt som lämnar allt orört. C++: samplern (start på rätt sampel, omstart, note-off med övertoning, velocity) och att state med bitar läses tillbaka.

## Klart när

- Workflowet är grönt och ger en `Breakseq.vst3`.
- Magnus har i Reason 13 gjort Clip to Reason, dragit MIDI-klippet till ett spår och hört det låta som låten i pluginen; dragit WAV-klippet till ett audiospår; ändrat låten och fått frågan; avbrutit och hört att klippet i Reason är oförändrat; ändrat tempo i Reason och sett varningen; sparat, öppnat igen och hört att MIDI-klippet fortfarande spelar rätt.
- Det finns en sammanfattning i `docs/tasks/vst-fas-2-sammanfattning.md`, och `docs/vst-spec.md` har med det som bestämts.

## Frågor innan fasen börjar

q1: Reverb och delay. I webbappens MIDI-export är bitarna torra och reverb/delay kommer som en egen WAV. Hur blir det i MIDI-klippet?
a) Reverb och delay blir en egen bit på sista tangenten: hela låtens reverb/delay som en lång not från låtens början. Det låter som låten så länge noterna ligger kvar där de lades.
b) MIDI-klippet är torrt; vill man ha reverb/delay tar man WAV-klippet.
c) Varje bit får sin egen reverb/delay inbakad. Det blir blötare där bitar överlappar, och svansen klipps av nästa not.
— förslag: **a**, eftersom klippet då låter som låten i pluginen, som webbappens export gör med sin egen WAV.

q2: Var sitter Clip to Reason?
a) I en list längst ner i pluginfönstret, alltid synlig: knappen *Clip to Reason* (i webbsidan) och bredvid den de två dragfälten (i JUCE), med varningarna i samma list.
b) I Project-fliken, där exporterna satt; dragfälten visas bara där.
— förslag: **a**, eftersom man drar klipp ofta och inte ska behöva byta flik.

q3: När görs klippen?
a) Bara när man trycker *Clip to Reason*: båda görs, MIDI med frågan om tangenterna byggs om.
b) WAV-klippet görs om av sig självt efter varje ändring (det rör inget i Reason), MIDI bara på knapptryck.
— förslag: **a**, eftersom det blir ett tydligt ögonblick då låten skickas, och renderingen inte konkurrerar med Play.

q4: Ska pluginen visa vilken tangent som spelar vilket ljud (C1 Amen 01, C#1 Amen 01 reversed …)?
a) Ja, en lista som fälls ut från listen.
b) Nej, inte nu.
— förslag: **b**. Det går att lägga till senare, och Reasons pianorulle visar redan noterna.
