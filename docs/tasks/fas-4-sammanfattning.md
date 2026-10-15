# Fas 4 – sammanfattning

## Gjort

- **Model:**
  - Alla mål: Borrow, Pad member, Ratchet, Pitch, Volume, Direction och Tempo (slip).
  - Alla former: List, Cycle, Ramp och Random.
  - `Mod.sources` för Borrow.
  - En loop som används som Borrow-källa går inte att ta bort.
  - Äldre projekt får `sources: []`.
- **Engine:**
  - Mods tillämpas i fast ordning (Borrow → member → ratchet → pitch/volym/riktning). Omfånget prövas efter tidigare mål.
  - Ett lånat steg som ignorerar mods stoppar resten.
  - **Slip-tempo:** ett lokalt spelhuvud går i modulerat tempo från huvudklockans position under körningen, och sedan fortsätter allt där huvudklockan är. Triggerns takt och steg är innehållets, så att spelhuvudet går långsamt.
  - `modPreviewSong` spelar en loop med en mod över hela loopen.
- **UI:**
  - **Mods-vyn:** mål, omfång (all, tagg, pad, steg), rate, form, och värden som text med enheter (`0 3 5 7`, `1/3`, `F R`, loopnamn för Borrow). "Try on" provar moden på en loop med Play.
  - **Song:** raderna Mod A och Mod B är påslagna, och mods finns i biblioteksraden.
- **Layout:** sidopanelerna i Hits, Pads, Loops och Mods ligger nu kvar bredvid huvudytan ned till 900 px, och rutnät scrollar i sidled. Tidigare hamnade stegpanelen i Loops under pad-hyllan på smalare skärmar.

Alla tester från uppdraget finns (107 totalt). Typecheck och lint är gröna. I ett test byttes Borrow och medlem tillfälligt plats, och det misslyckades som det skulle.

## Tolkningar att granska

- **Ramp:** når till-värdet i sista intervallet, så 0→12 per slag i en takt blir 0, 4, 8, 12.
- **Cycle:** går framåt en gång per intervall där moden träffar ett steg. Utan värden går Pad member runt padens medlemmar.
- **Pad member:** värdet räknas runt padens storlek.
- **Riktning:** 0 = framåt, 1 = baklänges. Ramp är avstängt för Borrow och riktning.
- **Tempo:** bryr sig inte om omfång och flyttar hela lagret. A och B kombineras som läge, så B vinner.
- **Under slip:** övriga mods räknas på huvudklockans takt och steg (där ljudet hörs), inte innehållets.
- **Borrow:** tar samma index i källoopen, räknat runt källans längd.

## Kvar till "Klart när"

Lyssna på ett break med stutter (Ratchet på S), pitchtrappa (Ramp) och 1/3-tempo (Tempo).
