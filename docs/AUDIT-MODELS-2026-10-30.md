# Audit aplikacije i izbor AI modela

Audit je započet 29. oktobra i dopunjen 30. oktobra 2026. nakon zahteva za izbor modela i bolji mobilni prikaz. Polazna verzija je `35cc0da47375485a2848d81f581ed62c6955e5ad`, povučena sa `origin/main` fast-forward postupkom sa `3bd7263`. Pre povlačenja nije bilo lokalnih izmena.

Demucs ostaje podrazumevani separator: korisnik je zadovoljan njegovim praktičnim rezultatom. Novi modeli služe za poređenje na istoj pesmi. Veći model i manji ostatak drugih instrumenata sami po sebi ne dokazuju bolji rezultat ako model istovremeno ukloni deo bubnja.

## Potvrđeni nalazi u polaznoj verziji

P1 označava problem koji treba rešiti pre objave; P2 funkcionalnu grešku koju treba ispraviti. Navedene linije odnose se na polazni commit, pre novih izmena.

| Prioritet | Nalaz i posledica | Mesto | Status u ovoj nadogradnji |
| --- | --- | --- | --- |
| P1 | Pages paket ne sadrži `drum-next.css`. Zahtev vraća 404; `cache.addAll` odbija instalaciju service workera i offline režim ne postaje spreman. | `alati/build-pages.mjs:15`, `sw.js:29` | Ispravljeno: CSS je u paketu. |
| P2 | Globalni Stop zavisi od vidljivog režima. Posle Pesma → Note klik na Stop ostavlja pesmu aktivnom. | `js/main.js:175` | Ispravljeno 30. oktobra; pokriveno regresionom proverom. |
| P2 | Studio ne prepoznaje aktivnu pesmu/proveru trigera kao zauzet transport. Replay može krenuti preko pesme, a restore ostaje dostupan. | `js/main.js:1066` | Ispravljeno 30. oktobra; pokriveno regresionom proverom. |
| P2 | Dva Start zahteva tokom `audio.ensure()` naprave dva audio izvora; Stop zadrži kontrolu samo nad poslednjim. | `js/song-practice.js:175` | Ispravljeno 30. oktobra; pokriveno regresionom proverom. |
| P2 | Odbrojavanje i taktne linije u režimu Pesma ne računaju jedinicu mere. U 6/8 pri 120 BPM razmak je 0,5 umesto 0,25 sekundi prema vremenskom modelu aplikacije. | `js/song-practice.js:183`, `:336` | Ispravljeno 30. oktobra; pokriveno regresionom proverom. |
| P2 | Preskakanje MusicXML cue note ne pomera vremenski kursor: sledeći stvarni udarac dolazi prerano. | `js/score-drums.js:132` | Ispravljeno 30. oktobra; pokriveno regresionom proverom. |
| P2 | Srednji segment vezane note, sa `tie stop` i `tie start`, postaje novi udarac. | `js/score-drums.js:136` | Ispravljeno 30. oktobra; pokriveno regresionom proverom. |
| P2 | AI MIDI izvoz tiho izbacuje 10 ponuđenih instrumenata zbog nepotpune zasebne MIDI mape. | `js/ai-transcription-model.js:59` | Ispravljeno: koristi se centralna mapa instrumenata. |
| P2 | Posle izdvajanja bubnjeva izvor za sledeću transkripciju ostaje Original, pa dva koraka nisu automatski povezana. | `js/ai-tools.js`, završetak akcije `aiSeparate` | Ispravljeno: novi drum stem postaje izvor za note; prethodni predlog se uklanja. |
| P2 | Auto izbor backend-a odbacuje ispravnu GPU sesiju ako naknadna CPU priprema zakaže i ne oslobađa GPU resurse. | `js/ai-model-cache.js:129` | Ispravljeno: zadržava proverenu GPU sesiju; prekid oslobađa resurse. |
| P2 | Izveštaji pesama u `drummer.songRuns.v1` izostaju iz pune rezervne kopije. | `js/main.js:1198`, `js/song-practice.js:9` | Ispravljeno 30. oktobra; pokriveno regresionom proverom. |
| P3 | `allowDownload:false` uz GPU adapter i samo CPU cache baca grešku zbog odsutnog opcionog GPU runtime-a, pre pokušaja CPU-a. | `js/ai-model-cache.js:125` | Ispravljeno. Glavni UI obično koristi `allowDownload:true`, pa se prvobitni problem ne javlja u svakom offline toku. |

### Reprodukcije

- **Stop:** pokrenuti pesmu, otvoriti Note/editor, pritisnuti globalni Stop; `songPractice.active` ostaje `true`.
- **Preklapanje transporta:** tokom pesme `studio.host.isPlaying()` i `backupRestore.busy` vraćaju `false`; klik na Replay ostavlja i pesmu i replay aktivnim.
- **Dvostruki Start:** odložiti završetak `audio.ensure()`, pozvati Start dvaput, završiti inicijalizaciju i pozvati Stop. Prvi izvor ima `started=1, stopped=0`; drugi `started=1, stopped=1`.
- **MusicXML cue:** cue četvrtina pa obična četvrtina daje udarac na koraku 0 umesto 4 u šesnaestinskoj mreži.
- **MusicXML veza:** `start → stop+start → stop` daje udarce `[0,4]`, umesto `[0]`.
- **MIDI mapiranje:** mapirati činele na `bell`; pre ispravke izvoz nema note. Pogođeni su bili `bell`, `rimshot`, `xstick`, `hhp`, `tom4`, `floor2`, `snare2`, `xstick2`, `kick2`, `crash3`.

Ove greške ne nestaju zato što postojeći testovi prolaze. Audit nije potvrdio slanje korisničkog audija serveru. Modeli i runtime se preuzimaju odvojeno, sa pinovanom revizijom, veličinom i SHA-256 proverom.

## Provere polazne verzije

- JavaScript: **291/291**; Python: **10/10**.
- Pokrenuto svih **19 browser paketa** u izolovanoj kopiji. U prvom prolazu 17 paketa prolazi; dva imaju po jedan pad. Ciljane ponovne provere prolaze bez izmene produkcionog koda.
- MIDI reload test je čekao završetak sviranja, ali ne i asinhronog upisa: instrumentacija je zabeležila `pendingSessions=1`. Posle `flushJournal()` dobijeno je `pending=0, stored=1`. Potvrđen je race testa, ne kvar MIDI sadržaja.
- Drugi pad je timeout u zajedničkom učitavanju kataloga, pre početka testa 2D animacije. Ciljani test prolazi; tačan uzrok prvog zastoja nije utvrđen.
- Stvarni ADTOF browser test: **8/8**. Stvarni Demucs: **4/4**, uključujući otkazivanje i pripremu iz cache-a bez spoljne mreže.
- Demucs je dodatno prošao tišinu, konstantan signal i zvuk sa tihim završetkom. Sumnja zasnovana na komentaru o deljenju nulom nije potvrđena.
- `npm audit` nije prijavio poznate ranjivosti u QA zavisnostima. To ne pokriva automatski vendorizovane biblioteke i modele.

Originalni browser logovi i reprodukcije čuvaju se lokalno u `%TEMP%/drummer-audit-6935af30f3bc4d35a38298061b4ec043`. Testovi nisu menjali postojeće verzionisane QA slike i izveštaje.

## Provere nadogradnje

- JavaScript **301/301**, Python **10/10**; novi backend test pokriva četiri različita fallback i resource-lifetime scenarija.
- Izbor modela u stvarnoj aplikaciji **5/5**: pamćenje, SR/EN, licence, bez implicitnog preuzimanja, busy/cancel, 26 klasa i MIDI velocity. Proveren je i prenos uzoraka separator → transkriptor, automatski izbor drum stema i uklanjanje zastarelog predloga. Ovaj skup koristi kontrolisani worker izlaz; stvarna inferencija ima zasebne provere.
- Stvarni ADTOF **8/8** i Demucs **4/4**; SCNet-large **4/4**. Sva tri separatora prolaze zajednički sintetički test, devet inferencija ukupno.
- ADT_STR: stvarni encoder/decoder, offline cache, prekid i prelazak ADT_STR → ADTOF → ADT_STR prolaze. Resampling i mel priprema poklapaju se sa upstream implementacijom; maksimalno odstupanje u proverenim nizovima je 0.
- Pages paket sadrži svih **121** precache resursa; svaki vraća HTTP 200. Iz `/dist/` podputanje potvrđeni su instaliran service worker, reload bez mreže, `crossOriginIsolated=true`, tri ponuđena separatora i odsustvo JS grešaka. Time je proverena popravka nedostajućeg CSS-a.
- Mobilni interfejs proveren je na 360, 390 i 430 px, u SR i EN, uz desktop 1440 px. Osam interaktivnih scenarija prolazi: tempo, Start/Stop, opcije, samo note/Escape, navigacija, pretraga, režim Pesma i obaveštenje o ažuriranju. Nema horizontalnog preliva niti odsečenih navigacionih oznaka; glavne kontrole imaju najmanje 44 px za dodir. Score-view browser **5/5**, uključujući celu prvu meru na telefonu i očuvanje korisničke visine.

Mobilni prikaz dobija grupisani tempo, mirnije površine dugmadi, jasnije izabrane opcije, kratke oznake i uokviren prikaz nota. Dupla opcija za skrivanje bubnja iz reda sa notama je sakrivena na telefonu; ista funkcija ostaje dostupna kao **Samo note** pri vrhu. Desktop i korisnikova sačuvana visina notnog prikaza ostaju očuvani.

## Modeli i veličine

Veličine u tabeli su sami modeli, bez zajedničkog runtime-a. CPU WASM dodaje približno 14,85 MB; opcioni WebGPU runtime 28,75 MB. Cache sprečava ponovljeno preuzimanje istih datoteka.

| Model | Zadatak | Model download | Namena |
| --- | --- | ---: | --- |
| HT-Demucs FT drums specialist | Izdvajanje bubnjeva | 165,61 MB | Postojeći podrazumevani model. |
| SCNet-large | Izdvajanje bubnjeva | 45,08 MB | Alternativa sa manjim preuzimanjem. |
| SCNet | Izdvajanje bubnjeva | 12,90 MB | Lakša opcija; nije obećanje boljeg kvaliteta. |
| ADTOF Frame_RNN | Transkripcija | 2,17 MB | Pet grupa, brza obrada; podrazumevana MIDI jačina. |
| ADT_STR tau 0.8 | Transkripcija | 72,91 MB | Eksperimentalno: 26 klasa i procena jačine. |

SCNet ONNX čuva većinu težina u INT8, ali računanje proširuje na FP32: manji download ne znači jednako smanjenje radne memorije. [SCNet-large model card](https://huggingface.co/audiojs/scnet-large), [SCNet model card](https://huggingface.co/audiojs/scnet).

ADT_STR encoder i decoder koriste WASM. Postprocessing zadržava izvorne onset trenutke, artikulacije i velocity. Izbor dodatnih udaraljki koje Drummer nema u setu zahteva mapiranje. [ONNX artefakti](https://huggingface.co/swwallowws/coming-undone-browser-models).

## Koliko je model bolji

Objavljena tabela na istom **Multisong** skupu daje sledeći drums SDR, gde je veće bolje:

| Checkpoint | Drums SDR | Razlika prema postojećem Demucs-u |
| --- | ---: | ---: |
| HTDemucs4 FT Drums | 11,13 dB | — |
| SCNet starrytong | 10,79 dB | −0,34 dB |
| SCNet Large starrytong | 11,23 dB | +0,10 dB |
| BS-RoFormer četvorostemski ep17 | 11,29 dB | +0,16 dB |
| SCNet XL | 11,49 dB | +0,36 dB |
| SCNet XL IHF | 11,58 dB | +0,45 dB |

Ovo je poređenje određenih checkpointa u autorskoj evaluaciji, ne ocena svake pesme niti lokalno merenje Drummer ONNX konverzije. Razlike su umerene. Brojke za druge, specijalizovane MVSep drums modele ne smeju se pripisati ovim javnim checkpointima. [Izvor i veze do tačnih težina](https://github.com/ZFTurbo/Music-Source-Separation-Training/blob/main/docs/pretrained_models.md).

ADT_STR istraživanje obuhvata drum-only audio i bogatiju taksonomiju. Njegovi rezultati ne dokazuju da će bolje od ADTOF-a transkribovati originalni miks svake pesme. U aplikaciji je zato eksperimentalni izbor, prvenstveno posle izdvajanja bubnjeva. [Istraživanje ADT_STR](https://arxiv.org/html/2601.09520v1).

### Lokalni test ista tri ulaza

`npm --prefix qa run benchmark:separators` obrađuje tri proceduralna stereo miksa od 7,8 s, 44,1 kHz, na istoj mašini, istim Chromium/ORT i WASM backendom sa osam niti. Svi modeli koriste isti ulaz. Prvi klip je hladan inference, sledeći koriste istu sesiju. Vreme u tabeli isključuje pripremu modela i preuzimanje. Merenje poredi rezultat sa poznatim čistim bubnjevima, bez vremenskog poravnanja i podešavanja glasnoće.

| Model | Rok + tonovi, SDR | Prelazi + promenljivi tonovi, SDR | Tiši udarci + gust hi-hat, SDR | Prosečno vreme za 7,8 s |
| --- | ---: | ---: | ---: | ---: |
| Demucs FT | 21,03 dB | **20,26 dB** | 22,27 dB | 2,95 s |
| SCNet-large | **31,83 dB** | 19,89 dB | **30,28 dB** | 9,08 s |
| SCNet-small | 28,24 dB | 15,50 dB | 28,05 dB | **2,14 s** |

Ovaj direktni SDR je `10 log10(energija reference / energija greške)`, nije BSSEval/museval SDR iz javne tabele. Te dve tabele nisu međusobno uporedive. JSON beleži i SI-SDR, uklanjanje poznate pozadine, backend, broj niti i pojedinačna vremena. Svih devet inference prolaza uspešno je završeno. Osamnaest WAV datoteka sadrži miks, čiste bubnjeve, pozadinu i tri rezultata po primeru, sve sa istim faktorom glasnoće 0,5 za slušanje i bez klipovanja. Metrike su izračunate na izvornim float rezultatima.

SCNet-large je bolji u dva sintetička primera, dok Demucs bolje čuva primer sa prelazima i obrađuje klip oko tri puta brže. SCNet-small je najbrži, ali ima primetno veću grešku na prelazima. Ovi rezultati podržavaju izbor modela i slušno poređenje; **ne dokazuju procenat poboljšanja na stvarnim pesmama**.

Korisnik je ranije probao jednu MP3 i jednu FLAC pesmu na drugom računaru, zatim dostavio lokalni Toxicity FLAC za narednu proveru. Praktično poređenje koristi isti fajl kroz sva tri modela. Bez čistog originalnog drum stema možemo meriti vreme i preslušati rezultate, ali ne računati referentni SDR.

### Toxicity: stvarni korisnikov FLAC

FLAC metapodaci potvrđuju **System Of A Down — Toxicity**, istoimeni album, pesma 12; stereo 44.100 Hz, 16-bit, trajanje **218,933 s**, veličina **27.608.775 B**. Obrađena su dva ista isečka kroz sva tri modela: 45–60 s i 90–105 s. Svaki ulaz dekodiran je samo jednom; obrada koristi WASM sa osam niti i 661.500 uzoraka po kanalu. Vreme ne uključuje učitavanje modela.

| Model | Vreme za 45–60 s | Vreme za 90–105 s |
| --- | ---: | ---: |
| Demucs FT | 8,77 s | 9,36 s |
| SCNet-large | 27,90 s | 27,61 s |
| SCNet-small | 6,60 s | 6,43 s |

Svih šest obrada završeno je sa ispravnim uzorcima. Za svaki odlomak sačuvani su original i tri drum WAV-a, sa istim faktorom glasnoće i bez klipovanja. Nije dostavljen čist studijski drum stem: ova tabela meri brzinu, **ne kvalitet izdvajanja**. Ponovljivo: `npm --prefix qa run compare:audio`, sa eksplicitnim `DRUMMER_COMPARE_FILES`, `DRUMMER_COMPARE_OFFSET` i `DRUMMER_COMPARE_SECONDS`; uputstvo je u [QA README](../qa/README.md).

Za proveru nota pronađen je [Drumeo/Musora zapis Pedra Marambija](https://d1923uyy6spedc.cloudfront.net/system-of-a-down-toxicity-1680273274.pdf), kao i [besplatni autorov DrumsTheWord odlomak](https://www.drumstheword.com/toxicity-system-of-a-down-john-dolmayan-drum-essentials-free-video-drum-lesson-sheet-music-2025/). Community MIDI/GP zapisi nisu automatski tačna referenca: neki izostavljaju tihe udarce doboša, razlikuju se u tempu i koriste nestandardne brojeve artikulacija. Pre računanja podudaranja treba poravnati note sa originalnim audijem i koristiti isti vremenski model za sve kandidate. Izvorne internet partiture nisu deo aplikacije niti se redistribuiraju uz ovu nadogradnju.

Oba odlomka dodatno su obrađena kroz oba transkriptora, na originalu i sva tri izdvojena stema: **16/16 inference prolaza** završeno. ADTOF je trošio 0,11–0,17 s po odlomku. ADT_STR je na stemovima trošio 7,53–9,18 s, bez dostizanja token granice. Na originalnom miksu trošio je 49,76 s i 83,12 s, uz jedan odnosno dva skraćena chunk-a i predikcije dodatnih udaraljki koje podrazumevano mapiranje ne dodeljuje setu. To je konkretan razlog da ADT_STR u interfejsu preporučuje prethodno izdvajanje bubnjeva.

| Ulaz | ADTOF događaji, 45–60 s | ADT_STR sirovi događaji, 45–60 s | ADTOF događaji, 90–105 s | ADT_STR sirovi događaji, 90–105 s |
| --- | ---: | ---: | ---: | ---: |
| Original | 117 | 139¹ | 114 | 164² |
| Demucs FT | 113 | 100 | 116 | 120 |
| SCNet-large | 114 | 103 | 119 | 117 |
| SCNet-small | 114 | 106 | 117 | 118 |

¹ Jedan skraćeni chunk; 22 događaja bez podrazumevanog mapiranja. ² Dva skraćena chunk-a; 28 događaja bez podrazumevanog mapiranja. **Broj događaja nije ocena tačnosti**: modeli imaju različite taksonomije i mogu propustiti ili dodati udarce. Sirovi događaji zadržani su odvojeno od mapiranih. Nezavisni MIDI parser potvrdio je svih 3.732 izvezenih nota u 32 sirova/mapirana fajla, sa sačuvanim GM instrumentom i jačinom, uz najveću grešku zaokruživanja onset-a 0,209 ms. Ovo potvrđuje ispravnost izvoza, ne muzičku tačnost predikcije.

### Ograničena provera prema Drumeo zapisu

Ručno je proveren obrazac **12 bas-bubanj udaraca u merama 17–18** Drumeo transkripcije, na odlomku **48,733–54,996 s**. Dva vremenska sidra određena su iz originalnog FLAC-a pre čitanja izlaza modela. Svi modeli koriste isto poravnanje, široku kick grupu i sparivanje jedan-prema-jedan sa tolerancijom ±50 ms. Referentni trenuci odstupaju od niskofrekventnih audio tranzijenata najviše 19,7 ms (medijana 7,68 ms); ishod je nepromenjen pri pomeranju poravnanja ±10 ms.

| Transkriptor i ulaz | Poklopljeni | Dodatni | Propušteni | F1 podudaranja sa tim odlomkom |
| --- | ---: | ---: | ---: | ---: |
| ADTOF, original ili bilo koji od tri drum stema | 12 | 0 | 0 | 1,000 |
| ADT_STR, original | 12 | 5 | 0 | 0,828 |
| ADT_STR, bilo koji od tri drum stema | 12 | 1 | 0 | 0,960 |

Jedan dodatni ADT_STR kick na sva tri stema nalazi se oko 50,12 s; nije duplikat različitih GM artikulacija. **Ovo je samo kick na 6,26 sekundi**, uz ljudski zapis kao referencu. Ne meri ceo bubanj, celu pesmu, separator SDR niti opštu tačnost modela. Pokazuje da na ovom malom, proverljivom delu veći transkriptor nije pobedio postojeći ADTOF. Neopravdano bi bilo iz ovoga praviti opšti procenat poboljšanja.

Glavni aplikacioni tok ostaje **pesma → izabrani separator → izdvojeni bubnjevi → izabrani transkriptor → pregled/MIDI**. Posle izdvajanja `Samo bubnjevi` automatski postaje izvor za note; drugi korak se pokreće dugmetom za transkripciju. Originalni miks u istraživačkoj matrici služi kao kontrola, a korisnik ga i dalje može izričito odabrati za poređenje.

## Provera licenci

- **SCNet i SCNet-large:** autor je izričito potvrdio MIT za objavljene težine, uključujući konverziju u ONNX i redistribuciju. [Potvrda autora](https://github.com/starrytong/SCNet/issues/35).
- **ADTOF:** CC BY-NC-SA 4.0, samo nekomercijalna upotreba. MIT aplikacije ne menja te uslove. [Model card](https://huggingface.co/thebluescreen/adtof-drums-onnx).
- **ADT_STR:** ONNX izdavač izričito navodi CC BY-SA 4.0; originalni projekat ima istu licencu za svoj rad, ali originalni Hugging Face repo nema zasebnu izjavu za weights. To nije ista vrsta autorove eksplicitne potvrde kao kod SCNet-a. [ONNX licenca](https://huggingface.co/swwallowws/coming-undone-browser-models), [upstream licenca](https://github.com/pier-maker92/ADT_STR/blob/main/LICENSE).
- **Postojeći Demucs:** konverter navodi MIT, dok originalni autor razlikuje MIT kod od težina namenjenih istraživanju. UI sada prikazuje taj nesklad. [Pitanje za HTDemucs v4](https://github.com/facebookresearch/demucs/issues/508).
- **BS-RoFormer ep17:** pronađena je eksplicitna autorova MIT potvrda za konkretne težine i njihovu ONNX redistribuciju. [Potvrda](https://github.com/ZFTurbo/Music-Source-Separation-Training/issues/254), [komercijalna upotreba i distribucija](https://github.com/ZFTurbo/Music-Source-Separation-Training/issues/257), [ONNX potvrda](https://github.com/ZFTurbo/Music-Source-Separation-Training/issues/258).

BS-RoFormer ep17 ima jasniji licencni trag od ranije razmatranog šestostemskog SW modela. Ipak, Silverdaw konverzija od 269.457.840 B pada sa `std::bad_alloc` u četiri Chromium/WASM pokušaja, uključujući eksperimentalno deljenje attention operacija. Problem je browser runtime, ne potvrđena MIT licenca. Zato ovaj artefakt nije ponuđen kao funkcionalna opcija. [Tačan model](https://huggingface.co/silverdaw/bs-roformer-rhythm-onnx).

## Iskustva sa Reddita i foruma

U diskusiji bubnjara korisnici preporučuju Demucs FT kroz UVR, dok drugi biraju MVSep kombinacije; nema jedinstvenog pobednika za svaki snimak. To podržava zadržavanje postojećeg Demucs-a i slušno poređenje alternativa. [Reddit r/edrums](https://www.reddit.com/r/edrums/comments/1jqrrie/best_drum_isolation_apps/).

BS-RoFormer dobija pozitivne preporuke i na audio forumima, ali se mnoge odnose na vokale, određene server modele ili obradu drugog materijala. U Gearspace diskusiji o popravci izdvojenih stemova Alexey Lukin preporučuje MVSep BS-RoFormer modele; to je iskustvena preporuka, ne benchmark našeg ep17 checkpointa. [Gearspace diskusija](https://gearspace.com/threads/how-to-repair-ai-stem-seperated-tracks.1465033/).

Poređenje u Drummeru treba slušati za očuvan napad doboša, bas bubanj, trajanje činela, tihe udarce i ostatak drugih instrumenata. Jače uklanjanje ostalih instrumenata uz oštećen bubanj nije automatski napredak.

## Granice provere

Testovi koriste sintetički zvuk, simulirani MIDI i izolovane browsere. Nisu potvrđene sve fizičke MIDI/GPU kombinacije, čujna latencija korisnikovog uređaja niti tačnost na velikom označenom skupu stvarnih pesama. Novi modeli su kandidati za izbor, a ne obećanje boljeg rezultata na svakoj pesmi. Svih sedam ranije otvorenih funkcionalnih nalaza iz prve tabele popravljeno je u nastavku audita.

## Popravke sedam preostalih nalaza

Globalni Stop prvo zaustavlja aktivnu ili pokrenutu pesmu bez obzira na vidljivi režim. Studio i restore prepoznaju pesmu i proveru trigera kao zauzete. Song Start koristi token i stanje pokretanja, pa dvostruki klik, otkazivanje i greška inicijalizacije ne ostavljaju skriveni izvor. Odbrojavanje i report mreža koriste stvarnu jedinicu mere. MusicXML cue pomera vremenski kursor, dok svaki tie-stop nastavlja prethodni zvuk bez novog udara.

Rezervne kopije uključuju `songRuns`: validaciju, pregled sukoba, keep/replace/both, transakcioni upis i ponovno učitavanje istorije. Stare kopije bez tog polja čuvaju postojeću istoriju čak i u replace režimu; eksplicitna prazna lista je briše.

Novi `qa/audit-fixes-browser.mjs` proverava sve navedeno kroz šest grupa scenarija, uključujući stvarni restore i reload aplikacije.

Završna regresija: 301/301 JS testova i 10/10 Python testova prolazi. Pokrenut je svih 21 browser paket u izolovanoj kopiji. Dva scenarija (layout i performance report) prvobitno su istekla pri inicijalizaciji; ponovljene provere prošle su bez izmene koda. Tooltip test otkrio je nedostajuće opise lista modela: dodati su SR/EN opisi i omogućen njihov prevod, uz očuvanje originalnih naziva modela. Oba jezika i svih pet scenarija izbora modela zatim prolaze. Šest novih ciljanih grupa prolazi, uključujući restore i reload istorije pesama. Pages build, instalacija i offline reload prolaze. Fizički MIDI uređaj nije deo ove regresije.

Logovi punog browser prolaza sačuvani su u `%TEMP%/drummer-seven-tu6zu07e`; konačne provere prevoda i izbora modela izvršene su nad radnim repozitorijumom. Lokalni server aplikacije ostaje dostupan na `http://127.0.0.1:8141`.
