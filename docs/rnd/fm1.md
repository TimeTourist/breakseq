# Breakseq på M-VAVE FM-1 (Rnd)

**Inte planerad.** Undersökning av om det går minnesmässigt.

Frågan: kan en samplebaserad break-sequencer (som Breakseq) köras som egen firmware på M-VAVE FM-1? Undersökt 2026-10-21.

Märkning: **Fakta** = står i källan (länk). **Uppskattning** = min räkning eller slutsats. **Okänt** = hittade inget säkert.

## Kort svar

**Går, med gränser.** Minnet räcker för ungefär det Breakseq gör, om ljudet lagras komprimerat (IMA ADPCM, 4 bit) i flash, i mono och gärna i 22–32 kHz. Felucca gör redan nästan exakt detta: en SLICE-motor som spelar uppklippta breaks från flash. Gränsen är **lagringen**, inte processorn. Med originalflashen (1 MiB) får man runt 30–60 s ADPCM-ljud om firmwaren är liten, men bara ~22 s med Feluccas nuvarande uppdelning. Offline-rendering som i webbappen går inte: hela låten får inte plats i RAM. Motorn måste spela i realtid och sända ljudet via USB-ljud till datorn.

## 1. Hårdvaran

**Fakta**

- SoC: JieLi AC791N / WL82, CPU pi32v2 (32 bit). ([AL-255/FM-1-RE](https://github.com/AL-255/FM-1-RE), [zeli.app](https://zeli.app/story/49994065))
- Två kärnor. Felucca kör bara på kärna 0. Kärna 1 är experimentell och har inte körts på en enhet. ([felucca-bsp chip/fm1_cpu1.h](https://github.com/hugelton/felucca-bsp/blob/main/chip/fm1_cpu1.h), [EXPERIMENTAL.md](https://github.com/hugelton/felucca-bsp/blob/main/docs/EXPERIMENTAL.md)) Feluccas 1.6 har en valbar 2ND CORE i menyn. ([BUILDING.md](https://github.com/hugelton/Felucca/blob/main/BUILDING.md))
- Ingen FPU. Felucca skriver sin DSP i fixpunkt "for a CPU without an FPU" ([phys_dsp.c](https://github.com/hugelton/Felucca/blob/main/firmware/src/phys_dsp.c)). Originalfirmwaren innehåller soft-float-rutiner ([architecture.md](https://github.com/AL-255/FM-1-RE/blob/main/docs/architecture.md)).
- Intern SRAM: 512 KiB, 0x01C00000–0x01C80000. Felucca delar upp den i 24 KiB kod i RAM, 8 KiB debug, 72 KiB `.data/.bss`, 360 KiB `POOL` för stora buffertar och ~15 KiB som överlever omstart. ([Felucca app.ld](https://github.com/hugelton/Felucca/blob/main/firmware/app.ld))
- Ingen extern SDRAM/PSRAM på FM-1. Bootloadern sätter "SDRAM-less defaults". ([architecture.md](https://github.com/AL-255/FM-1-RE/blob/main/docs/architecture.md)) En kinesisk jämförelse säger att AC791N kan ha 2/8 MB extern SDRAM ([CSDN](https://gitcode.csdn.net/69e9857554b52172bc6bb671.html)), men inget tyder på att FM-1 har det.
- Flash: 1 MiB SPI-NOR (SOIC-8), XIP-mappad på 0x02000000. ([architecture.md](https://github.com/AL-255/FM-1-RE/blob/main/docs/architecture.md), [EXPERIMENTAL.md](https://github.com/hugelton/felucca-bsp/blob/main/docs/EXPERIMENTAL.md))
- Originalfirmwarens app är 0x8E59C byte (≈ 570 KiB). Resten: config (VM, 340 KiB), användarpatchar (72 KiB) m.m. ([architecture.md](https://github.com/AL-255/FM-1-RE/blob/main/docs/architecture.md))
- Ljud: intern DAC, 44 118 Hz, block om 64 sampel. ([architecture.md](https://github.com/AL-255/FM-1-RE/blob/main/docs/architecture.md))
- USB: komposit, USB-MIDI + UAC1-ljud (24 bit, 2 kanaler). ([architecture.md](https://github.com/AL-255/FM-1-RE/blob/main/docs/architecture.md))

**Oklart: klockan.** RE-dokumentet säger 240 MHz från en 24 MHz-kristall ([architecture.md](https://github.com/AL-255/FM-1-RE/blob/main/docs/architecture.md)). Felucca-BSP säger "the boot loader's 360 MHz" ([CPU.md](https://github.com/hugelton/felucca-bsp/blob/main/docs/CPU.md)) och att SDK:ns max är 320 MHz ([EXPERIMENTAL.md](https://github.com/hugelton/felucca-bsp/blob/main/docs/EXPERIMENTAL.md)). Räkna med 240–360 MHz.

**Fakta: en CPU-bugg.** 64-bitars multiplikationer blandade med 16-bitars läsningar ger ibland fel bitar och krascher. Lösningen är att lägga multiplikationen i en egen `noinline`-funktion. ([CPU.md](https://github.com/hugelton/felucca-bsp/blob/main/docs/CPU.md)) Viktigt för fixpunkt-DSP.

**Fakta: flashen går att byta.** BSP:n har påbörjat stöd för större flash lödd i originalets ställe, men det har inte körts på en enhet. Hur mycket XIP-fönstret mappar är okänt. ([EXPERIMENTAL.md](https://github.com/hugelton/felucca-bsp/blob/main/docs/EXPERIMENTAL.md))

## 2. Vad de alternativa firmwarerna gör med minnet

**Felucca** (hugelton) är det viktiga exemplet. **Fakta:**

- DRUM är syntetiserad, inga sampel. SAMPLE och SLICE spelar sampel. ([wiki Engines](https://github.com/hugelton/Felucca/wiki/Engines))
- SLICE är en break-slicer: inbyggd BREAK (en takt 16-delar i 120 BPM, gjord av Feluccas egna trummor) eller ett eget sampel. Uppdelning i 4/8/16/32 lika delar, AUTO (en slice per anslag) eller MAN. Lägen ONE/GATE/LOOP, baklänges, PITCH som varispeed, DECAY, TONE. ([eng_slice.c](https://github.com/hugelton/Felucca/blob/main/firmware/src/eng_slice.c))
- GRAIN är en granulärmotor över samma sampel (kornlängd 10–390 ms). Den avkodar ADPCM direkt ur flash, utan kopia i RAM. ([eng_grain.c](https://github.com/hugelton/Felucca/blob/main/firmware/src/eng_grain.c))
- Allt ljud lagras som IMA ADPCM (4 bit). Inbyggda sampel i 22 050 Hz. ([gen_samples.py](https://github.com/hugelton/Felucca/blob/main/tools/gen_samples.py))
- Tre användarplatser à 80 KiB på flash 0xA0000–0xDBFFF, alltså 240 KiB totalt. De läses direkt via XIP. ([eng_sample.c](https://github.com/hugelton/Felucca/blob/main/firmware/src/eng_sample.c))
- En plats rymmer 7,4 s i 22,05 kHz ADPCM mono. ([slice_store.c](https://github.com/hugelton/Felucca/blob/main/firmware/src/slice_store.c))
- Sampel laddas upp från webbeditorn över USB-MIDI (sysex, 7-bitars packning). ([editor.c](https://github.com/hugelton/Felucca/blob/main/firmware/src/editor.c), [wiki Features](https://github.com/hugelton/Felucca/wiki/Features))
- Flashkarta: projekt 0x97000–0x9EFFF, sampel 0xA0000–0xDBFFF, presets 0xDC000–0xDFFFF, OTA 0xE0000–0xE4FFF, autosave, FM6-bank, inställningar 0xFC000. "Every free sector of the map is taken." ([storage.c](https://github.com/hugelton/Felucca/blob/main/firmware/src/storage.c), [slice_store.c](https://github.com/hugelton/Felucca/blob/main/firmware/src/slice_store.c))
- Delay-bufferten är 65 536 sampel int16 = 128 KiB, 1,49 s mono. ([fx.c](https://github.com/hugelton/Felucca/blob/main/firmware/src/fx.c))
- Sequencern: 4 spår, 64 steg, 8 röster delade, chance, ratchets, conditions, song med 16 sektioner, 4 projekt. ([wiki Features](https://github.com/hugelton/Felucca/wiki/Features))
- Webbemulatorn emulerar inte användarplatserna. ([BUILDING.md](https://github.com/hugelton/Felucca/blob/main/BUILDING.md))

**FiMba-1** (jadamsowers): fysisk modellering, inga sampel. Spelar in 1,1 s torrt ljud i RAM som kornmotorn klipper ur. Delay upp till 740 ms. ([fm1-fimba](https://github.com/jadamsowers/fm1-fimba))

**DUELL** (oscillr): syntmotorer (bl.a. FM6 från Dexed, PHYS från DaisySP/Rings). Inga sampel nämns. ([DUELL](https://github.com/oscillr/DUELL))

Melodee, FoMni, JIANT FM och BaudGirl's VA: inte undersökta i detalj.

## 3. Hur ljud kommer in

- **USB-ljud går bara ut.** **Fakta:** Felucca beskriver USB-ljudet som en stereoingång på datorn, 44,1 eller 48 kHz, som spelar in FM-1:ans masterutgång. ([wiki Features](https://github.com/hugelton/Felucca/wiki/Features), [BUILDING.md](https://github.com/hugelton/Felucca/blob/main/BUILDING.md)) **Okänt:** om UAC1-kretsen klarar ljud från dator till enhet. Inget tyder på det.
- **3,5 mm:** en utgång. Ingen ljudingång hittad. ([syskb.com](https://syskb.com/m-vave-fm1-sampler-daw/))
- **Filer:** ingen masslagring. Sampel kommer in som sysex över USB-MIDI (Feluccas webbeditor). Hastigheten är **okänd**.
- **Bra nyhet för Breakseq:** USB-ljud ut passar produkten. Breakseq gör breaks för en riktig DAW. FM-1 kan spela låten och DAW:en spelar in den.

## 4. Återställning och risk

**Fakta**

- Flashen har en bank. Ingen ROM-återställning, ingen rollback och inget säkert avbrutet skrivande är bevisat. ([FM-1-RE](https://github.com/AL-255/FM-1-RE), [TODO_aug2.md](https://github.com/AL-255/FM-1-RE/blob/main/TODO_aug2.md))
- Felucca: installeraren har "Return to official V15". Om en installation misslyckas och enheten inte startar krävs FM-1-transporter. ([Felucca](https://github.com/hugelton/Felucca), [BUILDING.md](https://github.com/hugelton/Felucca/blob/main/BUILDING.md))
- FiMba-1: första 16 KiB (chipets bootkod och update-läge) skrivs aldrig. Efter 2 misslyckade starter: säkert läge med USB. Efter 4: chipets eget update-läge. Originalet V15 återställs via webben eller `tools/fm1_rescue.py`. ([fm1-fimba](https://github.com/jadamsowers/fm1-fimba))
- DUELL: återgång till V15 "has worked on that unit about three times", bara på upphovspersonens enhet. ([DUELL](https://github.com/oscillr/DUELL))
- Vissa enheter läser flash och SRAM fel vid bootloaderns spänning under last. M-VAVE höjer spänningen vid start. ([fm1_sys.h](https://github.com/hugelton/felucca-bsp/blob/main/chip/fm1_sys.h))

**Uppskattning: vad som brickar.** Strömavbrott mitt i skrivning, att skriva över de första 16 KiB, eller firmware som kraschar innan USB kommer upp och saknar säkert läge. Ladda ner M-VAVEs V15 "PC Firmware" innan något installeras.

## 5. Räkning: hur mycket ljud får plats

**Uppskattning.** Fyra kapaciteter:

- **RAM 256 KiB:** rimlig del av de 512 KiB om kod, stackar, UI och effekter också ska få plats.
- **Felucca-platserna 240 KiB:** dagens 3 × 80 KiB.
- **Flash ~700 KiB:** om en egen, liten firmware (~150–250 KiB kod) tar hela flashen.
- **Flash 16 MiB:** om flashkretsen byts (ej bevisat).

Sekunder ljud:

| Format | RAM 256 KiB | Felucca 240 KiB | Flash ~700 KiB | Flash 16 MiB |
|---|---|---|---|---|
| 44,1 kHz 16 bit stereo | 1,5 | 1,4 | 4,1 | 95 |
| 44,1 kHz 16 bit mono | 3,0 | 2,8 | 8,1 | 190 |
| 32 kHz 16 bit mono | 4,1 | 3,8 | 11,2 | 262 |
| 22,05 kHz 16 bit mono | 5,9 | 5,6 | 16,3 | 380 |
| 44,1 kHz 8 bit mono | 5,9 | 5,6 | 16,3 | 380 |
| 22,05 kHz 8 bit mono | 11,9 | 11,1 | 32,5 | 761 |
| 44,1 kHz ADPCM mono | 11,9 | 11,1 | 32,5 | 761 |
| 32 kHz ADPCM mono | 16,4 | 15,4 | 44,8 | 1049 |
| 22,05 kHz ADPCM mono | 23,8 | 22,3 | 65,0 | 1522 |
| 22,05 kHz ADPCM stereo | 11,9 | 11,1 | 32,5 | 761 |

Kontroll: 80 KiB / 11 025 B/s = 7,4 s, samma som Felucca anger.

Jämfört med Breakseq:

- Amen ≈ 7 s. En session är 1–5 breaks plus one-shots, 10–40 s.
- **Originalflash, egen firmware, 22–32 kHz ADPCM mono: 45–65 s.** Räcker för en hel session.
- **44,1 kHz ADPCM mono: ~32 s.** Räcker för 3–4 breaks.
- **Felucca-platserna: ~22 s, max 7,4 s per plats.** Ett Amen per plats, tre breaks.
- **16 bit okomprimerat:** 8–16 s. Ett eller två breaks.
- **Stereo:** halverar allt. Många breaks är mono ändå.
- **Offline-rendering som i webbappen går inte.** 1 s färdig stereo 44,1 kHz 16 bit = 172 KiB. En takt i 170 BPM (1,4 s) fyller nästan hela RAM. Motorn måste spela i realtid.

### Effekter: RAM

**Uppskattning,** mono int16 i 44,1 kHz (88 KiB per sekund):

- **Delay:** 1,49 s = 128 KiB (Feluccas mått). En halv sekund räcker för 1/8 i 170 BPM: ~44 KiB. Kan köras i halv takt för att halvera.
- **Reverb:** Feluccas HALL är 8 linjer à 21–34 ms i halv takt. Det blir runt 10–20 KiB. Billigt.
- **Filter, dist, volym, pitch (varispeed):** nästan inget RAM.
- **Tape stop, stutter, scramble:** kan göras som händelser (läs om sampelt ur flash med ny position eller hastighet). Då kostar de inget RAM. Stutter på hela mixen kräver en buffert: en takt i 170 BPM = ~124 KiB.
- **Time-stretch med korn:** som Feluccas GRAIN, direkt ur flash. Bara ett litet sökindex (~2 KiB per sampel) och kornens tillstånd.
- Summa med delay 0,5 s + reverb + stretch: runt 70–100 KiB. Ryms i Feluccas 360 KiB pool med god marginal.

### Effekter: CPU

**Uppskattning.** Vid 240–360 MHz finns 5 400–8 200 cykler per sampel i 44,1 kHz på en kärna.

- ADPCM-avkodning: några tiotal cykler per sampel och röst. 16 röster < 10 % CPU.
- Kornstretch: ~2–4 avkodningar per sampel och röst (Felucca anger ~2 för baklänges korn). Ryms.
- Reverb + delay + filter i fixpunkt: Felucca kör redan FM6 + 8 röster + chorus/delay/reverb på en kärna.
- **Slutsats:** CPU är inte flaskhalsen. Andra kärnan behövs inte.

## 6. Bedömning

**Går, med gränser:**

- Ljudet ligger i flash som IMA ADPCM, inte i RAM.
- Mono. 22–32 kHz för 45–65 s, eller 44,1 kHz för ~32 s.
- Realtidsmotor, inte offline-rendering. Export = USB-ljud in i DAW:en.
- Ingen sampling på enheten. Sampel laddas upp som sysex från datorn (en webbsida, som Feluccas editor).
- Liten skärm och få knappar. UI:t blir mycket enklare än webbappen.
- Breakseqs `generate` måste skrivas om i C (fixpunkt, utan FPU). `render` ersätts av en realtidsmotor.
- **Genväg:** Felucca har redan SLICE, GRAIN, sequencer, song och effekter. En fork eller ett bidrag till Felucca (GPL-3.0) är troligen mycket mindre jobb än egen firmware.

**Verifiera först, i denna ordning:**

1. I webbemulatorn ([Felucca try](https://hugelton.github.io/Felucca/webapp/try/), [Synthtopia om emulatorn](https://www.synthtopia.com/?p=155292)): kör SLICE med BREAK i 170 BPM, ratchets och reverb/delay. Kolla CPU-mätaren. Obs: användarplatser emuleras inte.
2. Bygg Felucca och mät hur stor en firmware utan FM6, PHYS m.fl. blir. Det avgör hur mycket flash som blir över för sampel.
3. Mät hur lång tid en sysex-uppladdning av 80 KiB tar på riktig enhet.
4. Bekräfta klockan (240 eller 360 MHz) med BSP:ns mätloop.
5. Innan något flashas: spara V15, testa återgången till V15 och rescue-vägen på egen enhet.

**Okänt:** USB-ljud från dator till enhet, sysex-hastighet, klockan, om större flash fungerar via XIP, Melodee/FoMni/JIANT/BaudGirl's minnesanvändning.
