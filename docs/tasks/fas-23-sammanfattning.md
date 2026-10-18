# Fas 23 – Gränssnitt för matriser: sammanfattning

## Gjort

- **Flikarna** heter Samples, Pads, Loops, Mods, Song och Project, på tangenterna 1–6. Samples ersätter Import och Slice, och Pads ersätter Hits. `HitsView`, `ImportView` och `SliceView` är borttagna. Tangenterna, mellanslag och Ctrl+Z fungerar också när en kryssruta, en radioknapp eller ett reglage har fokus (`src/ui/isTyping.ts`).
- **Fokus och Take from** ligger i store som vyns val (`focus: { matrix, takeFrom }`), inte i projektet, och går inte att ångra. En borttagen eller bortångrad matrix lämnar fokus och Take from.
- **Samples** (`SamplesView.tsx`, `SliceEditor.tsx`) har filtabellen överst och den valda trimmens vågform och slicing under, på samma sida. Trimmens ▶ är Play i headern. Länkarna Pads → sätter trimmens matrix i fokus och öppnar Pads. Make one-shot heter New matrix from slice.
- **Pads** (`PadsView.tsx`, `FocusBar.tsx`, `Timeline.tsx`, `ControlsPanel.tsx`, `TakeFromShelf.tsx`, `pads.ts`):
  - Fokusraden har Focus, Take from, + New matrix och ▶.
  - Matrisens rad har namnet, ← Samples, + Pad, Clone och Delete matrix.
  - Tidslinjen visar padsen efter varandra, lika breda som de spelar, med sina hits nedåt. Zoom är Fit eller 1 bar.
  - Reglagen under tidslinjen gäller den valda hitten, paden eller matrisen. En pad flyttas med ← och →.
  - Hyllan Take from visar matriserna man tar från.
  - Drag lägger till, ersätter (`replaceHit`) eller flyttar inom en pad. Tidslinjen, hyllan och sidan scrollar under draget.
  - Med finger eller penna trycker man på en hit och sedan på en pad eller en hit.
  - Tangenterna ←/→/↑/↓ stegar och spelar, Enter väljer matrisen och Delete frågar.
- **+ New matrix** (`NewMatrixDialog.tsx`) har ett namn och en lista över one-shots med kryssruta och ▶. Create kör `createMatrixFrom` och sätter den nya matrisen i fokus.
- **Loops** har samma fokusrad som Pads. Hyllan visar matrisen i fokus och de man tar från. Listan Show in Pads är borta.
- **Modellen (M1–M5):**
  - Matrisens egen loop följer alla ändringar av matrisen så länge den är orörd (`following` i `src/model/chain.ts`).
  - Pads heter efter sin rad.
  - En REX-fils matrix heter utan `.rx2`.
  - En MIDI-bit är ett unikt ljud, inte en hit.
  - `variantOf` nollställs när samplet byts eller originalet tas bort.
  - De nya kommandona är `replaceHit` och `createMatrixFrom` (`src/model/commands.ts`).
- **Checklistan U1–U20** i `fas-23-sortering.md` är avbockad utom U9, som är gjord för Pads, hyllorna och fokusraden men inte för listorna i Mods och Loops. Ångra-texterna säger vad som hände (`describeChange.ts`). Körfälten i Song har etiketter. New snapshot ser avstängd ut när den är det. Mods utan mod har inget att spela. Renumber-dialogen namnger pads efter matris och rad.
- **Specen** har nya Pipeline och vyer (Samples, Pads, Loops), Uppspelning och fasraden 23. Den har också Drag ger kopior med ersätta, den automatiska kedjan, padnamnen och MIDI-bitarna. CLAUDE.md säger fas 23.

## Klart när

1. **Amen importeras och slicas i Samples utan att byta flik.**
   - `importing and slicing Amen happens in one tab` (`src/ui/samples.test.tsx`).
   - I Chromium (Task 9) gav Bars 4 och 1/16 64 slices, med ångra-texten "slice Amen-break 1".
2. **I Pads ligger amen 1 i fokus som en tidslinje, och one-shots ligger framme under Take from. En snare dras till pad 07 och blir en kopia där, och en hit som släpps på sista padens hit ersätter den.**
   - `pads lay out by their length with their hits downwards` och `shows each matrix taken from with all hits and its hits` (`src/ui/PadsView.test.tsx`).
   - `dropping on a pad adds copies last` och `dropping on a hit replaces it` (`src/ui/PadsView.test.tsx`).
   - `replacing a hit puts the copy in its place and keeps step locks on it` och `replacing the first hit changes the pad's length and moves the pads after it` (`src/model/pads.test.ts`).
   - I Chromium gav ett riktigt drag av snare_02 1 till pad 07 en kopia, och snare_03 1 på pad 64:s hit gav "replace hit". I `samples/` finns inga Kicks eller Fx, så hyllan var Snares och två one-shots.
3. **En ny matrix *Snares* kan byggas med + New matrix och kryssrutor, där varje ljud hörs vid ett klick.**
   - `new matrix from ticked one-shots`, `a click plays a one-shot in the list` och `the new matrix gets focus` (`src/ui/new-matrix.test.tsx`).
   - `a new matrix from four hits is one pad of four copies on Round robin` (`src/model/pads.test.ts`).
   - I Chromium gav det ångra-texten "new matrix Snares".
4. **Hela flödet går att göra med tangentbordet och på en mobil.**
   - `arrow keys move the selection and play`, `a step onto a pad plays it as it picks` och `Delete asks as the Delete button does` (`src/ui/PadsView.test.tsx`).
   - `tap a hit then a pad adds it` och `tap a hit then a hit replaces it; all hits then a pad adds them all` (`src/ui/PadsView.test.tsx`).
   - `the tabs are Samples, Pads, Loops, Mods, Song, Project on keys 1–6` och `keys work when a checkbox or slider has focus` (`src/ui/App.test.tsx`).
   - I Chromium på 400 px gav ett tryck på en hit och sedan på pad 11 en kopia. Sidan scrollade inte i sidled.
5. **Loops hylla visar bara matrisen i fokus och de man tar från.**
   - `the shelf shows the focus and take from` och `changing focus in Loops changes it in Pads` (`src/ui/shelf-choice.test.tsx`).
6. **Ingen text i gränssnittet använder break eller one-shot som namn på ett objekt, bara som klassificering.**
   - `New matrix from slice makes a matrix of the slice, opened in Pads with focus` (`src/ui/samples.test.tsx`).
   - I Chromium lästes texten i alla sex flikar igenom, även title och aria-label. Orden finns bara i ikonerna, i etiketten på matrisens rad och i dialogtexten "Tick the one-shots to start with" (beslut 6).
   - Inget enskilt test går igenom all text.
7. **Testerna går igenom, typecheck och lint är gröna, drag och släpp är provat i en riktig webbläsare, och det finns en sammanfattning.**
   - 626 tester i 68 filer passerar (efter slutgranskningen), och `npm run typecheck` och `npm run lint` är gröna.
   - Drag är provat med Playwright i Chromium i Task 6 och Task 9: kopia, ersätt, flytta till första plats och autoscroll. Skärmbilderna finns i `.playwright-mcp/fas23-*.png`.

## TODO(spec)

Inga (`grep -rn "TODO(spec)" src` ger inget).

## Vad som bör granskas

### Controllerns beslut

Det här är beslut som togs under bygget, inte av dig. Varje punkt säger vad det kostar om beslutet är fel.

- **Medan Play spelar i Pads ändrar valet inte vad som spelar.** Ett klick på en hit hörs ovanpå, en gång, och groovet spelar vidare. Först när man stoppat spelar Play det som är valt.
  - *Om det är fel:* den som väntar sig att Play följer valet direkt måste stoppa och starta igen för att höra en annan pad eller hit i loop.
- **Ett klick på en hit i hyllan väljer den bara med finger eller penna.** Med mus spelas den bara.
  - *Om det är fel:* på en dator kan man inte klicka på en hit och sedan på en pad. Man måste dra.
- **En pad på Top byter till Round robin när den får sin andra hit.** Det kom från ett tidigt utkast och var inte ditt beslut.
  - *Om det är fel:* att släppa en snare på Amens pad 07 ändrar hur paden spelar. Den växlar mellan slicen och snaren i stället för att alltid spela slicen.
- **En hit som släpps på tom yta i sin egen pad flyttas sist.**
  - *Om det är fel:* den som vill ha en kopia i samma pad måste dra från en annan pad eller använda Variant.
- **I Loops försvann klick och dubbelklick på enskilda hits** när listan Show in Pads togs bort. Hyllan har kvar klick och dubbelklick på pads och matriser.
  - *Om det är fel:* för att höra eller öppna en enskild hit måste man gå till Pads.
- **Ett klick på en slice i Samples stoppar Play i headern** (en sak spelar i taget).
  - *Om det är fel:* den som slicar medan matrisen loopar och klickar på slices för att höra dem får loopen stoppad vid varje klick. Ändringen är en rad i `SliceEditor.tsx`.
- **Trimmens Loop/Once-knapp försvann.** Trimmens ▶ är Play i headern och loopar alltid. Ändringar av trimmen hörs först när loopen börjar om, vilket kan dröja upp till ~7 s.
  - *Om det är fel:* trimma på gehör går långsammare, och man kan inte spela trimmen en gång.
- **Matrisens automatiska loop är alltid hela takter** (ändrat i slutgranskningen; det tidigare beslutet att den kunde bli till exempel 20 steg gäller inte längre). Blir matrisen längre avrundas loopen uppåt till hela takter, högst 16 takter, och pads efter slutet kommer inte med.
  - *Om det är fel:* en loop som växer med ett steg får en hel takt tystnad på slutet, och en matrix som är längre än 16 takter hörs inte till slut i sin egen loop.
- **Select räknas som skrivande.** Siffror och mellanslag går till listan, inte till flikar eller Play.
  - *Om det är fel:* med en lista i fokus byter 1–6 inte flik och mellanslag startar inte Play.

### Öppet och uppskjutet

- **Tangenterna i Pads följer nu elementet som har fokus** (rättat i slutgranskningen). Tabbar man till pad 06 och trycker →, går man från 06, och fokus flyttar med till pad 07.
- **Ångra-texterna räknas fram ur skillnaden** mellan före och efter, inte ur kommandot. Ovanliga fall faller tillbaka på den allmänna texten ("change sample …"), och Clone heter "new matrix amen 1 copy".
- **Mods med en mod men ingen loop spelar låten.** Det är öppet med flit: specen säger bara att Mods utan mod inte har något att spela, och vad som ska spelas med en mod men utan loop är ditt beslut.
- **Hyllans pekare** (finger eller mus) nollställs inte efter ett drag med finger. Det märks bara om man blandar finger och tangentbord.
- **All hits på en hit lägger till i den paden.** En hit kan inte ersättas av många.
- **Ett val används en gång.** Efter ett tryck på en pad måste man trycka på hitten i hyllan igen.
- **Det finns inget sätt att spela en matrix eller en pad en gång** i Pads. Play spelar dem i loop, och ett klick på en pad väljer den utan att spela den.
- **U9 är delvis gjord:** Mods-listan och Loops-listan kortar och bryter namn som förut.

### Där det byggda går utöver eller skiljer sig från designen

- **Följandet av loopen gäller fler kommandon** än de som listades i M1. Det gäller också hit-, pad- och matrisconfig, tempot och trimningen, eftersom de kan ändra en one-shots längd i en matrix.
- **Pad 01 i en one-shot** heter som matrisen (amen 1), utan nummer, och döps inte om.
- **Pads i Fit:** en kolumn som är för smal för hitsens namn visar bara numret och vågformen. Hitsen syns i 1 bar eller när paden är vald. En hög pad i 1 bar (14 hits) skjuter hyllan under skärmkanten. Sidan scrollar under draget, så det går att nå.
- **En pad i Pads spelar i loop** och väljer på nytt varje varv. När tangenterna stegar till en pad spelar de den en gång, som den väljer.
- **Specen beskriver ▶ i Pads fokusrad** som samma knapp som Play i headern. Den gamla Loop-knappen i Hits finns inte.
- **New trim från Bars 4 → 2** flyttar Amen-break 1 till den nya trimmen med 32 slices, men matrisen behåller 64 pads, och 33–64 blir tysta. Det är modellen från fas 22, men det såg förvånande ut i webbläsaren.
- **Trim ▶ är avstängd** tills trimmens egen rendering är klar, så att den inte startar det som visades förut.
- **Dialogen New trim / Renumber ger ingen knapp fokus,** så Enter i Bars öppnar den utan att välja något i den (U1).

## Efter slutgranskningen

Det här rättades efter granskningen av hela grenen, i commiten "Fas 23: final review fixes".

- **Matrisen i fokus är inte en man tar från.** Om man tog från Snares och sedan satte Snares i fokus syntes Snares på hyllan i Pads utan någon knapp att stänga av den, och två gånger på hyllan i Loops. Nu syns den inte där så länge den är i fokus. Den ligger kvar i Take from och kommer tillbaka när fokus flyttas.
- **Andra matrisers loopar följer en trim de spelar.** Om amen 1 hade en kopia av en pad från trim 2 följde amen 1:s loop inte med när trim 2:s markörer, takter eller grid ändrades, eller när trim 2 slutade vara slicad. Då slutade loopen följa för gott. Nu följer alla matrisers egna loopar med.
- **Tangenterna går till dialogen när en dialog är öppen.** I + New matrix startade mellanslag på en kryssruta Play i stället för att kryssa i den, siffror bytte flik och Ctrl+Z ångrade under dialogen. Nu gör appens tangenter ingenting så länge en dialog är öppen, och Escape stänger dialogen. I Chromium kryssar mellanslag i rutan.
- **Den automatiska loopen är hela takter**, som mest 16 takter. En matrix som tar 67 steg får en loop på 80 steg.
- **Tangenterna i Pads stegar från knappen som har fokus**, och fokus flyttar med till det nya valet. Tidslinjen är ett enda tabbstopp: det valda, eller första paden.
- **Efter en ersättning är kopian vald**, inte hitten som togs bort, så reglagen och Play stannar på en hit.
- **Gamla texter:** Loops länkar "← Samples" i stället för "← Slice", och kommentarerna säger Pads och Samples i stället för Hits, Import och Slice. Trimmens ▶ säger "Rendering…" när man håller musen över den medan den är avstängd.
- **Matrisens namn i Pads** ger inget fel medan man har tömt fältet. Felet kommer först när man lämnar fältet eller trycker Enter, och då står det gamla namnet kvar.
- **Specen** säger att flikarna bytte namn i fas 23, och beskriver allt ovan.

