# Fas 11 – Project och snapshots

## Mål

En ny flik, **Project**, där man öppnar och skapar projekt och sparar snapshots. Ett projekt är en mapp på disk. En snapshot är en JSON-fil med allt i projektet, där ljuden refereras med sökväg. När något låter bra tar man en snapshot, ändrar vidare och kan alltid hoppa tillbaka.

**Klart när:** man kan skapa ett projekt i en mapp och spara snapshoten "basic Amen groove". Därefter gör man ändringar och sparar dem som en ny snapshot, "Hek-tick Amen groove". Laddar man den första kommer allt tillbaka som det var, och den andra ligger kvar orörd. Testerna nedan går igenom, typecheck och lint är gröna, och det finns en sammanfattning i `docs/tasks/fas-11-sammanfattning.md`.

## Beslut (Magnus, 2026-10-15)

1. Fliken **Project** har knapparna Open och New, och en lista med snapshots enligt skissen:
   ```
   2026-10-15 20:30 Hek-tick Amen groove (active) (changed) [save]
                    [ new snapshot name here ]  [new]
   2026-10-15 19:20 basic Amen groove                   [load]
   ```
2. **Save** skriver över den aktiva snapshoten.
3. **New** sparar nuläget som en ny snapshot med det namn man skrivit, och den blir aktiv. Den förra ligger kvar som den var senast den sparades.
4. **(changed)** betyder att det finns ändringar som inte är sparade i den aktiva snapshoten.
5. **Load** när det finns osparade ändringar frågar: Save first, Discard changes eller Cancel.
6. Ångra gäller inom en snapshot. En load börjar en ny ångra-historik.
7. **Lagring:** i en projektmapp på disk. Chrome frågar en gång om appen får läsa och skriva där. Samplingarna sparas som filer och refereras med sökväg.

## Mina tolkningar (granska gärna)

- **Mappens innehåll:**
  ```
  breakseq.json             { format, version, active: "snapshots/…json" }
  snapshots/<datum tid> <namn>.json
  audio/<id>.wav            varje ljud en gång, 32-bit float, utan förlust
  ```
  En snapshot är samma JSON som i projektfilen (zip), alltså projektet med ljuden ersatta av sökvägar, plus namn och tid. Ljud som redan finns i mappen skrivs inte om.
- **Fliken ligger sist**, som nummer 7, så att tangenterna 1–6 är som förut.
- **Open** väljer en mapp. Har mappen ett projekt laddas den aktiva snapshoten. Är mappen tom blir det samma sak som New i den mappen.
- **New** väljer en mapp och frågar: "Keep the current work" eller "Start empty". Den första snapshoten heter "Start" och blir aktiv. Finns det redan ett projekt i mappen blir det ett fel som säger "use Open".
- **Mappen kommer appen ihåg** mellan besök. Efter en omladdning kan Chrome kräva ett klick, och då visar fliken "Reconnect <mappnamn>".
- **Autosparningen i webbläsaren finns kvar** som förut. Snapshots skrivs bara när man trycker Save eller New.
- **Utan mapp** fungerar appen som idag. Project-fliken visar då bara Open och New.
- **Export och import av zip** finns kvar i Import.

## Ingår

### Engine (`src/engine/project-folder.ts`, utan DOM)

- `Folder` är ett litet gränssnitt (läs och skriv text och bytes, lista en katalog), så att mappen går att testa med en mapp i minnet.
- Funktionerna `readManifest`, `writeManifest`, `listSnapshots`, `saveSnapshot`, `loadSnapshot` och `comparable`. Den sista ger en sträng att jämföra med för (changed).

### UI

- `src/ui/folders.ts` kopplar File System Access (`showDirectoryPicker`) till `Folder`. Den kommer också ihåg mappen i IndexedDB och frågar om behörighet igen.
- `ProjectView` med Open, New, listan, Save, New snapshot, Load och dialogen för osparade ändringar.
- I storen: aktiv snapshot och den sparade jämförelsesträngen, och en load börjar en ny historik.

## Tester som krävs

- [x] `saveSnapshot` och `loadSnapshot` i en mapp i minnet ger samma projekt tillbaka, med ljud.
- [x] Ljud skrivs en gång, och en andra snapshot skriver inte om dem.
- [x] `listSnapshots` ger nyast först, med namn och tid. Två snapshots med samma namn och minut skriver inte över varandra.
- [x] Manifestet pekar på den aktiva snapshoten.
- [x] UI: New ("Start") och sedan en ändring visar (changed). Save tar bort (changed). New snapshot med ett namn gör den aktiv och lämnar den gamla. Load av den gamla med osparade ändringar frågar, och Discard laddar den och börjar en ny ångra-historik.
- [x] UI: Open av en mapp med projekt laddar den aktiva snapshoten.
