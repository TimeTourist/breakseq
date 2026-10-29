# VST fas 1 – sammanfattning

Magnus provade bygget (Actions-körning 40957198952) i Reason 13 2026-10-29 efter listan i Klart när och svarade "allt verkar funka". Punkterna rapporterades inte en och en.

## Gjort

- **Kopian:** `app/` kopierad till `vst/web` (commit för sig), fristående från och med då. `app/` är orörd.
- **Bygget:** workflowet kör typecheck, lint och tester för `vst/web`, bygger med Vite, zippar `dist/` in i pluginen (`BinaryData::web_zip`), bygger pluginen och kör mixerns tester. Typsnitten (IBM Plex) är inpackade, så sidan fungerar utan nät. Spiksidan och testklippet från fas 0 är borta.
- **Uppspelning:** webbappens spelare (`createPlayer`) är oförändrad och får en `AudioContext` som skickar allt till C++ (`vst/web/src/ui/plugin/remote-audio.ts`). `vst/src/Mixer.*` spelar buffrar och volymkurvor på Reasons samplingsklocka, resamplar och spelar en sen start från där den borde vara. Ett klick på en hit eller pad renderas först och spelas som en buffert. *(Claudes val av lösning.)*
- **Lagring:** projektet sparas som projektfil (base64) i instansens state; Undo-historiken sparas inte.
- **Tempo:** Reasons tempo går in i varje läge i historiken (`hostTempo` i `store.ts`), så det är inget ångra-steg och Undo tar inte tempot ifrån Reasons. Tempofältet är låst med förklaring i muspekaren.
- **Project-fliken:** exporterna är dolda (gjorda valfria i `Services`); Save av projektfil går via en Windows-dialog; projektmappar och snapshots som i webbappen.

Tester: 1020 i `vst/web` (11 nya för pluginlagret), 7 mixertester i C++ som körs i workflowet och som också kördes på Linux här.

## Claudes val, att granska

- När pluginfönstret stängs slutar det som spelar (sidan och dess spelare försvinner med fönstret).
- Hela projektet, ljudet med, skickas till C++ vid varje autospar. Med mycket ljud kan det bli segt; då bör ljudet skickas en gång per ljud-id, som backuperna gör.
- Mixern allokerar lite på ljudtråden (kartor för buffrar och volymer när kommandon tas in) och släpper ett buffertminne bara om låset är ledigt. Det har inte märkts men är inte strikt realtidssäkert.
- En gammal instans från fas 0 läser inte sitt sparade läge (annat format) och börjar tomt.

## TODO(spec)

Inga.
