# Drummer

[English guide](README.en.md)

Vježbanje bubnja na električnom bubnju (pravljeno za Roland TD-17KVX, radi sa svakim MIDI bubnjem).

- **Note** gore, sa linijom koja prati sviranje. Tvoji udarci se upisuju na note: zeleno tačno, narandžasto skoro, crveno promašaj ili višak.
- **Metronom** sa odbrojavanjem, klikom na četvrtine/osmine/šesnaestine, tihim taktovima i trenerom tempa.
- **Crtež bubnja** dolje: izbor 2D/3D, sa obojenim udarcima iste veličine. Crni krugovi na bubnjevima menjaju boju, a činele zasvetle celom površinom.
- **Rezultat**: tačnost po prolazu, po instrumentu da li žuriš ili kasniš, koliko si ujednačen i da li paziš na dinamiku.
- **Ritmovi**: gotovi ritmovi, editor (klik u mrežu), snimanje sa bubnja u ritam, čuvanje, izvoz i uvoz JSON fajlova.
- **Zvuk**: ugrađeni sintetizovani bubanj, kitovi od WAV semplova (`kits/`), ili slanje ritma na EZdrummer preko MIDI-ja.
- **Vežbanje**: dnevnik napretka, fokus na taktove A–B i instrumente, audio podloga, sačuvani programi i replay originalnog izvođenja sa MIDI izvozom.
- **Nove mogućnosti**: MIDI uvoz, swing i mere /8, profili uređaja, offline aplikacija i štampa/PDF.

Izbor **SR / EN** je gore desno. Menja ceo interfejs, poruke, pomoć, nazive ugrađenih ritmova i štampu, bez ponovnog učitavanja. Izbor se pamti u browseru. Sopstveni nazivi i sadržaj ritmova ostaju tvoji.

## Pokretanje

1. Treba ti **Chrome, Edge ili Brave**. Safari i ostali WebKit browseri nemaju MIDI.
2. Poveži TD-17 USB kablom (USB-B na modulu) i upali ga.
3. Na macOS-u dupli klik na `pokreni.command`, ili u terminalu:

```bash
python3 -m http.server 8123 --bind 127.0.0.1
```

Na Windowsu, iz foldera projekta u PowerShell-u:

```powershell
python -m http.server 8123 --bind 127.0.0.1
```

Otvori http://127.0.0.1:8123 u browseru i dozvoli MIDI kad browser pita. Koristi istu adresu i port: lokalno sačuvani podaci pripadaju toj adresi i browser profilu.

Bez bubnja se svira tastaturom: `F`/`J` dobos, `V`/`B`/`N` kik, `D`/`K` hi-hat, `S` otvoren hi-hat, `A` hi-hat nogom,
`G` tom 1, `H` tom 2, `L` floor tom, `E` crash, `U` crash 2, `I` ride, `O` zvono, `C` cross-stick. `Shift` = akcenat, `Alt` = ghost,
razmak = start/stop, strelice = tempo.

## Vežbanje

Otvori karticu **Vežbanje** ispod nota:

- **Fokus**: uključi A–B, izaberi prvi i poslednji takt i instrumente za ocenjivanje. Dugmad Svi/Ruke/Noge ubrzavaju izbor. Ostali udarci se čuju i snimaju, ali ne umanjuju ocenu. „Predloži iz poslednje sesije” bira problematičan takt/instrument i smanjuje tempo za 10 BPM. Za ponavljanje uključi Ponavljaj.
- **Dnevnik**: sesija se čuva posle Stop ili automatskog završetka. Vidi trajanje, tempo, tačnost, tajming i dinamiku po instrumentu, graf po danima i promenu u odnosu na prethodnu uporedivu sesiju. Najbolji BPM računa se iz završenih prolaza sa najmanje 90% tačnosti, za isti ritam, fokus i strogost.
- **Pesma**: izaberi lokalni audio fajl, unesi njegov originalni BPM i vreme prvog takta. Klik na waveform takođe postavlja prvi takt. A–B bira odgovarajući deo fajla; Start sinhronizuje pesmu i metronom posle odbrojavanja. Brzine su 50%, 75%, 100% i 125%, unutar 30–260 BPM. Promena brzine menja i visinu tona. Audio fajl ostaje u memoriji i ponovo se bira posle osvežavanja stranice.
- **Programi**: dodaj trenutni ritam i fokus, zadaj trajanje u sekundama, BPM, cilj tačnosti i pauzu. Možeš promeniti redosled i sačuvati program. Jedno pokretanje izvršava sve stavke i zapisuje svaku u dnevnik. Program čuva svoje kopije ritmova. Odbrojavanje i završni prozor za kasne udarce dodaju se navedenom trajanju.
- **Replay**: izaberi sesiju, uspori slušanje, pauziraj i pomeraj poziciju. Graf poredi očekivane i stvarne udarce, uključujući promašaje; možeš prikazati pojedinačni prolaz. JSON čuva originalna vremena sa decimalama, velocity i MIDI note. Standardni MIDI fajl čuva iste udarce sa preciznošću 1 ms, na kanalu 10. Replay koristi trenutno izabrani zvuk bubnja; ne snima audio podlogu.

Dnevnik i programi čuvaju se lokalno u browseru. Ako čuvanje ne uspe, upozorenje ostaje vidljivo i nudi izvoz svih podataka i ponovni pokušaj. Redovno izvozi dnevnik i ritmove; brisanje browser podataka briše lokalne zapise. Izvoz sesija služi kao arhiva i za dalju analizu; uvoz dnevnika/programa još nije deo interfejsa.

## MIDI uvoz, swing i profili

- **Alati → MIDI uvoz**: izaberi `.mid`, traku, kanal (bubnjevi su najčešće na 10), početak u četvrtinama i 1–8 taktova. Proveri meru, kvantizaciju i mapu MIDI nota. Pregled pokazuje uvezene, preskočene i spojene udarce. Uvezi u editor i sačuvaj ritam. Možeš koristiti mapu aktivnog uređaja. Podržani su MIDI tipovi 0/1 sa PPQ vremenom, do 10 MB; SMPTE i tip 2 nisu podržani. Promene tempa se svode na početni tempo izabranog dela uz upozorenje. Deo sa promenom mere treba skratiti ili pomeriti.
- **Uredi ritam**: uz broj doba izaberi jedinicu **/4** ili **/8**, npr. 6/8 ili 7/8. Grupe `3+3` ili `2+2+3` određuju akcente metronoma. Zbir grupa mora odgovarati broju doba. BPM uvek označava četvrtinu; 7/8 na 120 BPM traje 1,75 s. Swing je 50–75%: 50% ravno, oko 67% odnos 2:1. U /4 pomera par osmina, u /8 par šesnaestina. Triole imaju fiksnu podelu i isključen swing.
- **Podešavanja → Profili uređaja**: podesi MIDI mapu, kalibraciju, velocity krivu i pojačanje, zatim sačuvaj profil. Možeš ga povezati sa nazivom MIDI uređaja; dugme „Profil za povezani uređaj” bira odgovarajući sačuvani profil. Promene primeni čuvanjem profila. Linearna kriva ostavlja jačinu, meka olakšava jake udarce, tvrda daje više prostora tihim udarcima. Snimak i MIDI izvoz čuvaju originalnu velocity; živi zvuk i ocena koriste podešenu krivu.

## Ritmovi, raspored i 3D bubanj

Klikni **☆** uz gotovi ili sačuvani ritam da ga dodaš u **Favorite**; ponovni klik na **★** ga uklanja. Dugme **Favoriti** filtrira obe liste i prikazuje ukupan broj omiljenih. Favoriti i izbor filtera pamte se lokalno, i rade offline. Kategorija i pretraga dodatno filtriraju gotove ritmove. Svaka lista prikazuje **12 ritmova po stranici**, sa dugmadima **Prethodna / Sledeća**, brojem stranice i rasponom rezultata. Promena filtera vraća prvu stranicu; kraće liste ne prikazuju paginaciju.

Biblioteka ima 94 ritma: 14 osnovnih i po 20 novih u kategorijama **Latino**, **Rock**, **Jazz** i **3/8**. Koristi kategoriju i pretragu na srpskom ili engleskom; prikazani su mera, nivo i kratko uputstvo. To su originalne vežbe i adaptacije za set, a ne transkripcije pesama. Muzički okvir: [jazz](https://www.drumeo.com/beat/?p=6953) i [bossa nova](https://www.drumeo.com/beat/the-bossa-nova/).

Editor zauzima celu širinu, a ispod njega su Ritmovi / Rezultat / Podešavanja. Povuci ručicu ispod nota za visinu notnog sistema, ili fokusiraj ručicu i koristi strelice. Izaberi **Redovi nota → 2 / 4** da rasporediš taktove u više redova; broj redova ne može biti veći od broja taktova. **Samo note** prikazuje komande i veliki notni sistem, a **Esc** vraća editor. Sviranje prati novi red automatskim pomeranjem. Visina, izbor redova i režim se pamte.

U kartici **Bubanj** izaberi **3D**. Prevuci miš ili prst za rotaciju, koristi točkić ili dva prsta za zum. Dostupni su i dugmad za rotaciju, zum i **Vrati pogled**. Dok je 3D platno fokusirano, levo/desno rotira, gore/dole ili +/− zumira, a Home vraća pogled. Notni zapis, MIDI i tastatura koriste iste boje u oba prikaza.

**2D crtež je izrađen direktno iz našeg proceduralnog 3D modela**, u fiksnom ortografskom pogledu. Prethodna ilustracija je zamenjena. Crni centri i cele površine činela menjaju boju bez smanjivanja; maske izvedene iz istog modela sprečavaju bojenje preko delova koji su ispred. Ovaj prikaz radi bez WebGL-a i offline. Slika i maske su u `assets/kit/`, a ponovo se generišu komandom `node qa/generate-kit-art.mjs` dok lokalni server radi. Poreklo: [assets/kit/PROVENANCE.txt](assets/kit/PROVENANCE.txt).

3D model je napravljen iz geometrije u aplikaciji: beli korpusi sa skrivenim zadnjim linijama, crni centri opni, obruči, zatezači, nosači, činele sa zvonima, podesivi stalci i dve papučice. Ne zahteva preuzimanje tuđeg modela. Koristi lokalni **Three.js 0.186.1** i OrbitControls, uz [MIT licencu](js/vendor/THREE-LICENSE.txt); runtime je uključen u offline keš. Renderer se učitava tek po izboru 3D i pauzira kada prikaz nije vidljiv. Bez WebGL-a ili pri gubitku grafičkog konteksta aplikacija vraća 2D.

## Konfigurator „Moj bubanj”

U kartici **Bubanj** otvori **Moj bubanj**. Izaberi mali, standardni ili prošireni set, pa podesi 0–3 viseća toma, 0–2 floor toma, 1–2 doboša, **1–2 bas bubnja**, 0–3 crash činele i 0–1 ride. Hi-hat sa papučicom ostaje uključen. Dostupni su desnoruki i ljevoruki raspored; položaji se određuju automatski.

Promena odmah važi za 2D, 3D, MIDI učenje i redove editora. Standardni 2D koristi originalni izvoz modela; prilagođeni set i uređivanje rasporeda koriste originalni SVG crtež iz zajedničkog rasporeda delova. Oba rade offline, a 2D radi i bez WebGL-a. Kamera 3D prikaza prilagođava kadar veličini seta.

Za ručni raspored klikni **Pomjeri djelove** pored 2D/3D izbora, pa mišem prevuci bubanj ili činelu. Pomera se ceo sklop sa stalkom i pedalom, po podu (levo/desno i napred/nazad); visina i nagib se ne menjaju. Položaj odmah važi u oba prikaza. U 3D je tada isključeno prevlačenje za rotaciju; postojeća dugmad za pogled i dalje rade. Ponovo klikni **Pomjeri djelove** za običnu rotaciju. **Esc** tokom prevlačenja otkazuje pomeranje. Položaj se lokalno čuva po puštanju miša; klikni **Sačuvaj profil** u Moj bubanj da ažuriraš imenovani profil. **Vrati raspored** briše ručne pomeraje i vraća automatske položaje, uz isti broj delova i izbor ruke. Promena ruke preslikava i ručne položaje. Privremeno isključen deo zadržava pomeraj kada ga ponovo uključiš. Izbor početnog seta vraća njegove automatske položaje.

U **Poveži padove** klikni **Nauči** uz instrument i udari stvarni pad. Dva bas bubnja imaju zasebne ciljeve, boje, zvuk, note u editoru i bodovanje. Modul mora slati različite MIDI brojeve nota za različite padove: trenutna mapa ne razdvaja iste note po MIDI kanalu ili ulaznom portu. Učenje postojeće note premešta njenu dodelu. Dodatni tasteri: **Y** treći viseći tom, **M** drugi floor tom, **R/T** drugi doboš/cross-stick, **Z** drugi bas bubanj i **Q** treći crash. Nove akustične varijante nisu dodate: drugi doboš i bas koriste postojeću sintetičku porodicu zvuka; dodatni tomovi imaju drugu visinu.

Trenutni set se pamti lokalno. **Sačuvaj profil** čuva sastav, raspored, MIDI mapu, kalibraciju i velocity krivu; postojeći profili bez konfiguracije dobijaju standardni set. **Novi profil** pravi novi zapis pri sledećem čuvanju. Profil možeš izvesti i uvesti kao JSON. Import kreira novi profil i ne prepisuje postojeće. Isti profili su dostupni u Podešavanjima.

Ako postojeći ritam koristi isključen deo, njegovi udarci ostaju sačuvani i vidljivi u editoru. Start objašnjava da treba uključiti taj deo ili izmeniti ritam; nema tihog brisanja ili automatske zamene. Promene seta i profila blokirane su tokom vežbe, programa, replay-a i kalibracije. Konfiguracija i MIDI učenje provereni su automatizacijom; fizički Roland još nije praktično testiran.

## MCP konektor

**Alati → MCP konektor** prikazuje stanje veze, prekidač i poslednji poziv. Drummer izlaže **13 WebMCP alata** otvorenom Codex browseru: čitanje stanja, pretraga/izbor ritmova, favoriti, tempo, opcije sviranja, start/stop, A–B fokus, prikaz, jezik i rezultati. Možeš, na primer, tražiti: „Pronađi jazz ritam, dodaj ga u favorite i postavi 100 BPM.” Pre prvog puštanja zvuka klikni u aplikaciji.

Stranica mora biti otvorena u browseru koji podržava WebMCP. Nisu potrebni zaseban MCP server, API ključ ni izmena Codex konfiguracije. Konektor ne odbacuje nesačuvane izmene; nije alat za brisanje biblioteke ili promenu MIDI mape. Čitanje rezultata vraća sažetke bez sirovih snimaka. Detalji i granice: [MCP.md](MCP.md). U browserima bez WebMCP-a aplikacija radi uobičajeno.

## Offline aplikacija i štampa

**Alati → Offline aplikacija** prikazuje stanje pripreme i dugmad za instalaciju i ažuriranje. Prvi put učitaj aplikaciju dok server radi i sačekaj poruku da je spremna. Posle toga ista adresa radi bez servera sa ugrađenim zvukom, ritmovima i lokalnim podacima. Instalaciju pokreće dugme ili meni browsera. Za ažuriranje ponovo pokreni server, proveri novu verziju i primeni je pošto sačuvaš ritam/program i zaustaviš vežbu. Aplikacija prvo proverava uspešno čuvanje svih podataka. Audio podlogu ponovo izaberi nakon otvaranja; WAV kitove treba bar jednom učitati online.

**Alati → Štampa / PDF** priprema trenutni ritam za A4, sa nazivom, tempom, merom, swingom/grupama i brojevima taktova. Izaberi 1–4 takta po redu, 1–8 ponavljanja i R/L oznake. Klikni „Štampaj / Sačuvaj PDF”; u dijalogu browsera izaberi **Sačuvaj kao PDF**, A4 i isključi zaglavlja browsera. Pregled se deli na stranice po tri reda nota.

Za razvoj: posle izmene keširanog HTML/CSS/JS fajla ili ikona promeni `VERSION` u `sw.js`. Time instalirana aplikacija dobija novu verziju kroz kontrolisano ažuriranje.

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

Instrumenti: `kick`, `snare`, `xstick`, `hh`, `hho`, `hhp`, `tom1`, `tom2`, `tom3`, `crash`, `crash2`, `ride`, `bell`.
`lo`/`hi` je raspon jačine udarca (1–127); više fajlova u istom rasponu se smjenjuju.

## EZdrummer i drugi programi

TD-17 šalje udarce istovremeno i Drummer-u i EZdrummeru: EZdrummer svira zvuk, Drummer prikazuje note i ocjenjuje.
Da Drummer pusti ritam kroz EZdrummer: uključi IAC Driver u aplikaciji *Audio MIDI Setup*, u Drummer-u izaberi
taj izlaz u Podešavanjima, a u EZdrummeru IAC kao MIDI ulaz.

## Alati

`alati/midirec.swift` (prevedi sa `swiftc -O alati/midirec.swift -o alati/midirec`) snima MIDI sa modula u fajl, a `alati/analiza.py` iz snimka računa dinamiku po padu,
duple okidače, crosstalk, hi-hat pedalu i tajming. Služi za podešavanje trigera na modulu.

## Provera aplikacije

Komande i opis testnog okruženja nalaze se u [qa/README.md](qa/README.md), a rezultati i ograničenja u [qa/IZVESTAJ.txt](qa/IZVESTAJ.txt).
