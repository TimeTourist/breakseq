# Fas 20 – Sammanfattning

## Gjort

- **Kopiorna sparas i IndexedDB**, i samma databas som autosparen. Databasen gick från version 1 till 2: två nya lager läggs till och det autosparade projektet ligger kvar. Det finns ett test för uppgraderingen.
  - `backups`: projektet utan ljud, tiden och en sammanfattning.
  - `backup-audio`: ljudet, en gång per ljud-id. Ljud som ingen kopia längre använder tas bort.
- **När kopior sparas** (`useAutosave` i `src/ui/App.tsx`):
  - När sidan laddas, med det sparade projektet, innan något ändrats.
  - Sedan vid en autospar, om den senaste kopian är minst 5 minuter gammal (`backupDue`).
  - De 20 senaste behålls (`BACKUP_KEEP`).
- **Samma projekt sparas inte två gånger i rad.** Utan det skulle 20 omladdningar utan ändringar trycka ut alla äldre kopior. Det märktes direkt: Vite laddade om sidan sex gånger medan jag skrev koden.
- **Restore** finns i Project, under "Autosave backups". Arbetet sparas först som en kopia, sedan laddas kopian med en ny ångra-historik. Den återställda kopian räknas som den senaste, så nästa kopia görs 5 minuter senare.
- **När laddningen misslyckades** visas listan ändå. Felmeddelandet hänvisar till den. En Restore slår på autosparen igen.
- **Varje rad visar** tid ("13:33, 12 min ago", med datum en tidigare dag), aktiv snapshot och "1 break · 3 loops · 8 clips".

## Provat

- 297 tester gröna, typecheck och lint gröna.
- I Chrome på 127.0.0.1 provade jag följande. Projektet på localhost rördes inte.
  - Omladdning utan ändring ger ingen ny kopia.
  - Tempo 123 och sedan Restore ger 170. Arbetet med 123 blev en kopia, och Restore av den gav tillbaka 123.

## Att granska

- **Kopian vid laddning visar alltid "No snapshot".** Projektmappen kopplas in först när du öppnar Project, efter laddningen. Kopiorna var 5:e minut har snapshot-namnet.
- **Kopior som bara skiljer sig i tempo eller detaljer ser likadana ut.** Tempo skulle kunna läggas till på raden ("170 BPM · 1 break …"). Det gjorde jag inte, eftersom det inte var beslutat.
- **Restore frågar inte först**, eftersom arbetet alltid sparas som en kopia innan.
- **Restore efter en misslyckad laddning skriver över det trasiga sparade projektet**, eftersom autosparen slås på igen.

Inga `TODO(spec)`.
