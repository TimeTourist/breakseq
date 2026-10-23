# Fas 27a – Mod-förval

Specen: `docs/spec.md`, Crazy madness → **Mod-förval**, och **Listan och hyllan i Song** (gruppen på hyllan). Förvalen finns idag som knappar under Start from (`src/ui/modPresets.ts`, `MOD_PRESETS`) och som förval på ljudmoddarnas kort (Stutter Roll, Scratch Baby, Trance gate Straight m.fl.).

## Mål

Förvalen blir riktiga mods med `isPreset` i varje projekt, som aldrig ändras: en ändring gör en egen mod och flyttar klippen dit.

## Klart när

- Förvalens definitioner ligger i model (inte ui), så att både Mods, Song och Crazy (27b) kan använda dem; ett förval som beror på projektet räknas när det skapas.
- Ett nytt projekt har alla förval som mods med `isPreset` och fasta id:n; ett gammalt projekt får dem vid Load, och låter likadant (test).
- En ändring av ett förval (varje sorts ändring av en mods effekter, och 🎲) gör en ny egen mod med ändringen, flyttar förvalets klipp till den, väljer den, och är ett enda kommando som Undo tar tillbaka. Förvalet är oförändrat. Rename och Delete finns inte på ett förval; Clone och Start from fungerar som förut.
- Mods-listan har gruppen Presets sist med en markering; Songs hylla har gruppen Presets sist, alltid synlig och utan nålar; Songs lista visar inte förvalen. Ta bort `TODO(spec)` i `SongView.tsx`.
- Provat i en riktig webbläsare på egen port (inte 5199), också mobilbredd. Testerna går igenom, typecheck och lint är gröna, sammanfattning i `docs/tasks/fas-27a-sammanfattning.md`, raden Aktuell fas i `CLAUDE.md`.
