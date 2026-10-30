import { getLanguage } from './i18n.js';

const words = (sr, en) => getLanguage() === 'en' ? en : sr;
const isAdt = model => model.id.startsWith('adt-str');

export function modelReviewText(model) {
  return isAdt(model)
    ? words('ADT_STR predlaže artikulacije i jačinu udaraca. Proveri ih slušanjem. Dodatne udaraljke bez odgovarajućeg dela seta su preskočene dok ih ne mapiraš.', 'ADT_STR estimates articulations and velocity. Check them by listening. Extra percussion without a matching kit piece is skipped until you map it.')
    : words('Ovaj model grupiše tomove, hi-hat i činele. Mapiraj grupe i ispravi note u editoru. MIDI jačina je podrazumevana, nije prepoznata dinamika.', 'This model groups toms, hi-hats and cymbals. Map the groups and edit the notes. MIDI velocity is a default, not detected dynamics.');
}

export function renderModelDescription(container, model) {
  let description, license, licenseUrl;
  if (model.id.startsWith('scnet')) {
    description = model.id === 'scnet-int8'
      ? words('Najmanji model za brzo poređenje. Može propustiti detalje u složenim prelazima; uporedi sa Demucs ili SCNet-large rezultatom.', 'The smallest model for a quick comparison. It may lose detail in complex fills; compare it with Demucs or SCNet-large.')
      : words('Alternativa za izdvajanje bubnjeva sa manjim preuzimanjem. Kvalitet zavisi od pesme; uporedi sa Demucs rezultatom.', 'An alternative drum separator with a smaller download. Quality varies by song; compare it with the Demucs result.');
    license = words('MIT — autor izričito potvrđuje licencu težina i ONNX distribuciju.', 'MIT — the author explicitly confirms the weights license and ONNX redistribution.');
    licenseUrl = 'https://github.com/starrytong/SCNet/issues/35';
  } else if (isAdt(model)) {
    description = words('Detaljniji, eksperimentalni model: 26 klasa i procena jačine udaraca. Sporiji je i namenjen izdvojenim bubnjevima. Prvo izaberi „Samo bubnjevi“ kao izvor za note.', 'A more detailed, experimental model: 26 classes and estimated velocity. It is slower and intended for isolated drums. First choose “Drums only” as the transcription source.');
    license = words('CC BY-SA 4.0 prema izdavaču ONNX modela; originalne težine nemaju zasebnu licencnu izjavu. Atribucija i deljenje adaptacija pod istim uslovima.', 'CC BY-SA 4.0 according to the ONNX publisher; the original weights lack a separate license declaration. Attribution and share-alike apply to adaptations.');
    licenseUrl = 'https://huggingface.co/swwallowws/coming-undone-browser-models';
  } else if (model.id.startsWith('adtof')) {
    description = words('Brzi model sa pet grupa: bas, doboš, tomovi, hi-hat i činele. Radi i sa originalnim miksom; jačina nota je podrazumevana.', 'A fast model with five groups: kick, snare, toms, hi-hat and cymbals. Supports the original mix; note velocity is a default.');
    license = words('CC BY-NC-SA 4.0 — samo nekomercijalna upotreba. Licenca modela je odvojena od licence aplikacije.', 'CC BY-NC-SA 4.0 — noncommercial use only. The model license is separate from the application license.');
    licenseUrl = 'https://huggingface.co/thebluescreen/adtof-drums-onnx';
  } else {
    description = words('Postojeći HT-Demucs FT model za bubnjeve. Možeš slušati izdvojene bubnjeve ili ostatak pesme kao pratnju.', 'The existing HT-Demucs FT drum specialist. Listen to isolated drums or the remainder as a backing track.');
    license = words('Licenca težina nije razjašnjena: ONNX izdavač navodi MIT, a originalni autor istraživačku namenu.', 'The weights license is unresolved: the ONNX publisher says MIT, while the original author specifies research use.');
    licenseUrl = 'https://github.com/facebookresearch/demucs/issues/508';
  }
  const text = document.createElement('p'); text.textContent = description;
  const notice = document.createElement('p'); notice.className = 'ai-license'; notice.textContent = license + ' ';
  const link = document.createElement('a'); link.href = licenseUrl; link.target = '_blank'; link.rel = 'noopener';
  link.textContent = words('Model i licenca', 'Model and license'); notice.append(link);
  container.replaceChildren(text, notice);
}
