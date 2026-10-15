# Fas 10 – sammanfattning

Borrow är ersatt av **Swap**, som har två lägen. **Stack** väljer bland allt under spelhuvudet i alla lager. **Shuffle** blandar om klippets hits men behåller rytmen. Algoritmen väljs i meningen.

## Gjort

- **Model:**
  - `SwapEffect { target: 'swap', rate, mode }` med `StackPick` (random, roundRobin, topDown, bottomUp) och `ShufflePick` (deck, random, reverse, rotate by 1–15). Den ersätter `BorrowEffect` och `sourceLoop`.
  - En sparad Borrow blir Swap från stacken, at random.
- **Engine, i `src/engine/swap.ts`, rena funktioner:**
  - `songStack` ger cellerna under varje steg, Fill sedan Main, även när Main inte hörs.
  - `stackCandidates` ger lagren och varje pads hits i ordning.
  - `stackPick` och `shuffleOrder` (Fisher–Yates för deck) väljer.
  - `swapper` körs i generatorn före de andra effekterna. Shuffle delar ut varje klipps hits en gång i förväg. Stack väljer per intervall och räknar bara intervall med en hit. Steg utan en hörd hit byts aldrig, så rytmen är den som syns.
  - En bugg hittades av testerna: Shuffle jämförde klippen per objekt i stället för per id, så inget blandades. Den är rättad.
- **UI:**
  - Meningen lyder "Every [1/16]: Swap [from the stack] — [at random]." eller "Swap [by shuffling the clip] — [like a deck | freely | in reverse | rotated by n]."
  - Grafen visar varje steg i första takten av Try on-loopen efter Swap, och det som ändrats lyser. "Another example" slår om.
  - Randomize är avstängd för Swap och Tape, eftersom den bara gäller stegeffekter.

## Verifierat

- Det finns 195 tester, och typecheck och lint är gröna. Swap har 11 egna tester:
  - Stack top down och bottom up, också per beat.
  - Round robin genom padens alternativ.
  - Random bara bland kandidater.
  - Swap före Pad member.
  - Shuffle reverse, rotate, deck (en permutation på samma steg) och freely (kan upprepa).
  - De rena valen för sig.
- I webbläsaren har en ny mod med Swap och Shuffle like a deck blandat om M1:s 01–04, och grafen visar ändringarna.

## Att granska

- Mina tolkningar i `fas-10.md`, framför allt "layer by layer" (förvald hit per lager) och att Shuffle inte har någon rate.
- Gamla Borrow-moddar har blivit Stack random. De lånar alltså inte längre från loopar som inte ligger i Song.
