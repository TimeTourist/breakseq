# VST fas 1 – Webbappen i pluginen

Specen: `docs/vst-spec.md` (Arkitektur, Uppspelning och tempo, Lagring). Fas 0 visade att allt detta bygger på fungerar i Reason 13 (`docs/tasks/vst-fas-0-sammanfattning.md`).

## Mål

Hela Breakseq körs i pluginfönstret i Reason. Allt man gör i webbappen går att göra där, Play hörs genom pluginens utgång i Reasons mixer, låtens tempo är Reasons och projektet sparas i Reason-låten. Clip to Reason ingår inte; det är fas 2.

## Innehåll

1. **Kopian.** `app/` kopieras till `vst/web` (källkod, tester, `package.json`, konfiguration), utan `samples/`, `dist/` och `node_modules/`. Från och med nu är de två fristående; inget i `vst/web` importerar från `app/` och tvärtom. `app/` ändras inte i den här fasen.
2. **Inbyggd i pluginen.** Workflowet bygger `vst/web` med Vite (typecheck, lint och tester först, som Pages-workflowet), packar `dist/` som en zip i pluginens binärdata, och pluginens resursleverantör serverar filerna därifrån (som JUCE:s WebViewPluginDemo). Spiksidan och testknapparna från fas 0 tas bort; Drag MIDI-fältet tas bort tills fas 2 behöver det.
3. **Egna `Services`** i `vst/web` (se `app/src/ui/services.ts`), valda i `main.tsx` när sidan körs i pluginen:
   - **Lagring:** projektet sparas i instansens state i stället för IndexedDB. Sidan skickar projektet till C++ efter varje ändring (debounce, som autosave idag) och läser det därifrån när fönstret öppnas. Det binära (ljudfilerna) skickas som base64, inte som JSON-listor.
   - **Uppspelning (Player):** C++ spelar det som Play spelar. Webbappens spelare (`createPlayer`) behålls som den är och får en `AudioContext` som skickar allt till C++: buffrar, buffertkällor (start, stopp, loop, loopgränser) och volymkurvor (setValueAtTime, linearRampToValueAtTime), med Reasons klocka som `currentTime`. C++ är en liten mixer som spelar det på rätt sampel, resamplat till Reasons samplingsfrekvens. Då gäller loop, byte på nästa 1/16-steg med 3 ms övertoning, kö och seek som i webbappen. playHit (ett klick på en hit eller pad) renderas först offline och spelas sedan som en buffert. *(Claudes val av lösning.)*
   - **Tempo:** projektets tempo följer Reasons (som fas 0:s tempohändelse). Tempofältet i headern visar Reasons tempo och är låst; muspekaren säger att tempot ändras i Reason. *(Magnus beslut 2026-10-29.)*
   - **Project-fliken:** Load och Save av projektfil och snapshots finns kvar; Save öppnar en vanlig Windows-dialog via C++. Snapshots ligger i projektmappen på disk, så projektmapparna följer med; kontrollera att WebView2 klarar mappväljaren. Export WAV, MIDI och REX och backups i IndexedDB finns inte i pluginen.
4. **Filer in.** Samples och REX-filer läses in som i webbappen, med filväljaren och genom att dra filer från Utforskaren till fönstret. Kontrollera att båda fungerar i WebView2.
5. **Undo** börjar om när låten öppnas igen, som när webbappen laddas om. *(Magnus beslut 2026-10-29.)*
6. **Tester.** Kopians tester går igenom i `vst/web`, och de nya `Services` har egna tester med en låtsad C++-sida. C++-mixern har tester som körs i workflowet (JUCE:s `UnitTest`): start på rätt sampel, loop, stopp, volymkurva och resampling.

## Klart när

- Workflowet är grönt och ger en `Breakseq.vst3`.
- Magnus har i Reason 13 laddat ett par REX-filer, byggt Matrix, Loops och Song med en mod, hört Play genom Reasons mixer i rätt tempo, ändrat något under uppspelning och hört bytet, sparat och öppnat låten igen och fått tillbaka projektet.
- Det finns en sammanfattning i `docs/tasks/vst-fas-1-sammanfattning.md`, och `docs/vst-spec.md` har med det som bestämts under fasen.

## Beslut

C++-spelaren ingår i fas 1, tempofältet visar Reasons tempo låst, och Undo-historiken sparas inte i låten. *(Magnus beslut 2026-10-29, q1 a, q2 a, q3 a.)*
