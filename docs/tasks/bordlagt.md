# Bordlagt

Frågor som Magnus har valt att vänta med. De tas upp när det passar.

## Hits längd mot låtens tempo (2026-10-15)

En hit spelar sin region i egen längd, och nästa slag klipper den. När låtens tempo inte stämmer med breakets blir det luckor (långsammare) eller klippta slut (snabbare). Förslag:

- a) som nu
- b) ett val "fit to step" på föräldern, där uppspelningshastigheten anpassas så att slicen fyller stegen fram till nästa slag och tonhöjden följer med
- c) tidssträckning som behåller tonhöjden

Mitt förslag var a + b.

Alternativ c blir Fit to tempo i fas 15 (Stretch). Kvar är b, där tonhöjden följer med.

Att *se* längden byggdes i fas 12 (svansar i Loops, griden i Slice). Kvar här är bara vad som ska hända när tempona skiljer sig. Trioler och mikrotiming (nudge när föräldern dras in) väntar också (2026-10-16).

## Ordning mellan mods (2026-10-15)

Ordningen är fast: Swap → Pad member, Ratchet, Pitch, Volume, Direction → Tempo (slip) → Tape. Det går inte att lägga effekter efter Tape, och två tapes kan inte köras efter varandra (B vinner). Förslag:

- a) fast ordning som nu
- b) ordningen i listan gäller per mod
- c) Mod B verkar på det Mod A gör

Mitt förslag var a för nu.

## Presets (2026-10-16)

Spara och återanvända mellan projekt. Förslagen var:

- **Vad:** mods, hit-inställningar, breaks och one-shots (med ljud) och loopar som mönster av platsnummer.
- **Var:** en bibliotekmapp på disk.
- **Hur:** "+ From preset" och "Save as preset" i varje vy.
- **Inbyggda:** mods (Tape stop, Stutter roll …), hits (Octave down, Reverse …) och loop-mönster.
- **När:** efter fas 13 och 14.

## Project först bland flikarna (2026-10-16)

Fliken Project ligger sist, men en session börjar ofta där: du öppnar mappen, laddar en snapshot eller återställer en kopia. Att lägga den först i den numrerade raden bryter kedjan Import → Song. Siffertangenterna skulle också flyttas ett steg.

Förslag:

- Project blir en egen knapp till vänster, bredvid BREAKSEQ och utan nummer.
- Den visar den öppna mappen, till exempel "Project: Hek-tick".
- Kedjan 1–6 och tangenterna blir som de är.

## Mobil (2026-10-16)

Provat i 390 px bredd. Hits, Loops och Song får plats på bredden. Import gör det inte (823 px). Det man drar går också att göra med tryck: välj en pad eller loop och tryck på steget eller spåret.

Det som behövs:

1. **Projektmappar fungerar inte på mobil.** Mobila webbläsare kan inte öppna en mapp på disken. Snapshots, Save och New snapshot fungerar alltså inte. Autosparen, kopiorna och zip-filen fungerar.
2. **Sidhuvudet** tar ungefär en fjärdedel av skärmen och behöver bli en rad.
3. **Förklaringar i `title`** (31 ställen) syns aldrig med fingret.
4. **Små mål och sidscroll:** 16 steg per rad i Loops och sidscroll i Song. Att flytta och ändra längd på klipp i Song behöver provas med fingret.
5. **Import och Trim** behöver byggas om för smal skärm: större handtag, och ett sätt att flytta handtagen i små steg utan piltangenter.
6. **iPhone:** ljudet är tyst när ljudlös-knappen är på. Kanske behövs en notis.
7. **Rendering** går långsammare på en telefon.

Förslag:

- **Telefonen som komplement** (lyssna, justera mods och hits, arrangera Song): ungefär en fas av samma storlek som fas 16. Den omfattar punkt 2–6, och Project säger att mappar kräver en dator.
- **Fullt likvärdigt med datorn** kräver att snapshots kan sparas på annat sätt, i webbläsaren eller som zip. Det ändrar specen.

Mitt förslag: komplementet först.

## Hosting och Windows-program (2026-10-16)

**GitHub Pages:** görs 2026-10-16. `.github/workflows/pages.yml` testar, bygger med `--base=/breakseq/` och publicerar på https://timetourist.github.io/breakseq/ vid varje push till `main`. PWA och Tauri är fortfarande bordlagda.

- Appen har ingen server, så Pages räcker.
- Det behövs `base: '/<repo>/'` i `vite.config.ts` och ett Actions-flöde som testar, bygger och publicerar `dist`.
- Med en gratis GitHub-plan måste repot vara publikt. Netlify och Cloudflare Pages fungerar med privata repo.
- Repot har inga ljudfiler.
- Autosparen följer inte med från localhost, men projektmappen gör det.
- Repot är bara lokalt i dag. Push och repo-namn bestämmer Magnus.

**Windows-program**, från lättast:

1. **PWA:** installeras från Edge eller Chrome och öppnas i ett eget fönster, även utan nätverk. Allt fungerar som i dag. Det behövs en manifest-fil, en ikon och en service worker, ungefär en liten fas. Den kräver https en gång, till exempel Pages.
2. **Tauri:** en `.exe` på 5–10 MB som använder WebView2. Projektmapparna måste provas. Bygget kräver Rust, och kan göras på Windows eller i CI.
3. **Electron:** fungerar som i dag men är 100 MB eller mer. Den ger inget som Tauri inte ger.

En ny installation börjar med tom autospar, men snapshots ligger kvar i mappen. En VST-plugin kräver en ny motor, men `generate` är förberedd för det.

Förslag: PWA tillsammans med GitHub Pages först, och Tauri senare om en fil ska delas ut.

## Exemplet i Mods visar det som hörs

New example i Mods ritar bara om exempelgrafen. Den skulle kunna slumpa om det som spelas också, så att grafen visar exakt vad som hörs. Kräver att exemplet och renderingen delar slumptal. (Bordlagt 2026-10-17.)

## Spelknappen i Hits

Hits har en egen ▶ vid paden eller den valda hitten, som gör samma sak som Play i toppen. Enligt regeln att en spelknapp i en flik bara behövs när det är oklart vad Play i toppen spelar kunde den tas bort och ersättas av en text bredvid Once/Loop ("Play: pad eight 1 01"). Den lilla ▶ på varje rad i en pad spelar en hit en gång och berörs inte. Användaren vill titta på det som finns först. (Bordlagt 2026-10-17.)

## Bit-WAV:en i MIDI-exporten och Reason

Reason läser inte cue-markörerna i bit-WAV:en utan gissar på transienter, så det blir för många slices (och en kort slice i början). Rutorna är lika långa som det längsta ljudet, och antalet rundas upp till 4, 8, 16, 32 eller 64, vilket kan ge flera sekunder tomt i slutet. Idéer: rutor i hela 1/16 i låtens tempo så att varje ljud börjar på Reasons rutnät, och bara lika många rutor som ljud. Rutor på rutnätet byggdes och togs bort igen: de gick inte att använda i REX. Användaren fick det att fungera i Reason med slice och lite pill, och exporten är som förut. (Bordlagt 2026-10-17.)

## Fler spår

Flera loopar som spelar samtidigt, var och en med egen röst (till exempel en kick eller ett andra break över breaket). Användaren ser det som feature creep: Breakseq ska göra komplicerade breaks som importeras i en riktig DAW (Reason, Digitakt 2), och där läggs lager. Reverb och delay klarar sig utan spår, med svansen bredvid rösten (fas 21). (Bordlagt 2026-10-17.)

## Rita i exemplet i Mods

Rita värdena direkt i exempelgrafen för en stegeffekt: dra över staplarna så blir effekten en List med ett värde per intervall i dess rate (16, 4 eller 1 över en takt). Kräver en fast skala per mål medan man ritar (pitch −12 till +12 i hela halvtoner, volym −24 till 0 dB, pan ±100 %, reverb och delay 0–100 %, ratchet 1–8, direction F/R). Öppet: om Ramp, Random och Cycle blir en List när man ritar, och om mönster längre än en takt ska gå att rita. (Bordlagt 2026-10-17.)
