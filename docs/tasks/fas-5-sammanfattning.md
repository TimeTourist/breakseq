# Fas 5 – sammanfattning

## Gjort

- **Engine (`analysis.ts`):**
  - `detectTransients`: energiökning i högpassad mono, i fönster om 3 ms, jämfört med de senaste 24 ms. Varje slag flyttas bakåt till där attacken börjar, minus 1 ms. Känsligheten är 0–100.
  - `classifyHit` gissar K, S, H, R eller G utifrån energi i tre band, hur länge ljudet klingar, och nivån jämfört med breakets starkaste slag.
  - `readCues` läser `cue `-chunken i WAV.
- **Model:**
  - `Sample.tagGuessed`, `guessTags`, `confirmTags`, och att en tagg satt för hand alltid är bekräftad.
  - `setBreak` och `trimSample` behåller egna markörer. Vid trimning flyttas de med och kapas.
  - `addSample({ cues })` gör en fil med cues till ett break.
  - `removeTag` skyddar de förvalda taggarna och taggar som används.
- **UI:**
  - **Slice:** läget Transients med ett reglage för känslighet. "Apply slices" gissar taggar för de nya slicesen, i samma ångra-steg.
  - **Tag:** status "auto", filtret Auto, "Guess tags", "Confirm all auto", samt att lägga till och ta bort egna taggar.
  - **Import:** läser cues.
  - **Drag and drop:** målet markeras medan man drar. I Song flyttas en placerad loop eller mod till en annan takt i samma rad, och med Alt kopieras den. I Loops flyttas eller kopieras steg på samma sätt. En flytt är ett ångra-steg.

Alla tester från uppdraget finns (126 totalt). Typecheck och lint är gröna.

## Verifierat med `samples/Amen-break.wav`

- **Transienter**, trimmat till 25–6964 ms:
  | Känslighet | Slag |
  | --- | --- |
  | 30 | 21 |
  | 50 | 29 |
  | 70 | 37 |
  | 90 | 43 |

  Min tidigare analys hittade 42 slag.
- **I Slice**, känslighet 60: 36 markörer på slagen.
- **Gissningar efter Apply:** 12 K, 17 S och 7 R. Första takten (K S S R S K K S …) stämmer i stort med Amens mönster. Inga ghosts: Amens ghost-virvlar ligger förmodligen över gränsen på −15 dB.

## Att justera vid behov

- **Ghost-gränsen** (−15 dB) och bandgränserna i `classifyHit` är grova. Säg till om gissningarna ofta är fel.
- **Drag and drop** fungerar bara inom samma rad i Song. Drag mellan rader ger ett felmeddelande.
