# Fas 9 – sammanfattning

Ordlistan är nu Sample → Hit → Pad → Break, och vyerna följer den. Taggar och "Acts on" är borta. Hits och Pads är en enda vy, och flikarna är Import, Slice, Hits, Loops, Mods och Song (tangenterna 1–6).

## Gjort

- **Model:**
  - Taggar är borttagna helt: `Tag`, `Project.tags`, samplens taggfält, kommandona och referenskontrollen.
  - `ModScope` och `scope` är borttagna från stegeffekter och Borrow.
  - `upgradeProject` tar bort taggar, taggfält och omfång ur äldre projekt.
- **Engine:**
  - Utan omfång verkar en mod på allt under sitt klipp.
  - Effekter verkar bara på steg som har en hit. Utan den regeln räknade Cycle även tomma steg när omfånget försvann, så varje slag hamnade på samma medlem. Det hittades av ett test och är rättat.
  - `classifyHit` och tagg-gissningen är borttagna.
- **UI:**
  - **Hits-vyn:**
    - Till vänster visas varje break med föräldern som rubrik (klickbar, med märket "parent") och dess pads i ordning, med pad-numret och padens hits som chips. Därefter följer One-shots och Built.
    - Till höger finns den öppna paden. Den kan döpas om, provlyssnas och tas bort. Dess hits står i ordning, där den första är "default", och kan ordnas om med pilar eller drag och tas bort med ×. Under listan finns "+ Hit" (sök och lägg till), och en hit kan också dras från vänster.
    - Under paden finns redigeraren för den valda hitten, med region, riktning, pitch, volym, fade, "Variant" och borttagning.
    - Föräldern öppnas för sig, som makro för alla slices.
  - Tag- och Pads-vyerna är borttagna. Länkar som gick till Pads går nu till Hits.
  - Mod-meningarna saknar "on …": "Every beat: Pitch goes through 0 3 5 7 in turn."
  - Stutter-förvalet verkar på allt under klippet.
  - Färger: alla hits ritas i en neutral färg.

## Verifierat

- Det finns 191 tester, och typecheck och lint är gröna.
- I webbläsaren har ditt projekt uppgraderats. Flikarna är 1–6, Hits visar TEST_BREAK och Amen-break med "parent" och sedan One-shots och Built. snare_01 drogs med en riktig drag till Amen-break 08 och blev dess hit 2.

## Att granska

- Klicket på ett break-namn öppnar föräldern för redigering. Om det ska göra något annat, säg till.
- En pad med en hit visar både pad-numret och ett chip med samma nummer i listan. Det kan bli tydligare.
- Det finns inga `TODO(spec)`.
