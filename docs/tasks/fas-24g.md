# Fas 24g – Nålar i Loops och små rättelser

Magnus beslut 2026-10-22, redan inskrivna i `docs/spec.md`:

1. **Loops: alla matriser är fästa från början**, också en ny matrix (Listan, MATRICES i Loops). Nålarna är fortfarande vyns val och sparas inte, så efter Load är allt fäst igen. Test: en ny matrix syns direkt på hyllan Pads to use; en nål som tas bort tar bort den från hyllan.
2. **Gamla projekt: en tom Cycle** räknade 1, 2, 3 … och blir en stegrad som gör det (Gamla projekt). Rättar 24f, som tog bort den. En tom List tas fortfarande bort; en tom Cycle på Pad member blir In turn som förut. Lägg fallet i den gyllene fixturen (genererad med den gamla motorn, som 24f gjorde vid f48fa3b).
3. **Pad member: B off släpper igenom A:s medlem** (tabellen Raderna per mål). Rättar 24f, där B vann. Test: A medlem 2, B off ger medlem 2; A off, B off ger padens eget val.

Utanför fasen: listan och nålarna i Song (Song-v2).

## Klart när

- Varje punkt har ett test, testerna går igenom, typecheck och lint är gröna.
- Punkt 1 är provad i en riktig webbläsare, utan att röra Magnus autosparning (egen port).
- En sammanfattning i `docs/tasks/fas-24g-sammanfattning.md`, och raden Aktuell fas i `CLAUDE.md`.
