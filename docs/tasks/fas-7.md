# Fas 7 – Mods med flera mål och Tape

## Mål

En mod kan göra flera saker samtidigt. Den nya effekten Tape spelar in en bit av det som hörs och spelar upp den som ett band som bromsas in, framåt, baklänges eller i pendel.

**Klart när:** en mod med Tape (Repeat 2/16, Pendel, 1× → 0×) i ett klipp på en takt spelar de två första 1/16 fram och tillbaka allt långsammare och mörkare tills det tystnar, och efter klippet fortsätter låten i takt. Testerna nedan går igenom, typecheck och lint är gröna, och det finns en sammanfattning i `docs/tasks/fas-7-sammanfattning.md`.

## Beslut (Magnus, 2026-10-15)

1. **En mod har flera effekter**, högst en per mål. Din kombination blir en mod med Tape-effekten.
2. **Segmentet spelas in som en sampling** och spelas upp som ljud. Riktningen är en inställning: Framåt, Baklänges eller Pendel, där Pendel är förvald.
3. **Hastigheten går från ett värde till ett annat** över klippet, och kan både sakta in och snabba upp. Förvalt är 1× → 0×. Hastigheten ändrar både tonhöjd och längd, som ett band. Låtens tempo ändras aldrig.
4. **Inspelningen är det som hörs**: Main eller Fill med stegeffekterna från A och B, men utan Tape.
5. **Tape pågår så länge klippet är "inritat".** Vid 0× är det tyst tills klippet tar slut. Därefter fortsätter det som syns där, på huvudklockan.
6. **Segmentet börjar där klippet börjar**, och ett klipp med Tape är minst lika långt som segmentet.
7. **Mods-vyns omfångslista** visar inte föräldra-pads.

## Ingår

### Model

1. `Mod = { id, name, effects }`, där `effects` innehåller minst en effekt och högst en per mål.
   - En **stegeffekt** `{ target, scope, rate, shape, sources }` har samma fält som en mod hade förut.
   - En **Tape-effekt** `{ target: 'tape', length, direction: 'forward' | 'reverse' | 'pingpong', speed: { from, to } }`. `length` räknas i steg om 1/16, från 1 till 64. Hastigheten är mellan 0 och 4.
2. **Kommandon:**
   - `createMod(name, effects)` och `renameMod`.
   - `addEffect(modId, effect)`, `updateEffect(modId, target, patch)` och `removeEffect(modId, target)`. Den sista effekten kan inte tas bort.
3. **Klipp av en mod med Tape** är minst `length` långa. Det gäller i `addClip`, `resizeClip`, `moveClip` och `copyClip`, och den förvalda längden är max(1 takt, `length`).
4. **Uppgradering:** en äldre mod blir en mod med en enda stegeffekt.

### Engine

1. **Stegeffekter verkar som förut**, effekt för effekt i den fasta ordningen. A och B kombineras per mål.
2. **Tape** finns i `src/engine/tape.ts` som rena funktioner:
   - `generateTake(project, rng)` ger `{ triggers, tapes }`. Triggers inne i ett Tape-klipp tas bort.
   - Varje tape bär sina inspelade triggers, med tider från segmentets start, samt segmentets längd, riktning, hastighet vid start och slut och startposition (vid trimmad start).
   - `tapePasses(tape)` ger varven med tid, riktning och hastighet. Positionen är integralen av en linjär hastighet. Vid 0× nås inget nytt varv.
   - Har både A och B Tape samtidigt vinner B. Tape går före slip i sitt spann.
   - `generateTriggers` finns kvar och ger `generateTake(...).triggers`.
3. **Render:**
   - Segmentet renderas offline till en buffer, och en baklänges kopia görs.
   - Varje varv schemaläggs med `playbackRate`-ramp. Tapen klipper rösten före sig och tonar ut vid klippets slut.

### UI

1. **Mods:**
   - Effekterna visas som en lista. Med "+ Effect" läggs ett mål till som modden inte redan har, och varje effekt kan tas bort.
   - Varje stegeffekt har sina mål-, omfångs-, rate- och formredigerare.
   - Tape har fält för Repeat (bars, beats, 1/16), Direction (Forward, Reverse, Ping-pong) och Speed from → to.
   - Randomize gäller den valda effekten.
2. **Omfånget Pad** visar inte föräldra-pads.
3. **Song:** ett mod-klipp visar sina effekters mål, och Tape-klipp visar segmentets längd.
4. **Flerval i Loops** (Magnus, mitt i fasen): klicka ett steg och Shift-klicka ett annat, så väljs alla steg däremellan.
   - Ett drag flyttar blocket, och med Alt kopieras det.
   - Delete tömmer alla valda steg.
   - Steg som hamnar utanför loopen tas inte med.

## Tester som krävs

- [x] En mod med två effekter, Pitch och Ratchet, gör båda.
- [x] En äldre mod uppgraderas till en mod med en effekt.
- [x] Ett klipp av en Tape-mod kan inte bli kortare än segmentet.
- [x] En Tape-mod i ett klipp tar bort triggers inne i klippet och ger en tape med de inspelade triggerna från segmentet.
- [x] `tapePasses` vid konstant 1× och 2/16 ger varv på exakt 2 stegs längd, och Pendel växlar riktning.
- [x] Vid 1× → 0× blir varven allt längre, och inget varv börjar efter att hastigheten nått 0.
- [x] Efter klippet kommer triggers igen, på huvudklockan.
- [x] Render: en tape vid 1× framåt låter som segmentet upprepat (jämför sampel). Vid 1× → 0× är slutet tystare eller tyst.
- [x] UI: lägg till Tape i en mod, ställ in Repeat och Speed, och ta bort en effekt.
- [x] Omfångslistan för Pad saknar föräldra-pads.
- [x] Flerval: Shift-klick väljer 6–8, ett drag flyttar alla tre (Alt kopierar), och Delete tömmer dem.
