# Fas 24e – Rättelser efter 24d: sammanfattning

## Gjort

1. **Under en Tape, Scratch eller ljudmodd hörs bara det de spelar.** Det var redan byggt. Nu finns tester för det (`render.heard.test.ts`, ”under a Tape, Scratch or audio mod only what it plays is heard”). Ett kort slag kastas in i ett långt reverb, och svansen klingar in i klippet:
   - En Tape i 0× är tyst under klippet.
   - En Scratch med fadern stängd är tyst under klippet.
   - En Stutter med Gate 50 % är tyst i den grindade halvan av varje upprepning.

   I alla tre är svansen borta. Ett fjärde test visar att svansen finns där utan modden.
2. **Clear i Scratch sätter Length** (`src/model/scratch.ts`, `clearScratch`). Raden spelar inspelningen en gång i 1× med det valda Step, alltså Records the first / Step steg. Går det inte jämnt ut, eller blir det fler än 16, väljs närmaste längd inom 2–16.
   - Tester i `scratch.test.ts`: ett per Records the first med Step 1/16 (4, 8 och 16 steg) och med beat (2, 4 och 8 steg). Ett test för 2 bars i 1/16, där 32 steg blir 16, med 1× hela vägen. Ett för 1 beat i beat och ett för Step bar, där båda blir 2.
   - `render.scratch.test.ts` har kvar testet från 24d (Clear låter som utan Scratch). Nu finns också ett test med en rad som från början var kortare: Baby med 8 steg, efter Clear 16 steg, skillnad under 1e-4.
   - Kortets test är uppdaterat (Clear ger 16 steg av 1/16 på 1 bar). Clear-knappens title säger nu att den sätter Length.
3. **Exporten:** ett klipp med en ljudmodd eller Scratch blir en egen bit i MIDI-, bit- och REX-exporten.
   - `generateTake` ger `audioClips`: var klipp med en ljudmodd eller Scratch spelar, i sekunder (`audioClips` i `audio-mods.ts`). För varje steg gäller B:s klipp om dess mod har en sådan effekt, annars A:s. Ett klipp räknas också där modden inte gör något.
   - `midiPlan` (`midi.ts`) gör en bit av typen `audio` per klipp. Den har en egen not över klippet. Inga andra noter spelar under klippet, och en not före klippet klipps där det börjar. Bitar som klipps ur låten (tapes och klippen) kommer efter slagen, i tidsordning. TODO:n i `midi.ts` är borttagen.
   - `render-slices.ts` klipper biten ur låten som den hörs, precis som en tape. Det gäller både bit-WAV:en och REX.
   - Reverb/delay-WAV:en är tyst under klippen (`finishHeard` i `render-heard.ts`, i mixen `space`). Den tonas ner på 3 ms där klippet börjar och är full igen där klippet slutar, där låten fortsätter som den hörs.
   - Tester: `render-slices.test.ts` (”a clip with an audio mod or Scratch in the exports”), `midi.test.ts` och `audio-mods.test.ts`. Bit-WAV:ens Stutter-bit är sampel för sampel lika med låten under klippet, och den skiljer sig från låten utan Stutter.
4. **Ett fel i appen som hittades i webbläsaren:** tagningen som Play renderar (`renderers().renderSong` i `src/ui/services.ts`) behöll bara `triggers` och `tapes`. Därför exporterade appen slagen under en Stutter eller Scratch som om modden inte fanns, trots att motorn gjorde rätt.
   - Nu följer `heard`, `scratches`, `splices` och `audioClips` med. UI:ts `Take` har fälten.
   - Test: `src/ui/services.test.ts`.
   - Det rättar också reverb/delay-WAV:en vid en tape. Den räknades förut bara på slagen utanför tapen, så svansar av slag under tapen saknades efter den.

## Klart när

- **Allt har tester.** Bit-WAV:en för en Stutter-bit låter som låten under klippet (se ovan).
- **Provat i en riktig webbläsare** (Chromium via Playwright, `npm run dev` på localhost:5199). Projektet var två takter i 120 BPM med en syntetisk break i 16 slices, Reverb på första halvtakten, Stutter (Roll) på steg 8–16 i rad A och Scratch (Baby) på steg 20–28 i rad B. Knapparna Export MIDI + slices, Export MIDI + REX och Export WAV i fliken Project användes:
  - Första försöket visade felet i punkt 4: 16 ljud, inga bitar för klippen.
  - Efter rättelsen gav exporten 14 ljud: 12 slices och de två klippen. MIDI-filen har 18 noter, med en not för bit 13 på 1,0–2,0 s och en för bit 14 på 2,5–3,5 s. Inga andra noter ligger under klippen.
  - I bit-WAV:en är de två bitarna exakt lika med låtens WAV under klippen (skillnad 0 efter avkodning av 24 bit).
  - Reverb/delay-WAV:en är exakt 0 under båda klippen och klingar före och mellan dem.
  - REX-filen har 14 slices. Stutter-biten är exakt 1 s.
  - I sidan, utan att spara, gav samma moddar på Amen-projektet (140 BPM) 10 bitar. Bitarna var lika med låten (skillnad 0), och reverb/delay var tyst under klippen.
- **Testerna går igenom.** Det är 90 filer och 888 tester, mot 89 och 863 förut. Typecheck och lint är gröna.

## TODO(spec)

- **En tape och ett klipp med en ljudmodd eller Scratch som överlappar** i exporten: specen säger inte vad som gäller. Nu vinner klippets bit (den är klippt ur låten som den hörs, alltså med tapen), och tapen klipps runt klippet till en eller två bitar, så att ingenting spelas två gånger (`tapeOutside` i `midi.ts`). Gäller det, eller ska de bli en bit?

## Att granska

- **Autosparen i Playwright-webbläsaren** (localhost:5199) skrevs över av testprojektet under provningen. Jag återställde den från backupen från 2026-10-21 21:34 (17 samples, 9 loops, 0 mods, 0 klipp), som är läget efter 24d enligt den sammanfattningen. Titta gärna att Amen-projektet ser ut som du lämnade det. Det finns två nya backuper av testprojektet från i dag överst i listan.
- **Clear på 1 beat med Step beat eller bar** blir 2 steg som inte är 1× (inspelningen ryms inte jämnt). Specen kräver bara att Clear låter som utan Scratch när inspelningen ryms i raden.

## Att lyssna på

- **Exporten med en Stutter och en Scratch i Dr. Octo Rex eller en DAW.** Lägg MIDI-filen, bitarna och reverb/delay-WAV:en bredvid varandra. Låter det som låten, också i skarvarna in i och ut ur klippen? Där tas 3 ms övertoning med i biten, men inte resten av låtens övertoning efter klippets slut.
- **Clear i Scratch** på 1 bar spelar nu hela takten (16 steg) i stället för första halvtakten två gånger.
