# Fas 8 – sammanfattning

Tape har fått wow, flutter, en egen tid för rampen och en kurva. Mods-vyn läses nu som meningar, med en graf och färdiga startpunkter. Omfånget "Steps från–till" är borttaget.

## Gjort

- **Model:**
  - `TapeEffect` har fått `rampOver` (steg, där null betyder hela klippet), `curve`, `wow` och `flutter`. Alla kontrolleras när de sätts.
  - Äldre tapes får förval vid uppgradering.
  - `ModScope` har inte längre `range`. Ett sparat intervall blir alla steg, eftersom klippet i Song nu bestämmer vilka steg som påverkas.
- **Engine:**
  - `tapeSpeed` ger hastigheten som ramp, kurva och hålltid, gånger (1 + wow + flutter).
  - Wow är två långsamma sinusar (0,5–1 Hz, upp till ±25 %), och flutter är tre snabba (6–15 Hz, upp till ±6 %). Frekvenser och faser dras med `rng` per take.
  - `tapePasses` integrerar hastigheten numeriskt i ett rutnät på 1 ms med trapetser, alltså samma interpolering som Web Audio använder för en värdekurva. Varvgränserna stämmer med den exakta lösningen inom 0,1 ms.
  - `effectPreview` ger vad en stegeffekt gör per steg, utan slump, och används av grafen.
- **Render:** hastighet och nivå sätts med `setValueCurveAtTime`, per varv och över hela tapen.
- **UI:**
  - Varje effekt redigeras som en mening där orden är kontrollerna, så varje inställning finns på ett enda ställe:
    - Stegeffekt: "Every [beat], on [S steps]: [Pitch] [goes through] [0 3 5 7] in turn."
    - Tape: "Record the first [2/16] of the clip and play it [back and forth]. Speed goes from [1]× to [0.25]× over [1 beat], [ending gently], then holds." Wow och Flutter är reglage under meningen.
  - Grafen visar en stapel per steg över en takt, med värdet utskrivet där det ändras och slump som ett band. För Tape visar den hastighetskurvan med varven som band märkta F och R.
  - Startpunkterna under "Start from" är Tape rock, Tape stop, Stutter, Pitch stair, Reverse roll och Slip 1/3.
- **Rättat innan fasen:** Tape spelar in från klippets synliga start, även när starten är trimmad.

## Verifierat

- Det finns 184 tester, och typecheck och lint är gröna.
- I Chrome renderar en låt med två tapes, i A och B, med wow, flutter, ramp och kurva utan fel och utan NaN, på 29 ms.
- Skärmbilder av Mods-vyn för Pitch stair och Tape rock visar meningen, grafen och startpunkterna.

## Att granska

- Hur wow och flutter låter: om djupen (±25 % och ±6 %) och frekvenserna känns rätt.
- Om meningarna är lätta att läsa, och om något ord borde heta något annat.
- Wow är multiplikativ, så vid låg hastighet blir svajet litet i absoluta tal, som på ett riktigt band.
