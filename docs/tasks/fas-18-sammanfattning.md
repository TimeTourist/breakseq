# Fas 18 – sammanfattning

## Gjort

- **Modell:**
  - `Hit.dist` har fälten `mode` ('off' | 'drive' | 'crush' | 'decimate') och `amount` (0–1).
  - `Hit.filter` har fälten `type` ('off' | 'lowpass' | 'highpass'), `cutoff` (20–20 000 Hz) och `resonance` (0–1).
  - `hitColour(project, hit)` räknar ut hitens dist och filter. Har hiten inget eget (Off) tas förälderns, som med fade.
  - Gamla hits får Off.
- **Mods:**
  - Dist och Filter är nya mål efter Stretch.
  - **Dist:** effekten har `dist: { mode }`, och värdet är mängden.
  - **Filter:** effekten har `filter: { type, resonance }`, och värdet är brytfrekvensen i Hz.
  - En mod gäller i stället för hitens. Om A och B rör samma mål vinner B.
- **DSP** ligger i `src/engine/colour.ts`, som är ren:
  - **Drive:** tanh med förstärkning 1–50.
  - **Crush:** 16 till 2 bitar.
  - **Decimate:** samplingsfrekvensen delas med 1 till 32. Varje sampel hålls kvar, och bråkdelar förs vidare.
  - **Nivå:** RMS mäts och matchas.
  - **Filter:** inställningarna räknas ut här (`filterSettings`). Q i dB går från −3 (platt) till 21 vid resonans 1. Toppen hålls inom 6 dB genom att nivån sänks.
- **Renderaren:**
  - Dist läggs på samplet före pitch. Resultatet sparas i cache per sample, riktning och inställning.
  - Nivån mäts över regionen som spelas och sätts tillbaka till samma RMS.
  - Filtret är en BiquadFilter per röst, efter dist och före röstens nivå.
  - Stretch och choke fungerar som förut.
- **MIDI-exporten** räknar med dist och filter när ljud jämförs.
- **Hits:** panelerna Dist och Filter.
  - **Dist:** Off / Drive / Crush / Decimate och Amount.
  - **Filter:** Off / Low-pass / High-pass, Cutoff (logaritmisk) och Resonance.
  - En slice visar vad den ärver av föräldern.
- **Mods:**
  - **Dist:** läget väljs.
  - **Filter:** typ och Resonance väljs.
- **Tester:**
  - `src/engine/colour.test.ts` (6)
  - `src/engine/render.colour.test.ts` (6, med rendering)
  - `src/ui/colour.test.tsx` (2)
  - Totalt 273, alla gröna. Typecheck och lint är gröna.
  - Renderingstesterna visar att Drive, Crush och Decimate på 90 % ger samma RMS som rent ljud, att lågpass vid 200 Hz tar bort en ton på 5 kHz och att högpass släpper igenom den.
- **Verifierat i Chrome** på 127.0.0.1, som har separat lagring: Amen-föräldern med Crush och Low-pass spelas utan fel.

## Att granska

- **Gränsen för resonansdämpningen:** den börjar när toppen går över 6 dB. Det är när resonansen är över 3/8, inte "Q 4" som fas-18.md sa.
- **Dist före pitch:** dist läggs på samplet innan pitch ändrar hastigheten. Decimate pitchad uppåt låter därför lite ljusare än om dist kom efter.
- **En slice kan inte stänga av förälderns dist eller filter.** Off betyder "som föräldern".
- **Längdlinjen i Loops** påverkas inte.

## TODO(spec)

Inga.
