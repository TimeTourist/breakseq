# Fas 23b – Rättelser efter test av fas 23

Magnus testade fas 23 (2026-10-19). Allt nedan är hans beslut, om inget annat står. Varje beslut skrivs in i `docs/spec.md` på sitt ställe, märkt *(Magnus beslut; ändras inte utan att fråga.)*, så att en senare fas inte tar bort det.

## A. Pads och uppspelning

1. **Play spelar alltid matrisen i fokus**, i loop, vad som än är valt. Det gäller både Play i headern och ▶ på fokusraden, som då heter Play matrix. Den som vill höra en pad eller en hit klickar på den.
2. **Ett klick på padens nummer** överst i kolumnen spelar paden enligt dess val, ett val per klick: Top ger första hitten, Round robin nästa i tur, och Random och No repeat slumpar. Ett klick på en hit spelar just den hitten.
3. **Variationerna hörs när matrisen spelar.** Bugg: Play renderar ett enda varv och loopar bufferten, så varje pad väljer bara en gång. Round robin fastnar därför på hit 1, och Random slumpar aldrig om. Play ska rendera så många varv att varje Round robin-pad hinner gå ett helt varv (minsta gemensamma multipel av antalet hits, med ett tak) och att Random och No repeat hinner välja flera gånger (som `PAD_ROUNDS`). Kolla samma sak för en loop som spelas i Loops.
4. **Det syns vad som är vad.** Panelen under tidslinjen har en rubrik som säger vad den visar: *Matrix*, *Pad 08* eller *Hit 2 in pad 08*. I tidslinjen visar varje hit sin plats i paden först (`1 08`, `2 →Winst…03`), så att hitten inte ser ut som padens nummer. *(Claudes förslag, som Magnus sa ja till.)*

## B. Samples och Loops

5. **Trim och slicing visas på samma ställe: under tabellen.** Trim (start, slut och kanal) ligger ovanför vågformen med slicingen, och tabellen är bara en lista att välja i. Ingen Trim fälls längre ut i en rad i tabellen.
6. **Länkarna står på ett ställe:** i rubriken under tabellen, `← File  ← Trim  Pads →  ♪ Song →` (fas 23, commit 36ca165). Creates i tabellen säger bara vad trimmen gör, med antal, och har inga länkar. Undantag: Slice ↓ och Create Slices ↓ väljer trimmen.
7. **Delete och Backspace tar bort den markerade slicens markör**, som knappen Delete marker gör. Det gäller inte när man skriver i ett fält.
8. **Texten "not sliced" i kolumnen Trim tas bort.**
9. **Slice och Don't slice blir en knapp**, Slice, som slås av och på (`aria-pressed`). Av på en slicad trim frågar först, som Don't slice gör i dag.
10. **Långa namn kortas på samma sätt överallt:** en funktion, `middleEllipsis` i `src/ui/labels.ts`, och en längd. Filnamn i Samples, hits i Pads och namn i Loops vänstermeny använder den, och hela namnet syns när man håller musen över det. Längden blir kortare än i dag. *(Claudes val av exakt längd.)*
11. **Loops vänstermeny:** varje loop står på en rad, kortad som i punkt 10, och bryts aldrig.

## C. Song

12. **Linjalen får två fält.** Det övre fältet är för loopområdet: där dras ett nytt område, och där sitter handtagen. Det undre fältet, med taktsiffrorna, är för startpunkten: ett klick flyttar den. Startpunkten går då alltid att flytta till början, också när loopen börjar där.
13. **Loopområdet syns alltid.** Utan ett markerat område visas hela låten som området, avstängt (grått). Knappen Loop slår av och på som i dag.

## Klart när

- Allt ovan fungerar och är provat i en riktig webbläsare.
- Varje beslut står i `docs/spec.md` och har ett test.
- Testerna går igenom, och typecheck och lint är gröna.
