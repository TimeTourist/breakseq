# Bordlagt

Frågor som Magnus har valt att vänta med. De tas upp när det passar.

## Hits längd mot låtens tempo (2026-10-15)

En hit spelar sin region i egen längd, och nästa slag klipper den. När låtens tempo inte stämmer med breakets blir det luckor (långsammare) eller klippta slut (snabbare). Förslag:

- a) som nu
- b) ett val "fit to step" på föräldern, där uppspelningshastigheten anpassas så att slicen fyller stegen fram till nästa slag och tonhöjden följer med
- c) tidssträckning som behåller tonhöjden

Mitt förslag var a + b.

Alternativ c blir Fit to tempo i fas 15 (Stretch). Kvar är b, där tonhöjden följer med.

Att *se* längden byggdes i fas 12 (svansar i Loops, griden i Slice). Kvar här är bara vad som ska hända när tempona skiljer sig. Trioler och mikrotiming (nudge när föräldern dras in) väntar också (2026-10-16).

## Ordning mellan mods (2026-10-15)

Ordningen är fast: Swap → Pad member, Ratchet, Pitch, Volume, Direction → Tempo (slip) → Tape. Det går inte att lägga effekter efter Tape, och två tapes kan inte köras efter varandra (B vinner). Förslag:

- a) fast ordning som nu
- b) ordningen i listan gäller per mod
- c) Mod B verkar på det Mod A gör

Mitt förslag var a för nu.

## Presets (2026-10-16)

Spara och återanvända mellan projekt. Förslagen var:

- **Vad:** mods, hit-inställningar, breaks och one-shots (med ljud) och loopar som mönster av platsnummer.
- **Var:** en bibliotekmapp på disk.
- **Hur:** "+ From preset" och "Save as preset" i varje vy.
- **Inbyggda:** mods (Tape stop, Stutter roll …), hits (Octave down, Reverse …) och loop-mönster.
- **När:** efter fas 13 och 14.

## Project först bland flikarna (2026-10-16)

Fliken Project ligger sist, men en session börjar ofta där: du öppnar mappen, laddar en snapshot eller återställer en kopia. Att lägga den först i den numrerade raden bryter kedjan Import → Song. Siffertangenterna skulle också flyttas ett steg.

Förslag:

- Project blir en egen knapp till vänster, bredvid BREAKSEQ och utan nummer.
- Den visar den öppna mappen, till exempel "Project: Hek-tick".
- Kedjan 1–6 och tangenterna blir som de är.

## Mobil (2026-10-16)

Provat i 390 px bredd. Hits, Loops och Song får plats på bredden. Import gör det inte (823 px). Det man drar går också att göra med tryck: välj en pad eller loop och tryck på steget eller spåret.

Det som behövs:

1. **Projektmappar fungerar inte på mobil.** Mobila webbläsare kan inte öppna en mapp på disken. Snapshots, Save och New snapshot fungerar alltså inte. Autosparen, kopiorna och zip-filen fungerar.
2. **Sidhuvudet** tar ungefär en fjärdedel av skärmen och behöver bli en rad.
3. **Förklaringar i `title`** (31 ställen) syns aldrig med fingret.
4. **Små mål och sidscroll:** 16 steg per rad i Loops och sidscroll i Song. Att flytta och ändra längd på klipp i Song behöver provas med fingret.
5. **Import och Trim** behöver byggas om för smal skärm: större handtag, och ett sätt att flytta handtagen i små steg utan piltangenter.
6. **iPhone:** ljudet är tyst när ljudlös-knappen är på. Kanske behövs en notis.
7. **Rendering** går långsammare på en telefon.

Förslag:

- **Telefonen som komplement** (lyssna, justera mods och hits, arrangera Song): ungefär en fas av samma storlek som fas 16. Den omfattar punkt 2–6, och Project säger att mappar kräver en dator.
- **Fullt likvärdigt med datorn** kräver att snapshots kan sparas på annat sätt, i webbläsaren eller som zip. Det ändrar specen.

Mitt förslag: komplementet först.
