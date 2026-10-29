# Drummer QA

Aktuelna javna priprema od **29. oktobra 2026**: [izveštaj](RELEASE-2026-10-29.md), **229 JS + 7 Python + 156 Chromium browser scenarija = 392 različita testa**. Novi skupovi su `score-view`, `performance-report`, `ui-feedback`, `score-import` i `release-browser`. Opisi i brojke ispod beleže prethodne nadogradnje. Testovi koji proveravaju SR eksplicitno biraju taj jezik; posebna release provera potvrđuje novi EN default i pamćenje izabranog SR.

Regresione i funkcionalne provere za popravke devet problema, dve nadogradnje sa po pet funkcija, SR/EN interfejs, 80 novih ritmova, promenljivi raspored nota, 2D/3D bubanj, WebMCP, favorite, paginaciju i konfigurator seta sa jednim/dva bas bubnja i ručnim rasporedom, nad osnovom `b9199e027af2c76b99e67a5dc48835f87daac57f`.

Iz korena repozitorijuma:

```powershell
npm ci --prefix qa
npm --prefix qa test
python -m unittest discover -s qa -p test_analysis.py -v
```

Za browser testove pokrenuti server u posebnom terminalu:

```powershell
python -m http.server 8123 --bind 127.0.0.1
```

Zatim:

```powershell
# Samo ako Chromium za Playwright nije instaliran:
Push-Location qa
npx playwright install chromium
Pop-Location
npm --prefix qa run test:browser
```

Kompletan isti skup scenarija u instaliranom Edge-u:

```powershell
$env:DRUMMER_BROWSER = 'msedge'
npm --prefix qa run test:browser
Remove-Item Env:DRUMMER_BROWSER
```

`DRUMMER_URL` menja adresu servera. `DRUMMER_CASE` filtrira scenarije regularnim izrazom: `^Feature:` pokreće prvu nadogradnju, `^Expansion:` drugu nadogradnju i jezik; `Catalog:|Workspace:|Kit:` ritmove, raspored i crteže; `Library:|MCP:` favorite, paginaciju i konektor. Izostavi filter za kompletan prolaz. `test:browser` izvršava svih šest browser fajlova redom.

Testovi sa prefiksom `BUG:` proveravaju devet ranije pronađenih problema i sada moraju proći. `core.test.mjs` proverava osnovne modele, bodovanje i MIDI, a `practice.test.mjs` fokus, dnevnik, programe, audio podlogu, replay i binarni MIDI izvoz. Browser scenariji obuhvataju rad interfejsa i integraciju ovih delova.

`expansion.test.mjs` dodaje MIDI parser/uvoz, swing i /8 vremenski model, profile, velocity, štampu i prevod. `catalog.test.mjs` proverava aranžmane, najviše dve istovremene ruke, 3/8 vreme, prevode, pretragu, izolaciju kopija i poreklo 2D crteža iz aktuelnog 3D modela. `agent.test.mjs` proverava 13 WebMCP ugovora, argumente, zabranu odbacivanja izmena, audio/busy zaštite, konkurentne komande, registraciju i čuvanje favorita. Svih 94 ritma prolazi proveru modela. Ukupno ima **220 JavaScript testova i 7 Python testova**. Browser skup: **53 + 21 + 15 + 13 + 15 + 11 = 128 scenarija**. Ukupno: **355 različitih test-slučajeva, odnosno 483 izvršavanja** kada se browser scenariji izvrše u oba browsera.

`library-browser.mjs` proverava sve stranice i filtere, favorite za gotove/sačuvane ritmove, pamćenje, promenu naziva/kopiranje/brisanje, prazan izbor, grešku čuvanja, tastaturu, telefon i offline rad. WebMCP registracija se simulira, ali pozivi izvršavaju stvarne operacije aplikacije. Stvarno otkrivanje 13 alata i pozivi kroz Codex browser provereni su dodatno. `catalog-browser.mjs` proverava i vidljive piksele svih maski novog 2D crteža, crno-belu osnovu, boje za svih 13 instrumenata i offline prikaz bez WebGL-a.

2D sliku i maske ponovo generiši pomoću `node qa/generate-kit-art.mjs`, uz pokrenut lokalni server. Generator koristi naš proceduralni 3D model u izolovanom browseru; u produkciji 2D ne učitava Three.js i ne zahteva grafički kontekst. Poreklo je dokumentovano u `assets/kit/PROVENANCE.txt`.

Novi browser scenariji proveravaju kategorije i pretragu, sve nove ritmove, raspored pune širine na 1440/768/390/360 px, prevlačenje granice i tastaturu, pamćenje visine, dva/četiri reda, Samo note/Esc uz nastavak sviranja, automatsko pomeranje nota i 2D animacije bez promene veličine. Za 3D proveravaju lenjo učitavanje, belo-crni model, svih 13 instrumenata, rotaciju/zoom/reset, ponovno korišćenje renderera, SR/EN, telefon, nedostupan WebGL, izgubljen kontekst i prvo otvaranje 3D bez mreže. Koristi se SwiftShader u izolovanim testnim browserima radi ponovljive WebGL provere; korisnikova GPU podešavanja se ne menjaju. Rotacija je proverena mišem i tastaturom; fizički multitouch i sve grafičke kartice nisu provereni.

PWA scenariji koriste pravi service worker i isključenu mrežu u izolovanom browser kontekstu. Provera ažuriranja privremeno pokreće dodatni server vezan samo za 127.0.0.1, menja verziju worker odgovora i proverava čuvanje pre aktivacije. Ne menja korisnikov cache. Poziv instalacionog dijaloga je simuliran; OS instalacija nije izvršena. PDF se generiše browser print mehanizmom, renderuje Poppler-om i vizuelno pregleda.

Browser testovi koriste izolovane profile, simulirani Web MIDI i testni most dodat u HTTP odgovor za `main.js`; produkcioni fajl se ne menja. WAV provera koristi generisan sinusni sempl. Energija sintetičkih zvukova meri se kroz `OfflineAudioContext`. Kalibracija i savršeno izvođenje koriste kontrolisane timestamp-ove. To nisu provere fizičkog TD-17, zvučne kartice, čujne latencije ili EZdrummera.

Konfigurator: `kit-config.test.mjs` proverava svih 768 dozvoljenih kombinacija, normalizaciju, levoruki raspored, migraciju starih profila, odvojene MIDI note dva basa, očuvanje dodatnih traka i kompatibilnost dnevnika. `config-browser.mjs` dodaje 15 scenarija za kontrole, MIDI učenje svih 19 artikulacija, boje u 2D/3D, kadar i obnovu renderera, odvojeno snimanje/bodovanje oba basa, profile/export/import, zaštitu od greške čuvanja, isključene delove, reprodukciju, jezik, telefon i offline rad. Dva doboša imaju odvojene glave nota i oznaku S2; drugi bas ima oznaku K2.

Ručni raspored: `layout-browser.mjs` proverava 11 scenarija sa stvarnim pomeranjem miša: 2D i 3D picking, zajedničke položaje, drugi bas i hi-hat pedalu, boje nakon pomeranja, očuvanje pogleda, Esc/pointercancel, puštanje miša izvan prikaza i jedan upis, profile i JSON, ljevoruki raspored, privremeno isključene delove, reset, neuspešan upis, zaključavanje tokom sviranja, offline, EN i telefon. Pet novih modelskih testova proverava ograničenja pomeraja, nezavisnost delova, preslikavanje i duboko kopiranje u profilima.

Rezultati:

- `layout-final-results.json` — zbir završnih rezultata za ručni raspored, sa datumima i hash-evima izvora.
- `layout-core-results.txt`, `layout-python-results.txt`, `layout-full-chromium.txt`, `layout-chromium-continuation.txt`, `layout-full-edge.txt` — novi logovi; prvi Chromium log beleži timeout pri učitavanju biblioteke, a nastavak sadrži uspešan ponovljeni prolaz.
- `artifacts/layout/{chromium,msedge}/results.json` — ručno prevlačenje; `custom-2d.png`, `custom-3d.png`, `phone-layout.png`.
- `artifacts/drummer-layout-live.png` — novi režim u ažuriranom korisnikovom browseru.
- `IZVESTAJ-konfigurator-v1.txt` — prethodni izveštaj sa 456 prolaza.

- `config-final-results.json` — prethodni zbir za konfigurator pre ručnog pomeranja (456/456), putanje i hash-evi izvora.
- `config-core-results.txt`, `config-python-results.txt`, `config-full-chromium.txt`, `config-full-edge.txt` — provere konfiguratora i postojeće aplikacije. Chromium log sadrži i raniji pad kadra pre popravke; konačni status je u novijim JSON rezultatima navedenim u zbiru.
- `config-browser-results.txt`, `config-browser-edge-results.txt` — završnih 15 scenarija konfiguratora posle poslednjih UI i test-fixture izmena.
- `artifacts/config/{chromium,msedge}/results.json` — novi browser scenariji; `configurator.png`, `expanded-2d.png`, `expanded-3d.png`, `left-2d.png`, `left-3d.png`, `phone-config.png` i `phone-kit.png`.
- `artifacts/drummer-configurator-live.png` — konfigurator u ažuriranom korisnikovom browseru.
- `IZVESTAJ-favoriti-mcp.txt` — prethodni izveštaj sa 417 prolaza.

- `full-browser-results.txt`, `full-edge-results.txt` — prethodni objedinjeni logovi četiri skupa, pre konfiguratora.
- `artifacts/library/*/results.json` — favoriti, paginacija i WebMCP; slike `library-en.png`, `library-phone.png` i `mcp-panel.png`.
- `artifacts/catalog/*/kit-2d.png`, `kit-2d-colors.png`, `phone-2d.png` — originalni 2D iz 3D modela.
- `OBJAVA.txt` — pregled pripreme za javnu objavu i poreklo sadržaja.
- `IZVESTAJ-ritmovi-3d.txt` — prethodni izveštaj sa 372 prolaza.

- `core-results.txt`, `python-results.txt`, `browser-results.txt`, `edge-results.txt` — završni logovi.
- `artifacts/browser-results.json` — Chromium scenariji i verzija browsera.
- `artifacts/msedge/msedge-browser-results.json` — isti skup u Edge-u.
- `expansion-browser-results.txt`, `expansion-edge-results.txt` — završni logovi druge nadogradnje.
- `artifacts/expansion/chromium/results.json`, `artifacts/expansion/msedge/results.json` — novi scenariji u oba browsera.
- `artifacts/expansion/*/practice-sheet.pdf` i PNG prikazi — probna štampa, jezik, telefon i offline ekran.
- `catalog-browser-results.txt`, `catalog-edge-results.txt`, `artifacts/catalog/*/results.json` — novi ritmovi, raspored i 3D.
- `artifacts/catalog/*/kit-3d.png`, `phone-3d.png`, `notes-only.png` — novi prikazi.
- `artifacts/drummer-final-3d.png` — detaljni 3D u korisnikovom otvorenom browseru.
- `artifacts/` i `artifacts/msedge/` — screenshot-ovi, audio merenja i probni JSON/MIDI izvozi.
- `IZVESTAJ.txt` — završni izveštaj, obim provere i ograničenja.
- `IZVESTAJ-druga-nadogradnja.txt` — prethodni izveštaj sa 259 uspešnih izvršavanja.
- `IZVESTAJ-pre-popravki.txt` — početni audit, pre ovog zahteva za popravke i nove funkcije.
- `IZVESTAJ-prva-nadogradnja.txt` — prethodni izveštaj sa 190 uspešnih izvršavanja i predlozima koji su sada implementirani.

Stare slike sa `failure` u nazivu potiču iz početnog audita ili razvoja; merodavan je završni JSON izveštaj, koji eksplicitno navodi status svakog scenarija. Ponavljanje testa osvežava odgovarajući izveštaj i screenshot-ove.
