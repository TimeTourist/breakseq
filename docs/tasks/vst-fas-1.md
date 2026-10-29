# VST fas 1 – Webbappen i pluginen

Specen: `docs/vst-spec.md` (Arkitektur, Uppspelning och tempo, Lagring). Fas 0 visade att allt detta bygger på fungerar i Reason 13 (`docs/tasks/vst-fas-0-sammanfattning.md`).

## Mål

Hela Breakseq körs i pluginfönstret i Reason. Allt man gör i webbappen går att göra där, Play hörs genom pluginens utgång i Reasons mixer, låtens tempo är Reasons och projektet sparas i Reason-låten. Clip to Reason ingår inte; det är fas 2.

## Innehåll

1. **Kopian.** `app/` kopieras till `vst/web` (källkod, tester, `package.json`, konfiguration), utan `samples/`, `dist/` och `node_modules/`. Från och med nu är de två fristående; inget i `vst/web` importerar från `app/` och tvärtom. `app/` ändras inte i den här fasen.
2. **Inbyggd i pluginen.** Workflowet bygger `vst/web` med Vite (typecheck, lint och tester först, som Pages-workflowet), packar `dist/` som en zip i pluginens binärdata, och pluginens resursleverantör serverar filerna därifrån (som JUCE:s WebViewPluginDemo). Spiksidan och testknapparna från fas 0 tas bort; Drag MIDI-fältet tas bort tills fas 2 behöver det.
3. **Egna `Services`** i `vst/web` (se `app/src/ui/services.ts`), valda i `main.tsx` när sidan körs i pluginen:
   - **Lagring:** projektet sparas i instansens state i stället för IndexedDB. Sidan skickar projektet till C++ efter varje ändring (debounce, som autosave idag) och läser det därifrån när fönstret öppnas. Det binära (ljudfilerna) skickas som base64, inte som JSON-listor.
   - **Uppspelning (Player):** C++ spelar det som Play spelar. Sidan renderar som idag och skickar varje take till C++; C++ följer `Player`-gränssnittet: play (från en punkt, i loop eller en gång), replace (byte på nästa 1/16-steg med 3 ms övertoning), queue (nästa block), seek, loopområde, stop, och läget för spelhuvudet tillbaka till sidan. Audition och playHit (ett klick på en slice, hit eller pad) renderas först och spelas sedan av C++ på samma sätt. Ljudet resamplas till Reasons samplingsfrekvens om den skiljer sig från renderingens.
   - **Tempo:** projektets tempo följer Reasons (som fas 0:s tempohändelse). Se q2.
   - **Project-fliken:** Load och Save av projektfil och snapshots finns kvar; Save öppnar en vanlig Windows-dialog via C++. Export WAV, MIDI och REX, projektmappar på disk och backups i IndexedDB finns inte i pluginen.
4. **Filer in.** Samples och REX-filer läses in som i webbappen, med filväljaren och genom att dra filer från Utforskaren till fönstret. Kontrollera att båda fungerar i WebView2.
5. **Tester.** Kopians tester går igenom i `vst/web`, och de nya `Services` har egna tester med en låtsad C++-sida. C++-spelaren har tester som körs i workflowet (JUCE:s `UnitTest` eller en liten testkörning): loop, byte på nästa steg, kö och en gång.

## Klart när

- Workflowet är grönt och ger en `Breakseq.vst3`.
- Magnus har i Reason 13 laddat ett par REX-filer, byggt Matrix, Loops och Song med en mod, hört Play genom Reasons mixer i rätt tempo, ändrat något under uppspelning och hört bytet, sparat och öppnat låten igen och fått tillbaka projektet.
- Det finns en sammanfattning i `docs/tasks/vst-fas-1-sammanfattning.md`, och `docs/vst-spec.md` har med det som bestämts under fasen.

## Frågor innan fasen börjar

q1: Uppspelningen är den största delen (C++-spelaren). Ska den ligga i fas 1?
a) Ja, som ovan. Fas 1 blir stor men klar på riktigt.
b) Dela: fas 1a använder WebView2:s egen ljudutgång (Web Audio direkt till Windows ljudkort, förbi Reason) och fas 1b gör C++-spelaren. Med ASIO i Reason kan ljudkortet vara upptaget, så 1a kanske inte hörs alls.
— förslag: **a**, eftersom ljud förbi Reasons mixer inte är det vi vill ha och kanske inte fungerar med ASIO.

q2: Vad visar tempofältet i headern?
a) Reasons tempo, låst. Muspekaren säger att tempot ändras i Reason.
b) Fältet tas bort.
— förslag: **a**, eftersom man vill se tempot bitarna renderas i.

q3: Ska Undo-historiken överleva att låten stängs och öppnas igen?
a) Nej, som i webbappen efter omladdning. Projektet kommer tillbaka, historiken börjar om.
b) Ja, historiken sparas i låten också.
— förslag: **a**, eftersom det är så webbappen gör och låten blir mindre.
