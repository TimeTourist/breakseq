# Breakseq VST – spec

Oct 29, 2026 · @Magnus

Pluginen är Breakseq som VST3-instrument i Reason 13 på Windows, bara för Magnus. Den gäller för allt i `vst/`; för det den inte nämner gäller `docs/spec.md`, som webbappen redan gör. *(Magnus beslut.)*

## Översikt

Arbetssättet: ladda in några REX-loopar, bygg Matrix, Loops och Song med mods och alternativa hits, och när låten är klar gör **Song to MIDI**. Det ger ett MIDI-klipp som läggs i Reasons sekvenser, och sedan fortsätter arbetet i Reason. Pluginen är både editorn och samplern som spelar klippet. *(Magnus beslut.)*

- **Fristående.** `vst/` har en egen kopia av webbkoden och delar inget med `app/`; den som inte vinner tas bort. Webbappen ändras inte. *(Magnus beslut.)*
- **Not = bit.** Song to MIDI använder samma bitar som Export MIDI i webbappen (`midiPlan`): varje unikt ljud som hörs i låten, med val, overrides, slump och mods inbakade, blir en bit på en tangent från C1 (not 36) och uppåt, högst 92. *(Magnus beslut.)*
- **En instans, en uppsättning tangenter.** Instansen fryser bitarna från senaste Song to MIDI och spelar dem när Reason skickar noter. Att redigera i pluginen ändrar inte vad Reason spelar. Görs Song to MIDI igen och bitarna skulle ändras varnar pluginen att tangenterna byggs om och att klipp som redan ligger i Reason kan spela fel ljud; bitarna byts bara om man godkänner. Den som vill behålla det gamla gör en ny instans, eller *Duplicate Device* i Reason, som tar med projektet och bitarna. *(Magnus beslut.)*
- **Bara Song to MIDI.** Ingen Loop to MIDI; en enskild loop görs som en Song med den loopen. *(Magnus beslut; Loop to MIDI kan komma senare.)*
- **Song to Audio och Song to MIDI ersätter exporterna.** Export WAV, MIDI och REX finns inte i pluginen. **Song to Audio** ger en WAV av låten att lägga på ett audiospår; det är en engångsgrej, och pluginen spelar den inte sedan. **Song to MIDI** ger ett MIDI-klipp som pluginen spelar (nedan). De är helt skilda åt: Song to Audio fryser inga bitar och rör inte tangenterna. *(Magnus beslut 2026-10-29.)*
- **Inga andra pluggar i pluginen.** Effekterna är Breakseqs egna; att ladda VST:er i mods övervägdes och valdes bort. *(Magnus beslut 2026-10-30.)*

## Arkitektur

- **Skal:** JUCE 8 (C++), VST3, Windows 64-bit. GUI:t är webbkoden i en `WebBrowserComponent` (WebView2), serverad ur pluginen själv, inte från nätet. *(Magnus beslut.)*
- **Webbkoden** i `vst/web` är en kopia av `app/` med egna `Services` (se `src/ui/services.ts`): lagring i plugin-state, uppspelning ut genom pluginen, Song to Audio och Song to MIDI i stället för exporterna. Rendering sker som i webbappen, med `OfflineAudioContext` i WebView2. Uppspelningen är webbappens spelare på en `AudioContext` som skickar buffrar och volymkurvor till en mixer i C++, som spelar dem på Reasons samplingsklocka. *(Claudes val, fas 1.)*
- **Samplern** i C++ spelar de frysta bitarna: note-on startar biten på sin tangent, note-off klipper den (som noternas längd i Export MIDI). *(Claudes val att note-off klipper, i linje med Export MIDI.)*
- **Bygget** görs av ett GitHub Actions-workflow på en Windows-runner i samma repo; `.vst3` laddas ner från körningen. *(Magnus beslut.)*

## Song to Audio och Song to MIDI

Båda sitter i en list längst ner i pluginfönstret, alltid synlig, med knappar och varningar i webbsidan och dragfält i JUCE, och görs bara när man trycker. *(Magnus beslut 2026-10-29.)* Ett klipp dras från sitt fält och släpps i Reasons sekvenser; fas 0 visade att Reason 13 tar emot det. *(Provat av Magnus 2026-10-29.)* Hela låten blir klipp, och nivån är som Play, utan normalisering. *(Claudes val.)*

- **Song to Audio:** låten som den hörs, med det som klingar ut efter slutet, som en WAV i Reasons samplingsfrekvens.
- **Song to MIDI:** som rx2-exporten i webbappen *(Magnus beslut)*: varje unikt ljud blir en bit på en tangent från C1, högst 92, där ett slag har all bearbetning utom reverb och delay och Tape, Scratch och ljudmods klipps ur låten som den hörs. Reverb och delay blir en egen WAV med eget dragfält. Bitarna fryses i instansen, och samplern spelar dem när Reason skickar noter.

- **Song to REX** *(Magnus beslut 2026-10-30, ett försök bredvid Song to MIDI; tas bort om det inte blir bra)*: samma bitar som Song to MIDI, men som en REX-fil (som Export MIDI + REX i webbappen, med samma nivåer) och ett MIDI-klipp till den. REX-filen dras till racket och blir en Dr. Octo Rex, MIDI-klippet till dess spår; reverb/delay till ett audiospår som förut. Inget fryses i instansen och tangenterna rörs inte: varje Song to REX blir en egen Octo Rex. Listen får en tredje knapp med fälten *REX* och *MIDI for REX*; *Reverb/delay* delas med Song to MIDI.

En VST kan inte själv lägga ett klipp i Reasons sekvenser som Dr. Octo Rex gör (*Copy Loop to Track*), och tredjeparts-VST:er i Reason kan inte skicka MIDI ut. *(Utrett 2026-10-29.)*

Fler än 92 bitar ryms inte; då säger Song to MIDI ifrån, som Export MIDI gör. Pluginen visar inte vilken tangent som spelar vilket ljud. *(Magnus beslut 2026-10-29.)*

## Uppspelning och tempo

- **Play i pluginen** gör som i webbappen och är oberoende av Reasons transport; ljudet går ut genom pluginens utgång, ihop med bitarna som noterna spelar. *(Magnus beslut; Play som följer Reasons transport kan komma senare.)*
- **Tempo:** låtens tempo är Reasons tempo; tempofältet i headern visar det och är låst. *(Magnus beslut.)* Tempot är inget ångra-steg: Undo tar det aldrig ifrån Reasons. *(Claudes val.)* När pluginfönstret stängs slutar det Play spelar. *(Claudes val.)* Frysta bitar är renderade i tempot vid Song to MIDI; ändras tempot i Reason efteråt varnar pluginen att bitarna inte längre stämmer med tempot och att en ny Song to MIDI behövs. *(Magnus beslut 2026-10-29.)*

## Lagring

Projektet och de frysta bitarna sparas i Reason-låten som instansens state, så låten är självbärande. *(Magnus beslut.)* Autosave och backups i IndexedDB behövs inte i pluginen. Project-fliken behåller snapshots; exporterna ersätts av Song to Audio och Song to MIDI. *(Magnus beslut 2026-10-29.)*

**Projektet är en fil, `.breakseq`** *(Magnus beslut 2026-10-30, ersätter projektmapparna)*:
- En .breakseq är det som var projektmappen packat i en fil (en zip): `breakseq.json` med aktiv snapshot, `snapshots/` och `audio/`, där varje ljud finns en gång hur många snapshots som än använder det. Snapshots, Load, Save, New snapshot och (changed) fungerar som förut.
- **Open** väljer en .breakseq i Windows öppna-dialog. **New** låter en namnge filen i spara-dialogen (t.ex. `crazy-amen`; `.breakseq` läggs till), och frågar som förut om den ska börja med arbetet som det är eller tom. **Save as…** skriver projektet med alla snapshots till en ny fil, med arbetet sparat över den aktiva snapshoten, och sedan arbetar man i den nya. Save och New snapshot skriver om filen utan att fråga.
- Reason-låten minns vilken .breakseq instansen arbetar i och öppnar den igen när Project visas.
- **Import folder…** gör om en gammal projektmapp till en .breakseq: välj mappen, namnge filen, och den öppnas. Mappen rörs inte.
- **Project file** (Export/Import .zip) finns inte i pluginen; .breakseq ersätter den.
- Webbappen ändras inte.

Klippfilerna som dragfälten pekar på ligger i `AppData/Breakseq/Clips`; låten behöver dem inte, Reason har sin egen kopia av det som dragits in. När ett nytt klipp ersätter ett fälts fil tas den gamla bort när instansen försvinner, om ingen annan instans pekar på den. *(Magnus beslut 2026-10-30.)*

Undo-historiken sparas inte i låten; den börjar om när låten öppnas, som när webbappen laddas om. *(Magnus beslut 2026-10-29.)*

## Faser

| Fas | Innehåll |
| --- | --- |
| 0 | Klar 2026-10-29 (se `docs/tasks/vst-fas-0-sammanfattning.md`). Spik: en minimal VST3 som bevisar i Reason 13 att den laddas, visar WebView2, spelar ett ljud på en not, sparar state i låten och att ett MIDI-klipp går att dra ut. Workflowet som bygger den. |
| 1 | Klar 2026-10-29 (se `docs/tasks/vst-fas-1-sammanfattning.md`). Webbkoden kopieras till `vst/web` och körs i pluginen: alla vyer, Play ut genom pluginen, projektet sparat i Reason-låten, Reasons tempo. |
| 2 | Klar 2026-10-30 (se `docs/tasks/vst-fas-2-sammanfattning.md`). Song to Audio och Song to MIDI (frysning av bitar, samplern, varningarna), som dragning från en list längst ner. |
| 3 | Projektet som en fil, `.breakseq` (se Lagring): Open, New, Save as…, Import folder…, filen ihågkommen i låten; Project file bort. |
| 4 | Song to REX bredvid Song to MIDI, som ett försök (se Song to Audio och Song to MIDI). |
