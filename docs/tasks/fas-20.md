# Fas 20 – Säkerhetskopior av autosparen

## Mål

Webbläsaren sparar de senaste versionerna av projektet, så att en olycka går att ångra även utan snapshot. Det hände i fas 15: ett tomt projekt skrevs över det sparade.

**Klart när:**
- Efter en sidladdning finns en kopia av projektet som det var innan något ändrades, och den kan återställas i Project.
- En Restore går att ångra med en annan kopia.
- Testerna går igenom, typecheck och lint är gröna, och det finns en sammanfattning i `docs/tasks/fas-20-sammanfattning.md`.

## Beslut (Magnus, 2026-10-16)

1. **När en kopia sparas:**
   - När sidan laddas sparas det projekt som laddades, innan något hunnit ändras.
   - Sedan sparas en kopia högst var 5:e minut, när projektet har ändrats.
   - De 20 senaste behålls.
2. **Återställning:**
   - Fliken Project har listan "Autosave backups" med en Restore-knapp per kopia.
   - Restore ersätter projektet och börjar en ny ångra-historik, som Load.
   - Det som fanns innan sparas först som en kopia, så att en Restore går att ångra.
   - Listan visas även när laddningen misslyckades och autosparen är av.
3. **Varje kopia visar:**
   - tiden, till exempel "14:32, 12 min ago",
   - den aktiva snapshoten,
   - antal breaks, loopar och klipp i Song.

## Min tolkning (granska gärna)

- **Ljudet sparas en gång per ljudfil**, inte i varje kopia. Ljudfiler ändras aldrig och deras id används aldrig igen. Ljud som ingen kopia längre använder tas bort.
- **Restore när laddningen misslyckades:** den återställda kopian blir projektet och autosparen slås på igen. Det trasiga sparade projektet skrivs då över. Du har själv valt att återställa.
- **Kopian vid laddning** görs bara om det fanns ett sparat projekt.
