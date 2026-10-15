# Fas 7 – sammanfattning

En mod kan nu ha flera effekter. Den nya effekten Tape spelar in en bit av det som hörs och spelar upp den som ett band som bromsas in eller snabbas upp, framåt, baklänges eller i pendel.

## Gjort

- **Model:**
  - `Mod = { id, name, effects }`, där en effekt är en `StepEffect` (de gamla fälten) eller en `TapeEffect { length, direction, speed }`.
  - Kommandona `createMod(name, effects)`, `renameMod`, `addEffect`, `replaceEffect` och `removeEffect`. En mod har minst en effekt och högst en per mål.
  - Ett klipp av en mod med Tape är minst så långt som segmentet, i alla klippkommandon.
  - En äldre mod uppgraderas till en mod med en enda effekt.
  - `moveSteps` flyttar eller kopierar ett block av steg.
- **Engine:**
  - Stegeffekter verkar effekt för effekt, och A och B kombineras per mål som förut.
  - `generateTake` ger triggers och tapes. Triggers under en tape tas bort, och tapen bär det som hördes i segmentet, med stegeffekterna men utan Tape.
  - `tapePasses` räknar ut varven ur en linjär hastighet, eftersom positionen är integralen av den. Vid 0× nås inget nytt varv.
  - Har både A och B Tape samtidigt vinner B.
- **Render:**
  - Segmentet renderas offline, och en baklänges kopia görs.
  - Varje varv spelas med en `playbackRate`-ramp, så tonhöjd och längd följer hastigheten.
  - Under 1× sänks också volymen i takt med hastigheten, som på ett band. Annars håller en stoppad buffer kvar sitt sista sampel (DC) i stället för att bli tyst. Det är nu skrivet i specen.
  - Tapen klipper rösten före sig och tonar ut vid klippets slut.
- **UI:**
  - Mods visar effekterna som en rad. Med "+ Effect" läggs en effekt till, "Remove" tar bort en, och Randomize gäller den valda stegeffekten.
  - Tape-editorn har Repeat (bars, beats, 1/16), Direction och Speed från → till.
  - Omfånget Pad visar inte föräldra-pads.
  - Mod-klipp i Song visar sina effekter, t.ex. "tape 2/16".
- **Utanför uppdraget, på Magnus begäran mitt i fasen:**
  - Flerval i Loops: Shift-klick väljer ett block, ett drag flyttar det (Alt kopierar), och Delete eller "Clear n steps" tömmer det.
  - Song-banorna har ingen etikett längre. De är färgtonade i stället, så den horisontella scrollen är borta.

## Verifierat

- Det finns 176 tester, och typecheck och lint är gröna.
- Render-tester körs i både Node och Chrome. Där kontrollerades att 1× framåt upprepar segmentet sampel för sampel, att pendel spelar varannat varv exakt baklänges och att 1× → 0× tystnar.
- I webbläsaren skapades en Tape-mod via GUI:t och drogs till Mod A. Där fick den längden 1 takt och etiketten "tape 2/16", och den spelades utan fel.
- Flervalet testades med en riktig drag: blocket 5–7, greppat i steg 6, hamnade på 9–11, och ångra fungerade.

## Att granska

- Hur bromsen låter: om volymen ska följa hastigheten linjärt eller brantare.
- "Try on" i Mods lägger moden över hela loopen. Är Tape längre än loopen blir resten av inspelningen tyst.
- Det finns inga `TODO(spec)`.
