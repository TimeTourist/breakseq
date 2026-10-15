# Fas 9 – Breaks, pads och hits i en vy; taggar och omfång bort

## Mål

Ordlistan blir tydlig och vyerna följer den: **Sample → Hit → Pad → Break**. Taggar och omfånget "Acts on" tas bort, eftersom de inte behövs. Hits och Pads blir en vy där man ser breaket, dess pads i ordning och varje pads hits.

**Klart när:** i Hits-vyn syns Amen med föräldern överst och pad 01–64 under. Till pad 08 kan man lägga en baklänges variant och en snare från en one-shot, och moden Pad member växlar mellan dem. Taggar och omfång finns inte kvar någonstans. Ett gammalt projekt öppnas och låter som förut, utom mods som hade omfång, som nu gäller allt under sitt klipp. Testerna nedan går igenom, typecheck och lint är gröna, och det finns en sammanfattning i `docs/tasks/fas-9-sammanfattning.md`.

## Beslut (Magnus, 2026-10-15)

1. **Ordlistan:**
   - **Sample** är ljudet: one-shot, break eller slice.
   - **Hit** säger hur ett sample spelas. Ett breaks egen hit är förälder (makro) till dess slices.
   - **Pad** är det ett steg spelar: en hit plus alternativ. Den första spelas utan mods.
   - **Break** är ett slicat sample, med dess pads i ordning (groovet) och föräldern.
   - Inga nya begrepp, och inga namnbyten i koden.
2. **One-shots är hits** med en egen pad. De används fritt i loopar, eller dras in i en pad som alternativ.
3. **Hits och Pads blir en vy, Hits.** Flikarna blir Import, Slice, Hits, Loops, Mods och Song. Project kommer i fas 11.
4. **Taggar tas bort helt**, även Tag-vyn, autotaggningen och tagg-färgerna. Färger skippas tills vidare.
5. **"Acts on" (omfång) tas bort.** En mod verkar på allt under sitt klipp. Stutter och de andra effekterna fungerar som förut, men utan omfång.

## Ingår

### Model

1. Bort: `Tag`, `Project.tags`, `Sample.mainTag`, `extraTags` och `tagGuessed`, kommandona för taggar, `MAX_TAGS` och taggarnas referenskontroll.
2. Bort: `ModScope` och `scope` på stegeffekter och Borrow.
3. Uppgradering: taggfält och omfång tas bort när ett äldre projekt öppnas.
4. Kvar som förut: pads med medlemmar, varianter som hamnar i samma pad, föräldern som makro och `placeBreak`.

### Engine

1. `inScope` tas bort, och effekter gäller alla steg under klippet.
2. `classifyHit` används inte längre och tas bort, liksom dess tester.

### UI

1. **Hits-vyn:**
   - Vänster sida listar varje break med föräldern som rubrik och dess pads i ordning, och därefter one-shots.
   - En pad visar sina hits i ordning, och den första är standard.
   - När du väljer en hit redigeras den med dagens redigerare: region, riktning, pitch, volym, fade och "Variant".
   - "+ Hit" eller ett drag lägger till en hit i en pad. Ordningen ändras genom att dra eller med pilar, och ett × tar bort en hit.
   - Den tidigare Pads-vyns funktioner följer med: provlyssna en pad, döp om den och se var den används.
2. **Tag-vyn tas bort**, och tangenterna 1–6 går till de nya flikarna.
3. **Mod-meningarna** saknar "on …": "Every beat: Pitch goes through 0 3 5 7 in turn."
4. **Färger:** steg och klipp får en neutral färg i stället för tagg-färgen.

## Tester som krävs

- [x] Ett gammalt projekt med taggar och omfång öppnas, och fälten är borta.
- [x] En mod som hade omfånget "S steps" gäller alla steg under klippet.
- [x] Hits-vyn visar ett break med föräldern och pads i ordning, och one-shots för sig.
- [x] Att lägga en one-shot i en pad i ett break gör den till alternativ 2, och Pad member 2 spelar den.
- [x] En variant hamnar i samma pad som originalet, som förut.
- [x] Det finns ingen Tag-flik, och tangent 3 öppnar Hits.
- [x] Mod-meningen saknar omfång.
