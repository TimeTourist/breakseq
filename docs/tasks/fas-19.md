# Fas 19 – Pan

## Mål

Pan placerar ljudet mellan vänster och höger, på hiten och som mod.

**Klart när:**
- En hi-hat kan studsa mellan vänster och höger med en Random-mod.
- Testerna går igenom, typecheck och lint är gröna, och det finns en sammanfattning i `docs/tasks/fas-19-sammanfattning.md`.

## Beslut (Magnus, 2026-10-16)

1. **Pan finns på hiten och föräldern** i Hits, och som mål i Mods.
2. **Värdena adderas**, som volym: förälder plus hit plus mod A plus mod B. Summan begränsas till −100 % (vänster) och +100 % (höger).
3. **Stereo panoreras som balans:** åt höger sänks vänster kanal och tvärtom.
4. **Lika effekt:** ett ljud i mitten låter inte starkare än ett på sidan.
5. **MIDI-exporten** räknar ett panorerat slag som en egen bit.

## Kanalval på samplet (väntar på svar)

Gamla breaks kan vara mycket stereo, till exempel sång och bas i höger kanal och trummorna ensamma i vänster. Ett sample ska därför kunna spelas som Stereo, Left, Right eller Mono (L+R). Var valet görs är inte bestämt än.

## Min tolkning (granska gärna)

- **Pan-lagen:** lika effekt med mitten som idag, så att inget befintligt ljud ändras. Ett monoljud ligger på samma nivå i båda kanalerna i mitten. Vid ytterläget ligger det bara i en kanal, 3 dB starkare där, så att den upplevda styrkan blir densamma. För stereo är mitten oförändrad, och kanalen åt motsatt håll dämpas mot noll.
- **Pan ändrar inte längdlinjen i Loops.**
