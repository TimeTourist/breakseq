# Fas 16 – sammanfattning

## Gjort

- **Sidhuvudet:** Export WAV är borta. På dess plats finns Save och New snapshot.
  - **Save** skriver över den aktiva snapshoten. Knappen är avstängd utan projektmapp, utan aktiv snapshot eller utan ändringar, och förklarar varför i sin title.
  - **New snapshot** öppnar en ruta under sidhuvudet med ett namnfält och knappen Keep. Escape stänger rutan utan att spara. Utan namn blir det "Snapshot N".
- **Project:**
  - Panelen Export har Export WAV, som exporterar låten som den hörs nu.
  - Varje snapshot, även den aktiva, har Play och Export. Snapshoten läses från filen och renderas utan att laddas, så arbetet som är öppet rörs inte. Load finns på alla utom den aktiva.
  - Exporterade filer heter `breakseq-<snapshot>-<tid>.wav`.
- **Kod:**
  - Save och New snapshot ligger i `src/ui/snapshots.ts` (`useSnapshots`), som sidhuvudet och Project delar.
  - Listan över snapshots ligger nu i store (`projectFolder.snapshots`), så att båda alltid visar samma sak.
- **Tester:**
  - `src/ui/export.test.tsx` (4)
  - `project.test.tsx` uppdaterad för knapparna i sidhuvudet
  - Totalt 249, alla gröna. Typecheck och lint är gröna.
- **Verifierat i Chrome** på ditt projekt: Play på "Hek-tick Amen groove" spelar utan att laddas, och Stop stoppar. Rutan för New snapshot öppnas under sidhuvudet. Inget sparades.

## Att granska

- **Loopar exporteras inte längre från Loops.** Export finns bara i Project och gäller låten, som beslutat.
- **Ändrar du något medan en snapshot spelar** renderas din låt om och tar över efter loopen, som vid andra ändringar.
- **Nytt fält i Project:** "or keep it as" med namnfält är borta. Namnet anges nu i rutan under New snapshot.

## TODO(spec)

Inga.
