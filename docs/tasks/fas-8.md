# Fas 8 – Wow, flutter, rampens tid och ett tydligare Mods

## Mål

Tape får wow och flutter, och man kan välja hur lång tid rampen tar och med vilken kurva. Mods-vyn blir lättare att förstå: varje effekt läses och redigeras som en mening, en graf visar vad den gör, och nya moddar kan börja från färdiga startpunkter.

**Klart när:** en Tape med Ramp over 1 beat och mjukt slut når 0,25× efter ett slag och ligger kvar där, wow och flutter hörs som svaj och fladder, och en ny användare förstår vad en mod gör utan att trycka Play. Testerna nedan går igenom, typecheck och lint är gröna, och det finns en sammanfattning i `docs/tasks/fas-8-sammanfattning.md`.

## Beslut (Magnus, 2026-10-15)

1. **Wow och Flutter är två reglage på Tape**, 0–100 %, oberoende av varandra.
   - Wow är långsam svajning, ungefär 0,5–1 Hz och lite oregelbunden, upp till ±25 % hastighet.
   - Flutter är snabbt och oregelbundet fladder, ungefär 6–15 Hz, upp till ±6 %.
   - Båda multipliceras med rampens hastighet.
   - Slumpen är deterministisk per take, som all slump.
2. **Ramp over** sätter hur lång rampen är, i takter, slag och 1/16 från klippets start. Därefter ligger hastigheten kvar på To. Förvalt är hela klippet.
3. **Kurvan** är Linear, Soft start eller Soft end. Linear är förvald.
4. **Mods-vyn** blir en mening per effekt, en graf och färdiga startpunkter.
   - Meningen är redigeraren. Varje del i den är en kontroll, så varje inställning finns på ett enda ställe.

5. **Omfånget Steps från–till tas bort** (Magnus, mitt i fasen). Ett klipp i Song täcker nu exakt de steg en mod ska verka på. "All steps" heter "Steps". En sparad mod med stegintervall gäller efter uppgraderingen alla steg.

## Ingår

### Model

1. `TapeEffect` får `rampOver: number | null` (steg, där null betyder hela klippet), `curve: 'linear' | 'softStart' | 'softEnd'`, `wow: number` (0–1) och `flutter: number` (0–1).
2. Uppgradering: äldre tapes får `rampOver: null`, `curve: 'linear'`, `wow: 0` och `flutter: 0`.

### Engine

1. **Hastigheten är en funktion av tiden:** rampen med sin kurva och hålltid, gånger (1 + wow + flutter).
   - Wow och flutter görs av några sinusar med slumpade faser och frekvenser, som dras med `rng` i `generateTake`.
2. **`tapePasses` integrerar numeriskt.** Hastigheten samplas i ett fast rutnät (1 ms) och integreras som trapetser. Det är samma linjära interpolering som Web Audio använder för en värdekurva.
   - Varje varv bär sin hastighetskurva.
3. **Render:** `playbackRate` och nivån under 1× sätts med `setValueCurveAtTime`.

### UI

1. **Mods-meningen:**
   - Stegeffekter: "Every [beat], on [S steps]: [Pitch] [goes through 0 3 5 7]". Rate, omfång, mål och form är kontroller i meningen. Formens parametrar står inne i meningen: värden, ramp från–till, och slump min–max med chans.
   - Tape: "Record the first [2/16], play it [ping-pong], speed [1×] → [0.25×] over [the whole clip], [soft end]; wow [ ], flutter [ ]".
2. **Grafen:**
   - Stegeffekter: värdet per steg över en takt, med List, Cycle och Ramp som staplar och Random som ett band mellan min och max med chansen angiven.
   - Tape: hastighetskurvan över ett klipp på en takt, med varven markerade.
3. **Startpunkter under "+ New mod":** Tape stop, Stutter, Pitch stair, Reverse roll och Slip 1/3.

## Tester som krävs

- [ ] Ramp over 4 steg från 1 till 0,25 ger hastigheten 0,25 från steg 4 och sedan konstant. Soft start ligger under Linear mitt i rampen, och Soft end ligger över.
- [ ] Wow 0 och flutter 0 ger exakt samma varv som förut, vid linjär hastighet över hela klippet.
- [ ] Med wow svajar hastigheten runt rampen inom ±25 %. Samma rng ger samma kurva.
- [ ] Den numeriska integrationen ger varvgränser som stämmer med den exakta lösningen vid linjär hastighet (inom 1 ms).
- [ ] Render: med flutter skiljer sig ljudet från utan, men varvet börjar på samma ställe.
- [ ] En äldre tape uppgraderas med förval.
- [ ] Ett sparat stegintervall blir alla steg, och tester som använde intervall använder klipp i stället.
- [ ] UI: meningen ändrar rate, mål och värden; Tape-meningen ändrar Ramp over och kurva; en startpunkt skapar rätt mod.
- [ ] Grafen visar en stapel per steg för en List-pitch, och en kurva för Tape.
