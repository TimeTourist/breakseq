# Crazy madness (borttagen)

Byggd i fas 27b och borttagen samma dag, 2026-10-23 (Magnus: "Crazy mode funkade inte alls. Det lät jättedåligt. Låt oss reverta det. Men jag vill ha kvar ikonen."). Mod-förvalen från fas 27a blev kvar, och smileysarna blev loggan. Koden finns i git (fas 27b, commits fe5dee0–b1758c2).

Så här stod det i specen:

## Crazy madness

Mottot "Gör kaos lätt" taget till sin spets: slica ett break och få en låt direkt. Allt i det här avsnittet är Magnus beslut (från `docs/rnd/crazy.md`, 2026-10-21–23) om inget annat sägs; *(Claudes val)* markerar det som fylldes i när Rnd:n blev spec.

### Två lägen

- **Total control:** som innan Crazy. Den automatiska kedjan gör en matrix och en loop, inget mer.
- **Crazy madness:** när ett break slicas första gången bygger appen hela vägen till Song efter låtens recept: hit-varianter i matrisen, en main- eller fill-loop, klipp i Song och mods från förvalen.
- **Knappen i headern** visar läget som gäller och byter vid klick. Muspekaren säger läget och vad ett klick gör (Crazy madness. Click for Total control). Ikonerna: Total control är en vanlig glad acid smiley, Crazy madness en acid smiley som ser lurig, ond och galen ut. Skiss: `docs/sketches/crazy-smileys.html`. Knappen sitter först bland headerns knappar till höger, före tempot. *(Placeringen: skissen.)*
- **Crazy är förvalt** i ett nytt projekt, och läget sparas i projektet. Ett gammalt projekt utan läge öppnas i Total control, eftersom det byggts för hand. *(Claudes val.)* Att byta läge är ett kommando som går att ångra, som andra ändringar i projektet. *(Claudes val.)*
- Läget styr bara vad som byggs automatiskt; inga reglage döljs.

### Fire and forget

- Crazy bygger allt som om användaren gjort det själv, med vanliga kommandon i ett enda steg i historiken: en Undo tar bort allt Crazy byggde av ett break. Inget följer med i efterhand, och allt går att ändra som vanligt. Crazy rör aldrig det som redan finns när ett nytt break slicas: det lägger bara till. *(Claudes val: en Undo, och bara lägga till.)*
- **Lägesknappen är den enda knappen för läget**, en toggle: den glada smileyn är Total control, den galna Crazy madness. *(Magnus beslut 2026-10-23; ändras inte utan att fråga.)*
- **🎲 i headern** gör i Total control som förut: bara nya seeds, aldrig något byggt eller ändrat (Reroll everything). **I Crazy madness är 🎲 Go crazy.** *(Magnus beslut 2026-10-23; ändras inte utan att fråga.)*
- **Go crazy:** den nukar allt i sin väg och bygger om med ett nytt recept: alla matriser, loopar, mods och hela Song tas bort, förvalen återställs, och sedan byggs allt igen som om varje slicad trim slicades nu, i samplens ordning, med det nya receptet. Bara samples (med trimmar, slicing och markörer) och egna mods blir kvar. Allt är ett kommando, så Undo tar tillbaka allt. Ingen fråga först: crazy är crazy, och den som vill behålla något gör New snapshot innan den börjar labba. Muspekaren över 🎲 i Crazy madness säger: Go crazy: throw away matrices, loops and the song and build it all again from a new recipe. Samples and your own mods stay. Undo brings it back.
- En trim som inte är slicad (en one-shot) får sin matrix av den automatiska kedjan men ingen loop eller klipp; den kan bli källa till hit-varianter (se receptet). *(Claudes val.)*

### Recept

- Crazy bygger efter låtens recept, som är helt dolt: det ska överraska, man hör bara resultatet. Receptet är en seed i projektet (`recipeSeed`), satt när projektet skapas och ny vid Go crazy. *(Seeden: Claudes val.)*
- Ett recept består av reglerna nedan, och varje regel har två eller tre varianter. Receptet rullas genom att en variant väljs per regel ur receptets seed och regelns namn. Inne i varje variant slumpas det också (vilka pads, vilka takter), ur receptets seed, breakets plats i ordningen och vad som slumpas, så samma projekt bygger samma låt varje gång.
- Tider räknas i takter av 16: låten byggs i avsnitt om 16 takter.
- Ett recept gäller hela låten; om nya breaks följer samma stil eller får en egen är också en regel.
- Varianterna är en fast lista (egna recept: utanför v1).

**Reglerna** *(Claudes val av varianterna; exemplen i Rnd:n är med)*:

| Regel | Varianter |
|---|---|
| Roll | **Varannan:** första breaket blir main, nästa fill, och så vidare. · **Första main:** första breaket blir main, alla senare fill. · **Blandat:** varje break blir main eller fill, hälften var, men första alltid main. |
| Form (var fills ligger i ett avsnitt) | **Korta mains:** main 1–3 takter i taget, en fill-takt emellan, till 16. · **Tre fills:** fill på takt 8, 12 och 16. · **Var 8:e:** fill på takt 8 och 16. |
| Fill-loopen | **Omkastad:** en takt, breakets pads i slumpad ordning på 1/16. · **Slutet:** två slag, breakets sista pads, upprepade. · **Hackad:** en takt där varje steg spelar en slumpad pad ur breaket och en fjärdedel av stegen är tomma. |
| Hit-varianter | **Få:** var fjärde pad får en variant. · **Många:** varje pad får en variant. · **Vilda:** varje pad får två eller tre varianter. Pads med varianter väljer Random. |
| Hit-variantens sort (slås per variant) | **Ändrad:** samma slice med 1–3 av pitch, volym, filter, dist och stretch ändrade upp till 40 %. · **Annan:** en annan slice ur samma break, eller ur ett annat break eller en one-shot i projektet. · **Baklänges:** samma slice baklänges. |
| Mods | **Extrem och subtila:** en extrem mod 1 takt och subtila mods på sammanlagt 4 takter per 16. · **Många små:** en subtil mod på varannan takt. · **En stor:** en extrem mod över 2 takter per 16. |
| Slut | **Mod på slutet:** en extrem mod på låtens sista 2 takter. · **Tape stop:** förvalet Tape stop på sista takten. · **Inget särskilt.** |
| Nya breaks | **Samma stil:** nya breaks följer samma varianter. · **Egen stil:** varje nytt break rullar egna varianter av Fill-loopen, Hit-varianter och sorten, ur sin plats i ordningen. |

**Hur ett break fogas in** *(Claudes val)*:
- **Main:** breakets loop från den automatiska kedjan blir main-loopen, och Song får ett nytt avsnitt om 16 takter sist: main-loopen enligt Form, och i fill-takterna fill-loopen från det senaste fill-breaket (finns inget används en fill-loop av breaket självt, byggd enligt Fill-loopen). Mods och Slut läggs på avsnittet. Slut flyttas inte när ett nytt avsnitt kommer: det blir kvar på det avsnitt där det lades.
- **Fill:** breaket får en fill-loop enligt Fill-loopen (kind fill), och Song får ett nytt avsnitt om 16 takter sist med den senaste main-loopen och den nya fill-loopen i fill-takterna. Finns ingen main än blir breaket main i stället.
- **Mods** läggs i Mod A, och där en mod redan ligger i Mod B. Extrema och subtila förval (se Mod-förval) väljs ur seeden, på hela takter i avsnittet, inte på fill-takterna för subtila. Loopens eget klipp och modklippen får nya seeds som vanligt.

**Byggt i fas 27b** med de här valen *(Claudes val)*:
- **När Crazy bygger:** när en trims egen matrix får sin loop i ett kommando, alltså första gången trimmen slicas: i Samples, när en REX-fil importeras och när New sample from slices gör en slicad sample. En ändring av takter eller markörer bygger inget, och inte heller New sample i dialogen om numrering (matrisen flyttar med sin loop). None och sedan slicing igen gör loopen på nytt och bygger då igen. Byggandet ligger i samma kommando som slicingen (`crazyChain` i `src/model/crazy.ts`), så en Undo tar bort allt; Undo-texten är slicingens (slice amen 1).
- **Breakets plats:** antalet andra slicade breaks (med sin egen loop) när det slicas. De tidigare breakens roller räknas fram ur receptet i samplens ordning. Det senaste fill-breakets fill-loop är en loop taggad fill som bara spelar dess pads; finns ingen sådan längre byggs en fill-loop av breaket självt. Go crazy bygger i samplens ordning.
- **Avsnittet** börjar efter låtens sista klipp, på nästa hela takt, och låten förlängs till avsnittets slut (den kortas aldrig). Main-raden får ett klipp per följd av main-takter, med offset där det ligger i avsnittet, så main håller takten som under en fill. Varje fill-takt är ett klipp på en takt; en fill-loop på två slag spelar två gånger.
- **Form, Korta mains:** varje main slumpas till 1–3 takter, sedan en fill-takt; avsnittet kan sluta på en main.
- **Fill-loopen:** Omkastad upprepar den slumpade ordningen om breaket har färre än 16 pads, och tar de 16 första om det har fler. Slutet är de sista 8 stegen av padsens utläggning, och paden som klingar där de börjar börjar på steg 1. Hackad har exakt 4 tomma steg, och samma pad kan komma flera gånger.
- **Hit-varianter:** Få börjar på en slumpad av de fyra första padsen; tomma pads räknas inte. En variant heter som hitten med "var".
- **Sorten** slås per variant ur breakets plats, paden och variantens nummer; Egen stil ändrar den inte mer. Ändrad: pitch upp till 40 % av en oktav i hela halvtoner (minst en), volym upp till 40 % upp eller ned i nivå, ett lågpass eller högpass upp till 40 % in från sitt öppna läge (logaritmiskt), dist av valfritt slag på upp till 40 %, stretch med en faktor upp till 40 % längre eller kortare. Annan: först en sample (breaket självt, ett annat slicat break eller en one-shot, lika chans), sedan en slice; från en annan sample är den ingen variant längre, som med Replace.
- **Mods:** Extrem och subtila lägger den extrema på vilken takt som helst (också en fill-takt) och de subtila som klipp på 1–2 takter, sammanlagt 4, på lediga takter som inte är fill-takter. Många små börjar på takt 1 eller 2. En stor börjar på vilken takt som helst utom den sista. Förvalet slumpas bland projektets förval av rätt sort. Slut läggs före Mods; ett klipp där både Mod A och Mod B är upptagna läggs inte ut.
- **Go crazy** gör om varje samples egen matrix med sitt vanliga namn, och låten börjar om på 8 takter i samma tempo utan loopområde. Undo säger "Undo: go crazy", och byte av läge "Undo: switch to Crazy madness" eller "switch to Total control".
- Ett gammalt projekt utan recept får en `recipeSeed` räknad ur samplens id:n, så den blir densamma varje gång det laddas.

