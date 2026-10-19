// Serbian source strings stay in the data model. The view layer translates text
// and accessible labels, retaining originals so SR/EN can switch without reload.
import { CATALOG_DEFINITIONS, PRESET_CATEGORIES } from './preset-catalog.js';
export const EN = {
  'Pomjeri djelove': 'Move parts', 'Vrati raspored': 'Reset layout', 'Raspored bubnja': 'Drum kit layout',
  '3D bubanj; prevuci deo za pomeranje': '3D drum kit; drag a part to move it',
  'Prevuci deo po podu. Esc otkazuje pomeranje. Sačuvaj profil za ovaj raspored.': 'Drag a part along the floor. Esc cancels the move. Save a profile to keep this layout.',
  'Raspored je zapamćen u browseru. Sačuvaj profil da ga zadržiš uz ovaj set.': 'Layout remembered in this browser. Save the profile to keep it with this kit.',
  'Delovi se raspoređuju automatski. Za svoj raspored uključi Pomjeri djelove ispod ovog panela; važi za 2D i 3D.': 'Parts are arranged automatically. Enable Move parts below this panel for your own layout; it applies to both 2D and 3D.',
  'Moj bubanj': 'My drum kit', 'Automatski raspored bubnja': 'Automatic drum kit layout',
  'Početni set': 'Starting kit', 'Prilagođeni': 'Custom', 'Mali set': 'Compact kit', 'Standardni set': 'Standard kit', 'Prošireni set': 'Expanded kit',
  'Viseći tomovi': 'Rack toms', 'Floor tomovi': 'Floor toms', 'Doboši': 'Snares', 'Bas bubnjevi': 'Bass drums', 'Crash činele': 'Crash cymbals', 'Ride činele': 'Ride cymbals',
  'Raspored': 'Layout', 'Desnoruki': 'Right-handed', 'Ljevoruki': 'Left-handed', 'Naziv profila': 'Profile name', 'Profil uređaja': 'Device profile', 'Poveži padove': 'Connect pads',
  'Dobos 2': 'Snare 2', 'Izvezi profil': 'Export profile', 'Uvezi profil': 'Import profile',
  'Delovi se raspoređuju automatski u oba prikaza. Trenutni set se pamti u ovom browseru.': 'Parts are arranged automatically in both views. The current kit is remembered in this browser.',
  'Profil čuva sastav bubnja, raspored, MIDI mapu, kalibraciju i velocity krivu.': 'A profile stores the kit parts, layout, MIDI map, calibration and velocity curve.',
  'Izaberi Nauči, pa udari pad. Za dva bas bubnja modul mora slati različite MIDI note. Učenje nove note može je premestiti sa drugog instrumenta.': 'Choose Learn, then strike a pad. Two bass drums need different MIDI notes from the module. Learning a note can move it from another instrument.',
  'MIDI nota je povezana. Sačuvaj profil da zadržiš mapu uz ovaj set.': 'MIDI note connected. Save the profile to keep the mapping with this kit.',
  'Profil je uvezen.': 'Profile imported.', 'Fajl nije ispravan profil bubnja.': 'This file is not a valid drum kit profile.',
  'Ritam koristi delove koji nisu u tvom setu. Uključi ih u Moj bubanj ili izmeni ritam.': 'This pattern uses parts missing from your kit. Enable them in My drum kit or edit the pattern.',
  '2D crtež iz našeg 3D modela': '2D drawing from our 3D model',
  'Favoriti': 'Favorites', 'Dodaj u favorite': 'Add to favorites', 'Ukloni iz favorita': 'Remove from favorites',
  'Označi omiljene ritmove zvezdicom.': 'Star your favorite patterns.',
  'Nema favorita. Dodaj ritam klikom na ☆.': 'No favorites yet. Click ☆ beside a pattern to add one.',
  'Nema sačuvanih ritmova u favoritima.': 'No saved patterns in favorites.',
  'Prethodna': 'Previous', 'Sledeća': 'Next', 'Stranica': 'Page',
  'Stranice mojih ritmova': 'Saved pattern pages', 'Stranice gotovih ritmova': 'Preset pages',
  'Prethodna stranica mojih ritmova': 'Previous saved patterns page', 'Sledeća stranica mojih ritmova': 'Next saved patterns page',
  'Prethodna stranica gotovih ritmova': 'Previous presets page', 'Sledeća stranica gotovih ritmova': 'Next presets page',
  'MCP konektor': 'MCP connector', 'Upravljanje Drummerom iz Codexa': 'Control Drummer from Codex',
  'Dozvoli MCP upravljanje ovom stranicom': 'Allow MCP control of this page', 'Pripremam MCP konektor…': 'Preparing the MCP connector…',
  'MCP upravljanje je isključeno.': 'MCP control is disabled.', 'MCP konektor je spreman za ovu stranicu.': 'MCP connector is ready for this page.',
  'Ovaj browser nema podršku za WebMCP. Otvori Drummer u Codex browseru.': 'This browser does not support WebMCP. Open Drummer in the Codex browser.',
  'MCP konektor nije mogao da se poveže. Osveži stranicu i pokušaj ponovo.': 'The MCP connector could not connect. Reload the page and try again.',
  'WebMCP povezuje Codex sa ovom otvorenom stranicom. Nisu potrebni poseban server ni API ključ.': 'WebMCP connects Codex to this open page. No separate server or API key is needed.',
  'Možeš tražiti izbor ritma, promenu tempa, start/stop, fokus A–B, prikaz 2D/3D, jezik i pregled rezultata.': 'Ask to select a pattern, change tempo, start/stop, set A–B focus, switch 2D/3D, change language or read results.',
  'Nesačuvani ritam se ne odbacuje. Konektor ne briše podatke i ne menja MIDI mapu. Za pokretanje zvuka prvo klikni jednom u aplikaciji.': 'Unsaved patterns are protected. The connector does not delete data or change the MIDI map. Click once in the app to enable audio first.',
  'Dostupnih alata:': 'Available tools:', 'Poslednji poziv:': 'Last call:',
  'Prikaz bubnja': 'Drum kit view', 'Prevuci za rotaciju · točkić ili dva prsta za zum': 'Drag to rotate · wheel or pinch to zoom',
  '3D bubanj; prevuci za rotaciju, točkić za zum': '3D drum kit; drag to rotate, wheel to zoom',
  'Okreni ulevo': 'Rotate left', 'Okreni udesno': 'Rotate right', 'Približi': 'Zoom in', 'Udalji': 'Zoom out', 'Vrati pogled': 'Reset view',
  'Učitavam 3D bubanj…': 'Loading 3D drum kit…', '3D nije dostupan u ovom browseru. 2D prikaz je aktivan.': '3D is unavailable in this browser. The 2D view is active.',
  ...Object.fromEntries(CATALOG_DEFINITIONS.map(p => [p.name, p.nameEn])),
  ...Object.fromEntries(PRESET_CATEGORIES.filter(c => c.lesson).map(c => [c.lesson, c.lessonEn])),
  '⤢ Samo note': '⤢ Notes only', '↩ Vrati editor': '↩ Back to editor',
  'Prikaži samo komande i note; Esc vraća editor': 'Show only controls and notation; Esc returns to the editor',
  'Redovi nota': 'Notation rows', 'Automatski': 'Auto', 'Vrati visinu': 'Reset height',
  'Vrati podrazumevanu visinu nota': 'Restore the default notation height',
  'Visina notnog sistema': 'Notation height', 'Povuci gore/dole za visinu nota; strelice menjaju visinu': 'Drag up/down to resize notation; arrow keys adjust height',
  'Kategorija': 'Category', 'Sve kategorije': 'All categories', 'Osnovni': 'Basics', 'Latino': 'Latin',
  'Pretraga': 'Search', 'Naziv, stil ili mera…': 'Name, style or meter…', 'Nema ritmova za ovaj izbor.': 'No patterns match this selection.',
  'Srednje napredno': 'Intermediate', 'Napredno': 'Advanced', 'Prikazano': 'Showing',
  '(kopija)': '(copy)', 'Uvezeni MIDI': 'Imported MIDI',
  'Start / stop (razmak)': 'Start / stop (Space)', 'Tempo (strelice gore/dolje, Shift ±5)': 'Tempo (arrow keys, Shift ±5)',
  'Metronom': 'Metronome', 'Klik na': 'Click subdivision', 'Odbrojavanje': 'Count-in', 'Ponavljaj': 'Loop',
  'Sviraj ritam': 'Play pattern', 'Moj zvuk': 'Monitor my hits', 'Snimaj': 'Record to grid',
  'Čuvanje nije uspelo. Sačuvaj kopiju fajla pre zatvaranja stranice.': 'Saving failed. Export a backup before closing the page.',
  'Čuvanje nije uspelo. Izvezi kopiju podataka ili pokušaj ponovo.': 'Saving failed. Export a backup or try again.',
  'Izvezi trenutni ritam': 'Export current pattern', 'Izvezi sve podatke': 'Export all data', 'Pokušaj ponovo': 'Try again',
  'Bubanj': 'Drum kit', 'Uredi ritam': 'Edit pattern', 'Vežbanje': 'Practice', 'Alati': 'Tools',
  'Naziv': 'Name', 'Taktova': 'Bars', 'Doba': 'Beats', 'Jedinica': 'Beat unit', 'Podjela': 'Subdivision',
  'šesnaestine': 'sixteenths', 'triole': 'triplets', 'Grupe doba': 'Beat groups', '3+3 ili 2+2+3': '3+3 or 2+2+3',
  'Ruke (R/L po koraku)': 'Sticking (R/L per step)', 'npr. RLRRLRLL, razmak = ništa': 'e.g. RLRRLRLL, space = blank',
  'Očisti': 'Clear', 'Kopiraj 1. takt': 'Copy bar 1',
  'Klik: normalno → akcenat → ghost → prazno. Desni klik briše. Shift-klik akcenat, Alt-klik ghost.': 'Click: normal → accent → ghost → empty. Right-click erases. Shift-click accents, Alt-click adds a ghost note.',
  'BPM označava četvrtinu u svim merama. Grupe određuju akcente klika. Swing: 50% ravno, 67% približno 2:1; u /8 pomera par šesnaestina. Triole imaju fiksnu podelu.': 'BPM always counts quarter notes. Groups set click accents. Swing: 50% straight, 67% about 2:1; in /8 it shifts pairs of sixteenths. Triplets use a fixed subdivision.',
  'MIDI uvoz': 'MIDI import', 'Štampa / PDF': 'Print / PDF', 'Offline aplikacija': 'Offline app',
  'Uvezi MIDI deonicu': 'Import a MIDI part',
  'Standardni MIDI tip 0 ili 1, najviše 10 MB. Izaberi traku, kanal i deo, pa proveri mapu pre uvoza. Originalni fajl se ne menja.': 'Standard MIDI type 0 or 1, up to 10 MB. Choose a track, channel and section, then check the note map. The original file stays unchanged.',
  'Izaberi MIDI fajl': 'Choose MIDI file', 'Naziv ritma': 'Pattern name', 'Traka': 'Track', 'Sve trake': 'All tracks',
  'Kanal': 'Channel', 'Svi kanali': 'All channels', 'Početak (četvrtine, od 0)': 'Start (quarter notes, from 0)',
  'Kvantizacija': 'Quantization', 'Šesnaestine': 'Sixteenths', 'Osmine': 'Eighths', 'Triole po jedinici mere': 'Triplets per beat unit',
  'Preuzmi meru iz dela': 'Read time signature at start', 'Mapa iz aktivnog profila': 'Use active profile map',
  'Izaberi MIDI fajl za pregled.': 'Choose a MIDI file to preview.', 'Uvezi u editor': 'Import into editor', 'Preskoči': 'Skip',
  'Notni list za vežbanje': 'Practice sheet', 'Taktova po redu': 'Bars per line', 'Ponavljanja': 'Repetitions',
  'Oznake ruku R/L': 'R/L sticking', 'Osveži pregled': 'Refresh preview', 'Štampaj / Sačuvaj PDF': 'Print / Save PDF',
  'Drummer kao aplikacija': 'Drummer as an app', 'Pripremam aplikaciju za offline rad…': 'Preparing the app for offline use…',
  'Instaliraj Drummer': 'Install Drummer', 'Proveri ažuriranja': 'Check for updates', 'Primeni novu verziju': 'Apply new version',
  'Ako dugme za instalaciju nije dostupno, koristi meni browsera: Instaliraj aplikaciju ili Dodaj na početni ekran. Podrška zavisi od browsera.': 'If the install button is unavailable, use your browser menu: Install app or Add to Home Screen. Support depends on the browser.',
  'Prvo učitaj aplikaciju dok server radi. Posle pripreme, ista adresa radi offline sa ugrađenim zvukom, ritmovima i lokalnim podacima. Za proveru novih verzija server mora da radi. Audio podlogu ponovo izaberi posle otvaranja.': 'First load the app while the server is running. Once ready, the same address works offline with built-in sounds, patterns and local data. The server must be running to check for updates. Select your backing file again after reopening.',
  'Alati za vežbanje': 'Practice tools', 'Fokus': 'Focus', 'Dnevnik': 'Journal', 'Pesma': 'Backing track', 'Programi': 'Programs',
  'Vežbaj deo koji zapinje': 'Practice the difficult section',
  'Izaberi taktove i instrumente koji ulaze u rezultat. Start ponavlja izabrani deo kada je uključeno Ponavljaj.': 'Choose which bars and instruments are scored. Start repeats the selected section when Loop is enabled.',
  'Uključi A–B i izbor instrumenata': 'Enable A–B and instrument selection', 'Od takta A': 'From bar A', 'Do takta B': 'To bar B',
  'Predloži iz poslednje sesije': 'Suggest from last session', 'Svi': 'All', 'Ruke': 'Hands', 'Noge': 'Feet',
  'Instrumenti za ocenjivanje': 'Instruments to score', 'Dnevnik vežbanja': 'Practice journal', 'Izvezi dnevnik': 'Export journal',
  'Svaka vežba se čuva po zaustavljanju. Izaberi sesiju za poređenje i pregled po instrumentu.': 'Each exercise is saved when stopped. Select a session to compare results and inspect individual instruments.',
  'Prikaži': 'Show', 'Sve sesije': 'All sessions', 'Trenutni ritam i fokus': 'Current pattern and focus', 'Napredak po danima': 'Daily progress',
  'Sesija': 'Session', 'Trajanje': 'Duration', 'Tačnost': 'Accuracy', 'tačnost': 'accuracy',
  'Sviraj uz pesmu': 'Play with a backing track', 'Izaberi audio fajl': 'Choose audio file', 'Ukloni pesmu': 'Remove backing track',
  'Još nema pesme. Audio fajl se ponovo bira posle osvežavanja stranice.': 'No backing track yet. Select the audio file again after reloading.',
  'Talasni oblik pesme; klik bira početak prvog takta': 'Track waveform; click to set the first bar',
  'Originalni tempo (BPM)': 'Original tempo (BPM)', 'Prvi takt u fajlu (s)': 'First bar in file (s)',
  'Brzina': 'Speed', 'Glasnoća': 'Volume', 'Sviraj pesmu uz vežbu': 'Play backing track with exercise',
  'Klik na talasni oblik postavlja prvi takt. A–B bira deo pesme. Start poravnava pesmu, note i odbrojavanje. Promena brzine menja i visinu tona.': 'Click the waveform to set the first bar. A–B selects the audio section. Start synchronizes the track, notes and count-in. Changing speed also changes pitch.',
  'Programi vežbanja': 'Practice programs', 'Novi program': 'New program', 'Sačuvani programi': 'Saved programs',
  'Izaberi program…': 'Choose a program…', 'Naziv programa': 'Program name', 'Sačuvaj program': 'Save program', 'Obriši program': 'Delete program',
  'Dodaj trenutni ritam i fokus, pa zadaj trajanje, tempo, cilj i pauzu. Program čuva sopstvene kopije ritmova.': 'Add the current pattern and focus, then set duration, tempo, goal and rest. Programs keep their own copies of patterns.',
  'Dodaj trenutni ritam': 'Add current pattern', 'Pokreni program': 'Start program', 'Prekini program': 'Stop program',
  'Ponovo poslušaj izvođenje': 'Replay your performance', 'Izaberi snimljenu sesiju…': 'Choose a recorded session…',
  '▶ Slušaj': '▶ Listen', '▶ Nastavi': '▶ Resume', 'Ⅱ Pauza': 'Ⅱ Pause', '■ Otkaži': '■ Cancel',
  'Dodaj očekivani ritam': 'Include reference pattern', 'Prikaz prolaza': 'Pass view', 'Svi prolazi': 'All passes',
  'Pozicija': 'Position', 'Izvezi MIDI': 'Export MIDI', 'Izvezi sesiju': 'Export session',
  'Sive crte su očekivane note; krugovi su stvarni udarci. Zeleno: tačno, sivo: skoro, crveno: višak. Prazan crveni krug: promašeno. MIDI izvoz čuva originalne note, jačinu i tajming.': 'Gray lines are expected notes; circles are actual hits. Green: accurate, gray: close, red: extra. An empty red circle means a miss. MIDI export preserves original notes, velocity and timing.',
  'Stvarni i očekivani udarci po instrumentu': 'Actual and expected hits by instrument', 'Vreme': 'Time', 'Instrument': 'Instrument',
  'Nota': 'Note', 'Jačina': 'Velocity', 'Odstupanje': 'Timing error', 'Ritmovi': 'Patterns', 'Rezultat': 'Results',
  'Podešavanja': 'Settings', 'Sačuvaj': 'Save', 'Kao novi': 'Save as new', 'Novi ritam': 'New pattern',
  'Moji ritmovi': 'My patterns', 'Izvezi sve': 'Export all', 'Uvezi fajl': 'Import file', 'Gotovi ritmovi': 'Presets',
  'Prolazi kroz ritam': 'Pattern passes', 'Obriši rezultat': 'Reset results', 'Profili uređaja': 'Device profiles',
  'Profil': 'Profile', 'Naziv profila': 'Profile name', 'Uređaj': 'Device', 'Velocity kriva': 'Velocity curve',
  'Linearna': 'Linear', 'Meka — lakši jaki udarci': 'Soft — easier loud hits', 'Tvrda — više kontrole tihih udaraca': 'Hard — more control over quiet hits',
  'Pojačanje jačine': 'Velocity gain', 'Sačuvaj profil': 'Save profile', 'Novi profil': 'New profile', 'Obriši profil': 'Delete profile',
  'Profil za povezani uređaj': 'Profile for connected device',
  'Profil čuva MIDI mapu, kalibraciju i velocity krivu. Posle izmene mape ili kalibracije klikni Sačuvaj profil. Snimak čuva originalnu jačinu; ocena i živi zvuk koriste krivu.': 'A profile stores the MIDI map, calibration and velocity curve. Click Save profile after changing the map or calibration. Recordings keep original velocity; scoring and live sound use the curve.',
  'Zadnja primljena nota:': 'Last received note:', 'Vrati TD-17 mapu': 'Reset TD-17 map',
  'Pošalji ritam na MIDI izlaz (npr. EZdrummer)': 'Send pattern to MIDI output (e.g. EZdrummer)', 'Ne, sviraj ovdje': 'No, play here',
  'Tajming': 'Timing', 'Strogost': 'Scoring level', 'Strogo (±15 ms tačno)': 'Strict (±15 ms accurate)',
  'Normalno (±25 ms tačno)': 'Normal (±25 ms accurate)', 'Lagano (±40 ms tačno)': 'Easy (±40 ms accurate)',
  'Kalibracija kašnjenja (ms)': 'Latency calibration (ms)', 'Kalibriši: udaraj dobos uz klik': 'Calibrate: hit the snare with the click',
  'Tihi taktovi (klik nestane, ti držiš tempo)': 'Silent bars (keep time without the click)', 'Ne': 'No',
  'Svaki drugi takt tih': 'Every other bar silent', 'Taktovi 3 i 4 od svaka 4 tihi': 'Bars 3 and 4 of every 4 silent',
  'Trener tempa: +': 'Tempo trainer: +', 'BPM kad prolaz ima 90% ili više': 'BPM after a pass scores 90% or more',
  'Zvuk': 'Sound', 'Zvuk bubnja': 'Drum sound', 'Ugrađeni (sintetički)': 'Built-in (synthesized)', 'Ritam': 'Pattern',
  'Moji udarci': 'My hits', 'Tastatura': 'Keyboard', 'Razmak': 'Space', 'tempo (Shift ±5)': 'tempo (Shift ±5)',
  '+ taster = akcenat,': '+ key = accent,', '= ghost': '= ghost',
  'Dobos': 'Snare', 'Hi-hat zatvoren': 'Closed hi-hat', 'Hi-hat otvoren': 'Open hi-hat', 'Hi-hat nogom': 'Pedal hi-hat',
  'HH nogom': 'HH pedal', 'Ride zvono': 'Ride bell', 'OTVOREN': 'OPEN',
  'Osnovni rok': 'Basic rock', 'Rok sa duplim kikom': 'Double-kick rock', 'Šesnaestine na hi-hatu': 'Sixteenth-note hi-hat',
  'Disko': 'Disco', 'Funk sa ghost notama': 'Funk with ghost notes', 'Shuffle (triole)': 'Shuffle (triplets)',
  'Jazz ride (triole)': 'Jazz ride (triplets)', 'Pop balada (cross-stick)': 'Pop ballad (cross-stick)',
  'Pojedinačni udarci RLRL': 'Single strokes RLRL', 'Fill niz tomove': 'Descending tom fill',
  'Bez bubnja: sviraj tasterima': 'No drums: use the keyboard',
  'Ovaj browser nema MIDI. Otvori aplikaciju u Chrome-u, Edge-u ili Brave-u.': 'This browser has no MIDI support. Open the app in Chrome, Edge or Brave.',
  'MIDI nije dozvoljen. Dozvoli MIDI za ovu stranicu u podešavanjima browsera.': 'MIDI access was denied. Allow MIDI for this site in your browser settings.',
  'Nema MIDI uređaja. Poveži TD-17 USB kablom i upali ga.': 'No MIDI device. Connect the TD-17 by USB and turn it on.',
  'Još nema sačuvanih ritmova.': 'No saved patterns yet.', 'Dupliraj': 'Duplicate', 'Izvezi': 'Export', 'Obriši': 'Delete',
  'Ima nesačuvanih izmjena': 'Unsaved changes', 'Bez naziva': 'Untitled', 'Nauči': 'Learn', 'Udari pad…': 'Hit a pad…', 'Ukloni': 'Remove', 'nema': 'none',
  'Sačekaj da se kalibracija završi.': 'Wait for calibration to finish.', 'Izaberi bar jedan instrument za vežbanje.': 'Choose at least one instrument to practice.',
  'Zvuk nije mogao da se pokrene.': 'Audio could not start.', 'Zvuk nije dostupan.': 'Audio is unavailable.',
  'Trenutni ritam ima nesačuvane izmjene. Da ih odbaciš?': 'The current pattern has unsaved changes. Discard them?',
  'Obrisati sve note u ovom ritmu?': 'Delete every note in this pattern?', 'Fajl nije ispravan JSON sa ritmovima.': 'This is not a valid pattern JSON file.',
  'Podaci su sačuvani.': 'Data saved.', 'Čuvanje ponovo radi. Sačuvaj izmene ritma dugmetom Sačuvaj.': 'Saving works again. Use Save to save your pattern changes.',
  'Zbir grupa mora da bude jednak broju doba.': 'The beat groups must add up to the number of beats.',
  'Pojaviće se kad prođeš kroz ritam.': 'Appears after completing a pattern pass.', 'Pogođeno': 'Hits', 'Prosjek': 'Average',
  'Rasipanje': 'Spread', 'Dinamika': 'Dynamics', 'Rano/kasno': 'Early/late',
  'Pokreni ritam i sviraj, ovdje ćeš vidjeti šta da popraviš.': 'Start a pattern and play to see what to improve.',
  'Odlično! Probaj tempo +5 ili uključi tihe taktove.': 'Great! Try +5 BPM or enable silent bars.', 'Dobro ide, nastavi.': 'Doing well, keep going.',
  'Učitavam zvukove…': 'Loading sounds…', 'Kit nije mogao da se učita, koristim ugrađeni zvuk.': 'The kit could not load. Using built-in sounds.',
  'Kalibracija ne može da pokrene zvuk.': 'Calibration could not start audio.',
  'Slušaj 4 klika, pa udaraj dobos (ili taster F) tačno uz klik…': 'Listen to 4 clicks, then hit the snare (or F) in time with the click…',
  'Premalo udaraca uz klik, probaj ponovo.': 'Too few hits near the click. Try again.',
  'Nema dovoljno grešaka iz ovog ritma za predlog.': 'Not enough mistakes in this pattern to suggest a section.',
  'Obrisati ovu sesiju i njeno izvođenje?': 'Delete this session and its performance?',
  'Ocenjuje se ceo ritam, sa svim instrumentima.': 'The entire pattern and all instruments are scored.',
  'Ostali udarci se čuju i snimaju, ali ne utiču na ocenu.': 'Other hits are audible and recorded but do not affect your score.',
  'sesija': 'sessions', 'minuta vežbanja': 'minutes of practice', 'najbolji BPM ≥90%, trenutni ritam i fokus': 'best BPM ≥90%, current pattern and focus',
  'Pokreni vežbu. Posle Stop, ovde će se pojaviti sesija i izvođenje.': 'Start practicing. After Stop, your session and performance appear here.',
  'Nema ranije uporedive sesije.': 'No earlier comparable session.', 'Otvori replay': 'Open replay', 'Obriši ovu sesiju': 'Delete this session',
  'Učitavam pesmu…': 'Loading backing track…', 'Audio fajl nije mogao da se učita. Probaj WAV ili MP3.': 'Could not load the audio file. Try WAV or MP3.',
  'Brzina mora da zadrži tempo između 30 i 260 BPM.': 'The speed must keep the tempo between 30 and 260 BPM.',
  'Odbaciti nesačuvane izmene programa?': 'Discard unsaved program changes?', 'Dodaj bar jednu vežbu u program.': 'Add at least one exercise to the program.',
  'Program je sačuvan.': 'Program saved.', 'Dodaj trenutni ritam da napraviš program.': 'Add the current pattern to create a program.',
  'Trajanje (s)': 'Duration (s)', 'Cilj (%)': 'Goal (%)', 'Pauza (s)': 'Rest (s)',
  'Program je završen. Rezultati svake vežbe su u dnevniku.': 'Program complete. Each exercise is saved in the journal.',
  'Program je prekinut. Završene sesije ostaju u dnevniku.': 'Program stopped. Completed sessions remain in the journal.',
  'Replay nije mogao da pokrene zvuk.': 'Replay could not start audio.', 'bez ocene': 'not scored',
  'Tabela prikazuje prvih 200 udaraca ovog prikaza. Izvoz sadrži sve.': 'The table shows the first 200 hits in this view. Exports include every hit.',
  'Sačekaj da se pesma učita.': 'Wait for the backing track to load.', 'Izaberi audio fajl za pesmu.': 'Choose an audio file for the backing track.',
  'Odabrani taktovi izlaze iz pesme. Pomeri prvi takt ili skrati A–B deo.': 'The selected bars extend beyond the audio file. Move the first bar or shorten A–B.',
  'Moj program': 'My program', 'Moj uređaj': 'My device', 'Trenutna podešavanja': 'Current settings', 'Tastatura / bilo koji uređaj': 'Keyboard / any device',
  'Profil je sačuvan.': 'Profile saved.', 'Novi profil koristi trenutnu mapu i kalibraciju.': 'The new profile uses the current map and calibration.',
  'Obrisati izabrani profil uređaja?': 'Delete the selected device profile?', 'Nema sačuvanog profila za povezani uređaj.': 'No saved profile matches a connected device.',
  'MIDI fajl je veći od 10 MB.': 'The MIDI file exceeds 10 MB.', 'MIDI fajl je prekinut ili oštećen.': 'The MIDI file is truncated or corrupt.',
  'Neispravna MIDI promenljiva dužina.': 'Invalid MIDI variable-length value.', 'Fajl nije standardni MIDI (.mid).': 'This is not a Standard MIDI file (.mid).',
  'Neispravno MIDI zaglavlje.': 'Invalid MIDI header.', 'Podržani su MIDI tipovi 0 i 1; tip 2 nije podržan.': 'MIDI types 0 and 1 are supported; type 2 is not.',
  'Potreban je MIDI sa PPQ vremenom; SMPTE nije podržan.': 'MIDI must use PPQ timing; SMPTE is not supported.',
  'Neispravan broj MIDI traka.': 'Invalid MIDI track count.', 'MIDI ima previše događaja (najviše 200.000).': 'Too many MIDI events (maximum 200,000).',
  'MIDI running status nedostaje.': 'Missing MIDI running status.', 'Neispravan MIDI podatak.': 'Invalid MIDI data.',
  'Nepodržan MIDI status u fajlu.': 'Unsupported MIDI status in file.', 'MIDI traka nema završni događaj.': 'MIDI track has no end-of-track event.',
  'Za uvoz izaberi meru od 2 do 7 doba, sa jedinicom /4 ili /8.': 'Choose a time signature with 2–7 beats and a /4 or /8 beat unit.',
  'Izabrani deo menja meru. Skrati deo ili pomeri početak posle promene.': 'The section changes time signature. Shorten it or start after the change.',
  'Mera u ovom delu nije podržana. Izaberi meru ručno.': 'This section uses an unsupported time signature. Choose one manually.',
  'MIDI je uvezen. Sačuvaj ritam u biblioteku.': 'MIDI imported. Save the pattern to your library.',
  'Deo menja tempo; uvezeni ritam koristi tempo na početku dela.': 'The section changes tempo; the imported pattern uses its starting tempo.',
  'Tempo je ograničen na 30–260 BPM.': 'Tempo is limited to 30–260 BPM.', 'Nema mapiranih udaraca u izabranom delu.': 'No mapped hits in the selected section.',
  'U dijalogu štampe izaberi Sačuvaj kao PDF, format A4 i isključi zaglavlja browsera.': 'In the print dialog choose Save as PDF, A4 paper, and disable browser headers.',
  'Drummer je instaliran.': 'Drummer is installed.', 'Instalacija nije dostupna. Koristi meni browsera.': 'Installation is unavailable. Use your browser menu.',
  'Nova verzija je spremna.': 'A new version is ready.', 'Provera ažuriranja je završena.': 'Update check complete.',
  'Server nije dostupan. Nastavi offline i proveri kasnije.': 'The server is unavailable. Continue offline and check later.',
  'Zaustavi vežbu i sačuvaj izmene ritma i programa pre ažuriranja.': 'Stop practicing and save pattern and program changes before updating.',
  'Sačuvaj kopiju podataka pre ažuriranja.': 'Export a backup before updating.', 'Browser je online.': 'Browser is online.', 'Browser je offline.': 'Browser is offline.',
  'Offline režim zahteva localhost ili HTTPS i browser sa service worker podrškom.': 'Offline mode requires localhost or HTTPS and a browser with service worker support.',
  'Aplikacija je spremna za offline rad.': 'The app is ready for offline use.',
  'Offline priprema nije uspela. Proveri server i pokušaj ponovo.': 'Offline preparation failed. Check the server and try again.',
  'Offline režim nije dostupan u ovom browseru ili profilu.': 'Offline mode is unavailable in this browser or profile.',
};

const TOKENS = {
  'dobos': 'snare', 'hi-hat zatvoren': 'closed hi-hat', 'hi-hat otvoren': 'open hi-hat', 'hi-hat nogom': 'pedal hi-hat', 'ride zvono': 'ride bell',
  'taktova': 'bars', 'takta': 'bars', 'takt': 'bar', 'Taktovi': 'Bars', 'korak': 'step', 'triole': 'triplets', 'četvrtina': 'quarter note',
  'tačno': 'accurate', 'skoro': 'close', 'promašeno': 'missed', 'višak': 'extra', 'jačina': 'velocity', 'nije mapirana': 'unmapped',
  'rano': 'early', 'kasno': 'late', 'normalno': 'normal', 'strogo': 'strict', 'lagano': 'easy',
  'instrumenata': 'instruments', 'stvarnih udaraca': 'actual hits', 'vežbi': 'exercises', 'ukupno': 'total', 'nesačuvane izmene': 'unsaved changes',
  'cilj ostvaren': 'goal reached', 'ponovi vežbu': 'repeat exercise', 'cilj': 'goal', 'Prolaz': 'Pass', 'Pauza': 'Rest',
  'sledeća vežba': 'next exercise', 'vežba': 'exercise', 'Stranice': 'Pages', 'Udarci': 'Hits', 'preskočeno': 'skipped', 'spojeno u isti korak': 'merged into one step',
  'Povezano': 'Connected', 'Sačuvano': 'Saved', 'Uvezeno ritmova': 'Imported patterns', 'Učitan profil': 'Loaded profile',
  'Prethodna uporediva sesija': 'Previous comparable session', 'Promena': 'Change', 'procentnih poena': 'percentage points',
  'Klik: četvrtine': 'Click: quarters', 'Klik: osmine': 'Click: eighths', 'Klik: šesnaestine': 'Click: sixteenths', 'Klik: triole': 'Click: triplets',
};
const DICT = { ...TOKENS, ...EN };
const escape = value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const matcher = new RegExp(`(?<![\\p{L}\\p{N}])(?:${Object.keys(DICT).sort((a, b) => b.length - a.length).map(escape).join('|')})(?![\\p{L}\\p{N}])`, 'gu');
let language = 'sr';
try { if (typeof window !== 'undefined' && localStorage.getItem('drummer.language.v1') === 'en') language = 'en'; } catch {}
export const getLanguage = () => language;
export function t(value, lang = language) {
  const source = String(value ?? ''); if (lang !== 'en') return source;
  if (DICT[source.trim()]) return source.replace(source.trim(), DICT[source.trim()]);
  let translated = source
    .replace(/^Obrisati ritam „(.*)"\?$/, 'Delete pattern “$1”?')
    .replace(/^Obrisati program „(.*)“\?$/, 'Delete program “$1”?')
    .replace(/^Vežbaj takt (\d+), (.*), na (\d+) BPM\.$/, 'Practice bar $1, $2, at $3 BPM.')
    .replace(/^Prolaz (\d+)%: tempo podignut na (\d+) BPM$/, 'Pass $1%: tempo increased to $2 BPM')
    .replace(/Pomeri vežbu (\d+) gore/g, 'Move exercise $1 up').replace(/Pomeri vežbu (\d+) dole/g, 'Move exercise $1 down')
    .replace(/Kašnjenje zvuka na ovom računaru: oko (\d+) ms\. Zvuk iz TD-17 modula kasni manje\./g, 'Audio latency on this computer: about $1 ms. The TD-17 module has less latency.')
    .replace(/Gotovo: tvoji udarci stižu (\d+) ms (poslije|prije) klika\. To se sada uračunava\./g, (_, ms, side) => `Done: your hits arrive ${ms} ms ${side === 'poslije' ? 'after' : 'before'} the click. This is now compensated.`)
    .replace(/Najneujednačeniji je (.*?) \(±(\d+) ms\), uspori pa ga ustabili\./g, 'Most inconsistent: $1 (±$2 ms). Slow down and stabilize it.')
    .replace(/Najviše promašaja: (.*?)\./g, 'Most misses: $1.')
    .replace(/Pazi na dinamiku na (.*?) \(akcenti jače, ghost note tiše\)\./g, 'Watch dynamics on $1 (stronger accents, quieter ghost notes).')
    .replace(/: (žuriš|kasniš) oko (\d+) ms\./g, (_, side, ms) => `: about ${ms} ms ${side === 'žuriš' ? 'early' : 'late'}.`);
  return translated.replace(matcher, match => DICT[match]);
}

export function initI18n() {
  const textSources = new WeakMap(), attrSources = new WeakMap();
  const blocked = el => !el || el.closest('script,style,textarea,[translate="no"],[data-user-text]');
  const text = node => {
    if (blocked(node.parentElement) || !node.nodeValue?.trim()) return;
    const previous = textSources.get(node), current = node.nodeValue;
    const source = previous && previous.rendered === current ? previous.source : current;
    const rendered = t(source); textSources.set(node, { source, rendered });
    if (current !== rendered) node.nodeValue = rendered;
  };
  const attributes = el => {
    if (blocked(el)) return;
    const saved = attrSources.get(el) || {};
    for (const name of ['title', 'aria-label', 'placeholder']) {
      const current = el.getAttribute(name); if (!current) continue;
      const source = saved[name]?.rendered === current ? saved[name].source : current;
      const rendered = t(source); saved[name] = { source, rendered };
      if (current !== rendered) el.setAttribute(name, rendered);
    }
    attrSources.set(el, saved);
  };
  const translate = root => {
    if (root.nodeType === Node.TEXT_NODE) { text(root); return; }
    if (root.nodeType !== Node.ELEMENT_NODE) return;
    attributes(root);
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT);
    let node; while ((node = walker.nextNode())) node.nodeType === Node.TEXT_NODE ? text(node) : attributes(node);
  };
  const observer = new MutationObserver(changes => {
    for (const change of changes) {
      if (change.type === 'characterData') text(change.target);
      else if (change.type === 'attributes') attributes(change.target);
      else for (const node of change.addedNodes) translate(node);
    }
  });
  observer.observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['title', 'aria-label', 'placeholder'] });
  const setLanguage = next => {
    language = next === 'en' ? 'en' : 'sr'; document.documentElement.lang = language;
    document.getElementById('languageSelect').value = language;
    try { localStorage.setItem('drummer.language.v1', language); } catch {}
    document.dispatchEvent(new Event('drummer:language')); translate(document.body);
  };
  document.getElementById('languageSelect').onchange = event => setLanguage(event.target.value);
  document.addEventListener('drummer:translate', () => translate(document.body));
  const confirm = window.confirm.bind(window); window.confirm = message => confirm(t(message));
  const prompt = window.prompt.bind(window); window.prompt = (message, value) => prompt(t(message), value);
  setLanguage(language);
}
