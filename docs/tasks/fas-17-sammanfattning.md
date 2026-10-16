# Fas 17 – sammanfattning

## Gjort

- **Project:** knappen "Export MIDI + slices" ligger bredvid Export WAV, som finns kvar som förut. Den sparar två filer, `breakseq-<tid>.mid` och `breakseq-<tid>-slices.wav`, och skriver hur många ljud det blev. Ryms inte låten visas ett fel.
- **Planen** ligger i `src/engine/midi.ts` och är ren, utan Web Audio:
  - `midiPlan` tar fram varje unikt ljud som hörs. Två slag är samma ljud om hit, region, pitch, volym, riktning och stretch är lika, avrundat.
  - Ordningen är breakens slices som de är (Amen 01, 02 …), sedan varianter (variant-hits och sådant som mods ändrat), sedan one-shots och sist Tape-segment. Inom varje grupp går de efter break, plats och första gången de hörs.
  - En not är så lång som ljudet hörs: tills det tar slut, eller tills nästa slag eller Tape klipper det.
  - Fler än 92 ljud ger ett fel.
- **MIDI-filen** (`encodeMidi`):
  - Format 0, 960 PPQ, låtens tempo och 4/4.
  - Noterna ligger på kanal 1 från C1 (not 36), med velocity 100.
  - Om en not slutar på samma tick som nästa börjar, kommer note off först.
- **WAV-filen** (`src/engine/render-slices.ts`):
  - Varje ljud renderas för sig i sin helhet, med samma rendering som låten. Ett Tape-segment klipps ur låtens rendering, eftersom inget annat hörs under det.
  - Rutorna är lika långa: det längsta ljudet plus 10 ms tystnad. Antalet rutor avrundas uppåt till 4, 8, 16, 32 eller 64, och över 64 blir det exakt antalet.
  - Varje ruta har en cue-markör.
  - Förstärkningen är densamma som låtens WAV-export, så nivåerna stämmer. Skulle något ljud bli starkare än låten sänks allt så att det får plats.
- **`encodeWav`** kan nu ta en fast förstärkning och skriva cue-markörer.
- **Tester:**
  - `src/engine/midi.test.ts` (7)
  - `src/engine/render-slices.test.ts` (1, med rendering)
  - ett test för cue i `codec.test.ts`
  - två UI-tester i `export.test.tsx`
  - Totalt 259, alla gröna. Typecheck och lint är gröna.
- **Verifierat i Chrome** på Magnus projekt:
  - Exporten gav 6 ljud och 19 noter över 7 takter, tempo 170, och 8 rutor på 1,42 s.
  - Den längsta rutan är Tape-segmentet från "Mod 2".
  - Projektet ändrades inte.

## Test i Reason (Magnus)

1. Ladda WAV-filen som ett klipp och dela den i slice-läget.
2. Välj "Create Dr. Octo Rex".
3. Lägg på MIDI-filen. Det ska låta som låten.

## Att granska

- **10 ms tystnad** efter det längsta ljudet är mitt val, för att varje ljud ska börja efter tystnad.
- **Choke i Dr. Octo Rex:** noternas längd klipper ljuden som i Breakseq, om Dr. Octo Rex spelar en slice i taget. Det behöver testas.
- **Tape-segment** blir alltid egna ljud, även om samma segment hörs två gånger.
- **Exporten använder tagningen som hörs nu.** Med slump i mods får du samma version som du lyssnade på.

## TODO(spec)

Inga.
