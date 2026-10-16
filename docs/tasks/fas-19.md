# Fas 19 – Pan och kanalval

## Mål

Pan placerar ljudet mellan vänster och höger, på hiten och som mod. Ett sample kan spelas som Stereo, Left, Right eller Mono.

**Klart när:**
- En hi-hat kan studsa mellan vänster och höger med en Random-mod.
- Ett break med trummorna i vänster kanal kan spelas som bara vänster, i båda kanalerna.
- Testerna går igenom, typecheck och lint är gröna, och det finns en sammanfattning i `docs/tasks/fas-19-sammanfattning.md`.

## Beslut (Magnus, 2026-10-16)

1. **Pan finns på hiten och föräldern** i Hits, och som mål i Mods.
2. **Värdena adderas**, som volym: förälder plus hit plus mod A plus mod B. Summan begränsas till −100 % (vänster) och +100 % (höger).
3. **Allt spelas i stereo.** En monofil har samma ljud i båda kanalerna.
4. **Pan är balans med en regel för allt:** i mitten som utan pan, och åt höger tonas vänster ner mot noll medan höger blir upp till 3 dB starkare (lika effekt).
5. **MIDI-exporten** räknar ett panorerat slag som en egen bit.

## Kanalval på samplet (Magnus, 2026-10-16)

Gamla breaks kan vara mycket stereo, till exempel sång och bas i höger kanal och trummorna ensamma i vänster.

1. **Ett sample har ett kanalval:**
   - **Stereo:** som filen är.
   - **Left:** vänster kanal i både vänster och höger.
   - **Right:** höger kanal i både vänster och höger.
   - **Mono (L+R):** medelvärdet i båda kanalerna.
2. **Valet görs i Trim-editorn i Import**, bredvid start och slut. Det gäller breaks och one-shots.

## Min tolkning (granska gärna)

- **Pan-lagen:** vänster × √2·cos θ och höger × √2·sin θ, där θ går från 0 (vänster) till π/2 (höger). Mitten blir 1 och 1, som idag.
- **Kanalvalet gäller allt** som läser samplet: uppspelning, vågformen i Import och Slice, och transientdetektering.
- **Gamla samples** får Stereo.
- **Pan ändrar inte längdlinjen i Loops.**
