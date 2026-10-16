# Fas 12 – sammanfattning

## Gjort

- `src/model/lengths.ts`: `hitSeconds` (regionen vid hittens och förälderns pitch), `stepHit`, `reach` (hur mycket av varje steg ljudet täcker, 0–1, klipps av nästa slag, ingen wrap), `loopReach` (i låtens tempo) och `slicePlaces` (varje markör på närmaste 1/16; den första vinner, övriga listas som `dropped`, precis som `placeBreak`).
- **Loops:** varje steg har en linje längs underkanten med hittens längd. Tomma steg under en svans får en svagare linje och går fortfarande att släppa på. Den tidigare `box-shadow`-linjen är ersatt.
- **Slice:** svaga 1/16-linjer över vågformen och en rad med stegen under den, med slicens nummer och svans. Ett steg där flera slices hamnar blir rött och säger vilken som tappas.
- Spec: Slice och Loops i "Pipeline och vyer" och fas 12 i tabellen, i både `docs/spec.md` och Claude Doc.

## Tester

9 nya (6 i model, 3 i UI). Totalt 216, typecheck och lint gröna. Kontrollerat i Chrome.

## TODO(spec)

Inga.

## Att granska

- Svansen wrappar inte från loopens slut till början, även om loopen spelas om.
- En hit kortare än ett steg visar en kortare linje i sitt eget steg.
- Svansen följer inte medlemsval från mods (Pad member, Swap), bara stegets valda medlem.
