# Fas 19 – sammanfattning

## Gjort

- **Kanalval:**
  - `Sample.channel` kan vara 'stereo', 'left', 'right' eller 'mono', och sätts med kommandot `setSampleChannel`.
  - `channelAudio` och `sampleAudio` i `src/model/audio.ts` ger alltid två kanaler:
    - Stereo: filen som den är. En monofil får samma ljud i båda kanalerna.
    - Left eller Right: den kanalen i båda.
    - Mono: medelvärdet i båda.
  - Resultatet räknas ut en gång per ljud och val.
  - Valet gäller uppspelningen, vågformerna i Import, Slice och Hits, auditionen och transientdetekteringen i Slice.
  - Gamla samples får Stereo.
  - Valet görs i Trim-editorn i Import, med knapparna Stereo / Left / Right / Mono bredvid längden. Byter du kanal medan det spelar stannar ljudet, och Play spelar de nya kanalerna.
- **Pan:**
  - `Hit.pan` går från −1 till 1. Förälderns pan läggs till slicens (`effectiveHit`).
  - Pan är ett nytt mål i Mods, efter Volume, med värden i procent (−100 till 100). Mod A och B adderas.
  - Triggerns pan är summan, begränsad till −1 och 1.
  - **Renderaren:** balans med lika effekt (`panGains`): vänster × √2·cos θ och höger × √2·sin θ. Mitten är 1 och 1, som idag. Vid ytterläget är den andra kanalen 0 och den här √2. Utan pan läggs inga extra noder in.
  - **Hits:** reglaget Pan visas som L 40 / C / R 100, och förälderns pan visas bredvid.
  - **MIDI-exporten** räknar ett panorerat slag som en egen bit.
- **Tester:**
  - `src/engine/render.pan.test.ts` (5, med rendering)
  - `src/ui/pan.test.tsx` (2)
  - Totalt 280, alla gröna. Typecheck och lint är gröna.
- **Verifierat i Chrome** på 127.0.0.1, som har separat lagring: Amen i Trim med Left visar vänster kanals vågform.

## Att granska

- **Vågformen i Stereo** visar bara vänster kanal, som tidigare. Med Left eller Right visar den den valda kanalen.
- **En panorerad hit kan bli 3 dB starkare** i en kanal. Exporten normaliserar, så inget klipper i filen.
- **Pan påverkar inte längdlinjen i Loops.**

## TODO(spec)

Inga.
