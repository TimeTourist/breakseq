# Fas 3 – sammanfattning

## Gjort

- **Model:**
  - `Hit.variantOf` och `Pad.auto`.
  - `setLoopBars`, `replaceProject`, och `createLoop` som ger nästa lediga M- eller F-namn.
  - `baseName`: kedjan döper nu hits, pads och slices utan filändelse ("amen 01").
  - `upgradeProject` fyller i nya fält i autosparningar och projektfiler från fas 2.
  - **Sammanslagna ångra-steg:** `apply` tar en nyckel, och `seal` avslutar ett steg. Ett drag med ett reglage eller ett tal man skriver blir ett enda ångra-steg.
- **Engine:**
  - `scheduleHit`: en gemensam röst för rendering och direktuppspelning, så att en hit låter likadant i Hits som i låten.
  - `loopSong`: spelar en enda loop.
  - Projektfil (`writeProjectFile` och `readProjectFile`): en zip med `project.json` och en 32-bitars float-WAV per ljud, versionskontrollerad.
- **UI:**
  - Vyerna Tag, Hits, Pads och Loops.
  - Song har Fill-raden, och en fill döljer Main under sig.
  - Save och Open project i Import.
  - Loops spelar och exporterar den valda loopen, och spelhuvudet tänder steget.
  - Ett hit-ljud spelas direkt i Tag, Hits och Pads.

Alla tester från uppdraget finns (72 totalt). Typecheck, lint och build är gröna.

## Verifierat i webbläsaren (1440 px)

1. Fyra syntetiska snares importerades och taggades S. En ny pad byggdes av dem.
2. Padden lades på steg 5, 13 och 15 i en ny loop M2, med medlem 3 vald på steg 13.
3. M2 lades i takt 5 i Song.
4. En fill F1 lades i takt 4. Den dolde M1 där, och M2 tog över i takt 5.
5. I Loops spelade M2 med spelhuvudet på steg 5, 13 och 15. Preview i Pads spelade.

Inga fel i konsolen.

## Tolkningar att granska

- **Nya loopar:** en main får 4 takter och en fill 1 takt.
- **Egna taggar:** visas inte än, eftersom de kommer i fas 5. Tag-vyn har "Also"-knappar för extra taggar.
- **Hits-listan:** grupperas som Variants och per importerad fil. En slice hör till sitt break.
- **Gamla namn:** namn som skapats före fas 3 behåller ".wav" men visas utan.
