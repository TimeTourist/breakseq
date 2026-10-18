# Fas 23 – Gränssnitt för matriser (förslag)

## Mål

Gränssnittet ska passa modellen från fas 22 och vara snabbt och enkelt att göra drill n bass med: man arbetar med **ett break i taget** och tar ljud från **några utvalda matriser**, utan listor med allt. Dagens Hits, Import och Slice är byggda för den gamla modellen och lappade för den nya; de skrivs om.

Skissen som valdes (layout B, tidslinje): https://claude.ai/artifact/WkYJqRDTFFwXYfEyCKALgT

**Klart när:**
- Amen importeras och slicas i Samples utan att byta flik.
- I Pads ligger amen 1 i fokus som en tidslinje, och Kicks, Snares och Fx (one-shots) ligger framme under Take from. En snare från Snares dras till pad 07 och blir en kopia där; en hit som släpps på sista padens hit ersätter den.
- En ny matrix *Snares* kan byggas med + New matrix och kryssrutor, där varje ljud hörs vid ett klick.
- Hela flödet går att göra med tangentbordet (välja pad och hit, spela) och på en mobil (tryck på en hit, sedan på en pad).
- Loops hylla visar bara matrisen i fokus och de man tar från.
- Ingen text i gränssnittet använder break eller one-shot som namn på ett objekt, bara som klassificering (ikon och etikett).
- Testerna går igenom, typecheck och lint är gröna, drag och släpp är provat i en riktig webbläsare, och det finns en sammanfattning i `docs/tasks/fas-23-sammanfattning.md`.

## Beslut (Magnus, 2026-10-18)

1. **Flikarna:** Samples → Pads → Loops → Mods → Song → Project. Samples ersätter Import och Slice; Pads ersätter Hits.
2. **Samples: här klipper man.** Filerna och deras trimmar, vågformen för den valda trimmen, Slice eller Don't slice, takter, markörer, transienter, cue-markörer och dialogen New trim / Renumber (fas 22), kanal och trim. Ingenting låter annorlunda av det man gör här. WAV, AIFF och REX2 dras in här.
3. **Pads: här formar man allt man hör.** Layout B:
   - **Focus:** en matrix i taget, som en tidslinje: padsen efter varandra i tid (x), lika breda som de spelar, och varje pads hits nedåt (y).
   - **Take from:** de andra matriser man valt att ta från, som en hylla under tidslinjen, var och en med sina hits.
   - **Reglagen** sitter under och gäller det som är valt: en hit, en pad (alla dess hits och hur den väljer) eller matrisen (allt i den, dagens förälder).
4. **Drag ger kopior** (fas 22): en hit eller "all hits" i en matrix som släpps på en pad läggs sist i den. **En hit som släpps på en annan hit ersätter den:** den gamla tas bort och kopian hamnar på dess plats. Under draget syns vilket som händer. Ctrl+Z ångrar.
5. **Fokus är ett och samma i Pads och Loops:** hyllan i Loops visar matrisen i fokus och de man tar från.
6. **+ New matrix** gör en tom matrix som man döper och fyller genom att kryssa i laddade one-shots i en lista, där ett klick spelar ljudet.
7. **Ett klick spelar**, och tangentbordet stegar genom pads och hits.
8. **På mobil:** tryck på en hit (eller "all hits") och sedan på en pad eller hit.
9. **Utanför fasen:** Mods nya gränssnitt (fas 24) och filbläddraren (bordlagd).
10. **Först en sortering:** appen gås igenom i en riktig webbläsare, och det som hittas delas i *modell* och *gränssnitt*. Buggar i modellen och motorn rättas i början av fasen; buggar i gränssnittet blir en checklista som det nya gränssnittet ska klara.
11. **Fliken heter Samples** (inte Sounds): det man gör där är att klippa samples, i ordlistans mening.
12. **Ersätta är ett riktigt byte:** steg i loopar och mods som låst den gamla hitten spelar den nya. Ersätts en pads första hit kan paden få ny längd, och då flyttas padsen efter, som vid andra ändringar av första hitten.
13. **Ordning inom en pad med drag:** ett släpp *mellan* två hits i samma pad flyttar hitten dit (en markering visar var), också uppåt till första plats; ordningen styr Top och Round robin. Ett släpp *på* en hit ersätter. Drag från en annan pad, också i samma matrix, ger alltid en kopia.
14. **Inget av dagens Hits försvinner**, det flyttar: trimmens vågform med numrerade slicelinjer till Samples; namn, Clone, Delete, + Pad och länken ← Samples på matrisens rad i Pads; Delete pad, flytta pad i tidslinjen och padens val på paden; Replace…, region med handtag, Variant och övriga reglage bland hittens reglage. ♪ Song, etiketter som `15→07` och Back/Forward mellan flikar finns kvar.
15. **+ New matrix** gör en matrix med en pad; varje ikryssad one-shot läggs där som en kopia med sina inställningar. Listan används när matrisen skapas; senare läggs fler till med drag eller + Hit, utan koppling till originalen. *(Claudes beslut.)*
16. **Fokus och Take from är vyns val**, inte projektets, och går inte att ångra, som hyllans kryssrutor i dag. Loops får samma fokusrad som Pads; listan "Show in Pads" tas bort. *(Claudes beslut.)*

## Förslag (granska gärna)

- **Tangentbordet i Pads:** ←/→ byter pad, ↑/↓ byter hit i paden, och varje steg spelar det valda; Enter väljer matrisen; mellanslag är Play/Stop som i dag.
- **Zoom i tidslinjen:** "Fit" visar hela matrisen; en takt per skärmbredd är den andra nivån. 64 pads på 1/16 i Fit blir smala kolumner med bara numret och den första hittens vågform; alternativen syns när man zoomar in eller väljer paden.
- **Matrisens rad:** överst i Focus, med matrisens namn, ikon (break eller one-shot), länken ← Samples till dess trim, och reglagen för hela matrisen när den väljs.
- **Take from väljs** med knappar i en fokusrad överst i Pads och Loops (samma som i skissen).
- **Play i headern** spelar det som är valt i Pads: en hit en gång, en pad som den väljer, eller matrisen i loop, som Hits gör i dag.
- **Samples layout:** filtabellen överst (som Import i dag), och den valda trimmens vågform med slicing under (som Slice i dag), på samma sida.
- **Gamla vyer tas bort:** HitsView, ImportView och SliceView ersätts av PadsView och SamplesView; delar som fungerar (vågform, slicelinjer, reglage, dialoger) återanvänds.

## Lämnas till byggaren

- Komponentuppdelning och hur drag och släpp delas mellan Pads och Loops.
- Exakta mått, färger och ikoner, inom appens nuvarande stil.
