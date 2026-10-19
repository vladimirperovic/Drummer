# Drummer

Vježbanje bubnja na električnom bubnju (pravljeno za Roland TD-17KVX, radi sa svakim MIDI bubnjem).

- **Note** gore, sa linijom koja prati sviranje. Tvoji udarci se upisuju na note: zeleno tačno, narandžasto skoro, crveno promašaj ili višak.
- **Metronom** sa odbrojavanjem, klikom na četvrtine/osmine/šesnaestine, tihim taktovima i trenerom tempa.
- **Crtež bubnja** dolje: pad zasvijetli kad dolazi nota, a krug se skuplja prema padu pred udarac.
- **Rezultat**: tačnost po prolazu, po instrumentu da li žuriš ili kasniš, koliko si ujednačen i da li paziš na dinamiku.
- **Ritmovi**: gotovi ritmovi, editor (klik u mrežu), snimanje sa bubnja u ritam, čuvanje, izvoz i uvoz JSON fajlova.
- **Zvuk**: ugrađeni sintetizovani bubanj, kitovi od WAV semplova (`kits/`), ili slanje ritma na EZdrummer preko MIDI-ja.

## Pokretanje

1. Treba ti **Chrome, Edge ili Brave**. Safari i ostali WebKit browseri nemaju MIDI.
2. Poveži TD-17 USB kablom (USB-B na modulu) i upali ga.
3. Dupli klik na `pokreni.command`, ili u terminalu:

```bash
python3 -m http.server 8123 --bind 127.0.0.1
```

pa otvori http://localhost:8123 u Chrome-u i dozvoli MIDI kad browser pita.

Bez bubnja se svira tastaturom: `F`/`J` dobos, `V`/`B`/`N` kik, `D`/`K` hi-hat, `S` otvoren hi-hat, `A` hi-hat nogom,
`G` tom 1, `H` tom 2, `L` floor tom, `E` crash, `I` ride, `O` zvono, `C` cross-stick. `Shift` = akcenat, `Alt` = ghost,
razmak = start/stop, strelice = tempo.

## Sopstveni zvukovi

Kit je folder u `kits/` sa `kit.json` i WAV fajlovima, upisan u `kits/index.json`:

```json
[{ "id": "moj-kit", "name": "Moj kit" }]
```

```json
{
  "name": "Moj kit",
  "license": "CC BY 4.0, autor ...",
  "instruments": {
    "snare": [
      { "file": "snare_tiho.wav", "lo": 1, "hi": 60 },
      { "file": "snare_jako_1.wav", "lo": 61, "hi": 127 },
      { "file": "snare_jako_2.wav", "lo": 61, "hi": 127 }
    ]
  }
}
```

Instrumenti: `kick`, `snare`, `xstick`, `hh`, `hho`, `hhp`, `tom1`, `tom2`, `tom3`, `crash`, `ride`, `bell`.
`lo`/`hi` je raspon jačine udarca (1–127); više fajlova u istom rasponu se smjenjuju.

## EZdrummer i drugi programi

TD-17 šalje udarce istovremeno i Drummer-u i EZdrummeru: EZdrummer svira zvuk, Drummer prikazuje note i ocjenjuje.
Da Drummer pusti ritam kroz EZdrummer: uključi IAC Driver u aplikaciji *Audio MIDI Setup*, u Drummer-u izaberi
taj izlaz u Podešavanjima, a u EZdrummeru IAC kao MIDI ulaz.

## Alati

`alati/midirec.swift` (prevedi sa `swiftc -O alati/midirec.swift -o alati/midirec`) snima MIDI sa modula u fajl, a `alati/analiza.py` iz snimka računa dinamiku po padu,
duple okidače, crosstalk, hi-hat pedalu i tajming. Služi za podešavanje trigera na modulu.
