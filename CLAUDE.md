# Breakseq

Webbapp som gör drill n bass-breaks av uppklippta breaks (t.ex. Amen). Bara breaks, export som WAV.

**Specen i `docs/spec.md` är sanningen.** Om specen inte säger något om ett beteende: hitta inte på det. Stanna och fråga, eller lämna en tydlig `TODO(spec):` och nämn den i din sammanfattning.

## Arkitektur

Tre lager. Ett lager får bara importera från lagret under.

```
src/ui      React-vyer, uppspelning av renderad buffer, spelhuvud
src/engine  händelsegenerator (generate) och renderare (render)
src/model   typer, immutable state, kommandon, undo, automatisk kedja
```

- `src/engine/generate*` får **inte** bero på DOM, React eller Web Audio. Den ska gå att porta till en plugin.
- Endast `src/engine/render*` får använda Web Audio (`OfflineAudioContext`).
- Slump injiceras alltid: `type Rng = () => number` (0 ≤ x < 1). Använd aldrig `Math.random` direkt i model eller engine.
- State är immutable. Varje ändring är ett kommando som går att ångra, i en gemensam historik.
- Alla objekt har fasta id:n (`crypto.randomUUID()`), som aldrig återanvänds eller ändras.

## Domänord

Använd exakt dessa namn i kod, typer och tester: `Sample`, `Hit`, `Pad`, `Matrix`, `Loop` (`kind: 'main' | 'fill'`), `Mod`, `Song`, `Trigger`. Inga synonymer (inte "patch", "family", "pattern"). Break och one-shot är bara en klassificering av en `Matrix` (`matrixKind`), inga objekt. `Matrix` används bara för detta, aldrig i Mods.

## Kodregler

- TypeScript `strict`. Inga `any` utan kommentar om varför.
- Tester med Vitest, bredvid koden (`*.test.ts`). Varje beteende i specen som implementeras ska ha ett test.
- Tider i engine räknas i sekunder (number) och steg/takter som heltal. Inga avrundningar förrän vid sampelplacering i render.
- Små rena funktioner framför klasser.

## Kommandon

```
npm run dev        # Vite dev server
npm test           # Vitest
npm run typecheck  # tsc --noEmit
npm run lint
```

## Arbetssätt

- Projektet byggs i faser (se `docs/spec.md`, avsnitt Faser). Uppdraget för aktuell fas ligger i `docs/tasks/`.
- Börja aldrig på nästa fas. När "Klart när" är uppfyllt: sammanfatta vad som gjorts, vilka `TODO(spec)` som finns och vad som borde granskas.

**Aktuell fas:** 24g – Nålar i Loops och små rättelser (`docs/tasks/fas-24g.md`).
