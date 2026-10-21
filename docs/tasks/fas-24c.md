# Fas 24c – Mods som samplar det som hörs

Specen: `docs/spec.md`, Tape och Mods som samplar det som hörs, och Stegrader och fliken Mods. Skissen: `docs/sketches/mods.html` (korten Scramble, Stutter, Freeze, Reverse, Rewind och Halftime i moden Glitch box).

## Mål

Scramble, Stutter, Freeze, Reverse, Rewind och Halftime spelar det som hörs under sitt klipp, och Tape spelar in reverb och delay.

## Innehåll

1. **Det som hörs som källa.** En väg i renderingen som ger ljudet som hörs (Main eller Fill med stegeffekter, reverb och delay, och tape), som ljudmoddarna läser ur. Tape och Scratch spelar in med reverb och delay (specen, Magnus beslut); ljudmoddarna läser aldrig sig själva eller varandra. Händelsegeneratorn beskriver vad som ska hända (rena data utan Web Audio), och bara `src/engine/render*` gör ljud av det.
2. **De sex moddarna** med reglagen i specen och skissen, i modellen, generatorn, renderingen och fliken Mods (kort, meningar, bilden Where each cell comes from för Scramble). All slump ur seeds.
3. **A och B, ordning och klipp:** har båda raderna samma ljudmod vinner B. Ljudmoddarna verkar bara under sitt klipp, och efter klippet fortsätter det som syns där, på huvudklockan.
4. **Ändra inte** stegeffekterna eller fliken Mods i övrigt.

## Klart när

- En Stutter Roll på sista slaget i en takt ger upprepningar på 1/16, 1/32 och 1/64 (test på det som renderas eller på generatorns beskrivning).
- Scramble med Take from Whole song spelar rutor från andra delar av låten, samma rutor varje gång tills 🎲 (test).
- Reverse, Freeze, Rewind och Halftime har var sitt test som visar att de gör det specen säger.
- En Tape över ett reverbkast spelar in svansen (test).
- Varje modd är lyssnad på i en riktig webbläsare, och det finns en sammanfattning i `docs/tasks/fas-24c-sammanfattning.md`.
- Testerna går igenom, typecheck och lint är gröna.
