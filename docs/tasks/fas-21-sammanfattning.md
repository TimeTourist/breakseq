# Fas 21 – Reverb och delay: sammanfattning

## Gjort

- **Hitten** har `reverb` (mängd 0–1, storlek 0–1) och `delay` (mängd 0–1, tid 1/16, 1/8, 3/16 eller 1/4, feedback 0–0,9). Mängd 0 på en slice tar förälderns, som dist. Gamla projekt får ingen reverb och ingen delay.
- **Mods** har målen Reverb (inställning: storlek) och Delay (inställningar: tid och feedback). Värdet är mängden i procent, så alla former fungerar: Random med chans ger kast på slumpvisa slag. A:s och B:s mängder adderas (högst 100 %) och B:s inställningar gäller. En ny Reverb- eller Delay-effekt är ett kast (List 100, för delay 80). Färdiga mods: Reverb throw, Delay throw och Random verb.
- **Renderaren:** låten har en reverb och en delay bredvid rösten (`createSpace` i `src/engine/render.ts`). Varje röst skickar sitt ljud dit som det hörs, efter att nästa slag har klippt det, och rymden klingar ut. Reverben är brus som klingar av till −60 dB på 0,3–4 s, med lika mycket energi som ett klick. Delayen är en fördröjning med återkoppling.
- **Svansen:** `renderTakeWithTail` ger `full` (så länge det klingar, högst 10 s efter slutet) och `buffer` (exakt låtens längd, med det som klingar efter slutet adderat från början). Loopar och låten spelar `buffer`, så svansen hörs i början av nästa varv. Det som spelas en gång och Export WAV använder `full`. Utan reverb och delay är allt exakt som förut.
- **Exporten:** MIDI-filen, bit-WAV:en och REX-filen är torra. Har låten reverb eller delay laddas också `…-reverb-delay.wav` ned, med bara rymden. Den börjar där låten börjar och är lika lång som det klingar, i samma nivå som bitarna.
- **GUI:** panelerna Reverb och Delay under Dist och Filter i Hits, och inställningarna för målen i Mods.

## Tester

406 tester passerar; typecheck och lint är gröna. Nya: `src/engine/render.space.test.ts` (reverben klingar efter att nästa slag klipper, delayen ekar på sin tid, vikningen in i början, oförändrat utan sändningar, mods och slump, torr export och rymd-WAV) och två GUI-tester i `src/ui/colour.test.tsx`.

## Granska gärna

- **En mod gäller i stället för hittens sändning**, som dist och filter (inte adderat som pan). En hit med 20 % och en mod med 60 % skickar 60 %.
- **Rummet är fast brus** från en egen deterministisk generator, inte från take-slumpen. Det är en del av ljudet, som ett sample, och samma i förhandslyssning och export.
- **Tape spelar in torrt:** inspelningen till ett Tape-segment har ingen reverb eller delay, men rymd från slag före segmentet klingar vidare under det.
- **Första gången låten spelas** hörs svansen från slutet redan i början, eftersom loopen är förberedd för varvet. Export WAV har den inte där.
- **Song-loopen (en del av låten)** viker inte sin egen svans: den spelar delen av låten som den låter där.
- **Delayen är samma i båda kanalerna** (ingen ping-pong).
- I Chrome visade jag reglagen i Hits. Export WAV från testservern gick inte att mäta, eftersom låten där är tom; renderingen är mätt i testerna.

## TODO(spec)

Inga.
