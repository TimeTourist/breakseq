# Fas 11 – sammanfattning

Fliken **Project** (nummer 7) öppnar och skapar projekt i en mapp på disk och sparar snapshots av arbetet: Save, New och Load, med (changed) när något inte är sparat.

## Gjort

- **Engine, i `src/engine/project-folder.ts`:**
  - `Folder` är ett litet gränssnitt för att läsa, skriva och lista filer. Det gör att mappen kan testas i minnet.
  - `saveSnapshot` skriver varje ljud en gång till `audio/<id>.wav` och snapshoten till `snapshots/<datum tid> <namn>.json`. Namn som krockar får "(2)", och ett namn som inte duger som filnamn görs om så att det fungerar på disk.
  - `loadSnapshot`, `listSnapshots` (nyast först), `readManifest`/`writeManifest` (`breakseq.json` pekar på den aktiva) och `comparable`, som jämför arbetet med den sparade snapshoten utan ljuddata.
- **UI:**
  - `src/ui/folders.ts` kopplar `showDirectoryPicker` till `Folder`. Den kommer ihåg mappen i IndexedDB, återansluter tyst om Chrome tillåter det och visar annars "Reconnect".
  - `ProjectView`: Open, New och listan från din skiss. Den aktiva snapshoten har märkena "active" och "changed" och knappen Save, raden "or keep it as [namn] [New]" kommer därefter, och sist de andra med Load.
  - Dialogen vid osparade ändringar har Save first, Discard changes och Cancel. New frågar "Keep the current work" eller "Start empty", och en mapp som redan har ett projekt ger felet "use Open".
  - En load börjar en ny ångra-historik.
  - Länkarna i Loops som pekade på Pads går nu till Hits.

## Verifierat

- Det finns 213 tester, och typecheck och lint är gröna.
  - Motorn har 6 tester: tur och retur med ljud, att ljud skrivs en gång, ordningen, namnkrockar och manifestet.
  - UI:t har 6 tester: New och (changed) och Save, ny snapshot och Load med Discard och ny historik, Save first, Open, New i ett befintligt projekt och tangent 7.
- Kontrollen i Chrome använde en riktig katalog via File System Access. Det var webbläsarens egen (OPFS) eftersom mappväljaren inte kan klickas i automatiserade tester, men det är samma API som för en mapp på disk.
  - New behöll arbetet som "Start".
  - En ändring gav (changed).
  - "Hek-tick Amen groove" blev aktiv.
  - Load av Start återställde loopnamnet.
  - Mappen innehöll `breakseq.json`, två snapshots och 6 ljudfiler.

## Att granska

- Mina tolkningar i `fas-11.md`: fliken ligger sist (7), mappens upplägg, Open av en tom mapp blir New, och New frågar om det befintliga arbetet ska behållas.
- Den riktiga mappväljaren mot en mapp på din disk har inte testats av mig. Prova gärna Project → New i Chrome.
