# Fas 10 – Swap: Stack och Shuffle

## Mål

Borrow ersätts av effekten **Swap**, som har två lägen. **Stack** väljer bland alla hits under spelhuvudet i alla lager. **Shuffle** blandar om hitsen inom klippet men behåller rytmen som syns. Du väljer algoritm i moden.

**Klart när:** med M1 i Main och F1 i Fill över samma takt kan en Swap i Stack-läge (layer by layer, top down) växla F1, M1, F1, M1 per steg. En Swap i Shuffle-läge (deck) spelar samma slag som syns, men med takten hits i ny ordning där varje hit används en gång. Testerna nedan går igenom, typecheck och lint är gröna, och det finns en sammanfattning i `docs/tasks/fas-10-sammanfattning.md`.

## Beslut (Magnus, 2026-10-15)

1. **X → Stack:** väljer bland allt under spelhuvudet. Det dolda lagret räknas med, alltså Main under en Fill, men det hörs fortfarande bara en röst.
2. **Y → Shuffle:** blandar hitsen som spelas inom klippet. Rytmen är den som syns.
3. **Algoritmen väljs i moden.** Alla föreslagna algoritmer ingår.
4. **Stutter** lämnas som den är.

## Mina tolkningar (granska gärna)

- **Namnet** är *Swap*. Borrow och dess loop-val försvinner, eftersom Stack tar lagren från Song. En sparad Borrow blir Swap i Stack-läge, random.
- **Kandidater i Stack:** lagren uppifrån och ner (Fill, sedan Main), och inom varje lager padens hits i ordning. Tomma lager räknas inte.
  - **Random:** vilken kandidat som helst, med lika chans.
  - **Round robin:** en kandidat längre för varje intervall som har en hit.
  - **Layer by layer, top down:** växlar lager per intervall, Fill, Main, Fill …, med varje lagers förvalda hit. Lager utan hit hoppas över.
  - **Layer by layer, bottom up:** samma sak men börjar med Main.
  - Rate (1/16, beat eller takt) gäller som för andra effekter.
- **Shuffle:** högen är hitsen på stegen med en hit inom klippet, efter Fill och Main men före andra effekter. Steg utan hit förblir tysta.
  - **Deck:** varje hit används en gång, i slumpad ordning.
  - **Random:** dra fritt, så samma hit kan komma flera gånger.
  - **Reverse:** högen i omvänd ordning.
  - **Rotate n:** varje slag tar hiten n slag längre fram. n är förvalt 1 och kan vara 1–15.
  - Shuffle arbetar per hit och har ingen rate.

## Ingår

### Model

1. `SwapEffect { target: 'swap', rate, mode }`, där `mode` är `{ kind: 'stack', pick }` eller `{ kind: 'shuffle', pick }`. Den ersätter `BorrowEffect` och målet `sourceLoop`.
2. Uppgradering: en Borrow blir `{ target: 'swap', rate, mode: { kind: 'stack', pick: 'random' } }`.
3. Validering: Rotate är 1–15.

### Engine

1. `songStack(project)`: för varje steg finns cellerna i lagren uppifrån och ner, med Fill-klippets och Main-klippets steg på samma position.
2. Stack tillämpas först i `applyMods`, med kandidaterna från `songStack`.
3. Shuffle räknas fram per klipp i `generateTriggers`, som en tabell från steg till cell innan effekterna tillämpas. Med slip följer den innehållets steg.
4. Swap går först, före alla andra mål. Har både A och B Swap vinner B.

### UI

1. Meningen:
   - "Every [1/16]: Swap [from the stack] — [at random | round robin | layer by layer, top down | layer by layer, bottom up]."
   - "Swap [by shuffling the clip] — [like a deck | freely | in reverse | rotated by [1]]."
2. Grafen visar per steg vilket lager eller vilken position hiten kommer från, med ett exempel för slump.
3. Förvalen: Reverse roll och de andra förblir som de är. En ny Swap är Stack, random.

## Tester som krävs

- [x] Stack top down med Main och Fill: F, M, F, M per 1/16, och lager utan hit hoppas över.
- [x] Stack bottom up börjar med Main. Round robin går igenom alla kandidater, även padens alternativ.
- [x] Stack random väljer bara bland kandidater. Med ett enda lager och en hit är det oförändrat.
- [x] Shuffle deck: samma steg spelar som utan Swap, och hitsen är en omordning av samma hög.
- [x] Shuffle reverse och rotate 1 ger exakt ordning.
- [x] Shuffle random kan upprepa en hit.
- [x] En gammal Borrow uppgraderas till Stack random.
- [x] UI: lägg till Swap, byt till Shuffle, välj deck. Grafen visar något, och meningen läses som ovan.
