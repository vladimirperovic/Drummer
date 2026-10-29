export async function setupPwa(host) {
  const $ = id => document.getElementById(id);
  let installEvent, registration, reloadForUpdate = false, needsReload = false;
  let hadController = !!navigator.serviceWorker?.controller, lastProbe = Date.now();
  const status = message => { $('pwaStatus').textContent = message; };
  const updateButtons = () => {
    const available = !!registration?.waiting || needsReload;
    $('pwaUpdate').hidden = !available;
    if ($('appUpdate')) $('appUpdate').hidden = !available;
  };
  addEventListener('beforeinstallprompt', event => {
    event.preventDefault(); installEvent = event; $('pwaInstall').disabled = false;
  });
  addEventListener('appinstalled', () => { installEvent = null; $('pwaInstall').disabled = true; status('Drummer je instaliran.'); });
  $('pwaInstall').onclick = async () => {
    if (!installEvent) return;
    try { await installEvent.prompt(); await installEvent.userChoice; }
    catch { status('Instalacija nije dostupna. Koristi meni browsera.'); }
    installEvent = null; $('pwaInstall').disabled = true;
  };
  $('pwaCheck').onclick = async () => {
    try { await registration?.update(); status(registration?.waiting ? 'Nova verzija je spremna.' : 'Provera ažuriranja je završena.'); }
    catch { status('Server nije dostupan. Nastavi offline i proveri kasnije.'); }
    updateButtons();
  };
  $('pwaUpdate').onclick = async () => {
    if (!registration?.waiting && !needsReload) return;
    if (!host.canReload()) { status('Zaustavi vežbu i sačuvaj izmene ritma i programa pre ažuriranja.'); return; }
    if (!await host.flush()) { status('Sačuvaj kopiju podataka pre ažuriranja.'); return; }
    if (!host.canReload()) { status('Zaustavi vežbu i sačuvaj izmene ritma i programa pre ažuriranja.'); return; }
    reloadForUpdate = true;
    if(needsReload)location.reload();
    else registration.waiting.postMessage({ type: 'ACTIVATE_UPDATE' });
  };
  if($('appUpdate'))$('appUpdate').onclick = () => { host.showUpdates?.(); $('pwaUpdate').click(); };
  const connectivity = () => { $('pwaNetwork').textContent = navigator.onLine ? 'Browser je online.' : 'Browser je offline.'; };
  addEventListener('online', connectivity); addEventListener('offline', connectivity); connectivity();
  if (!('serviceWorker' in navigator) || !isSecureContext) { status('Offline režim zahteva localhost ili HTTPS i browser sa service worker podrškom.'); return; }
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (reloadForUpdate) location.reload();
    else if(hadController){needsReload=true;updateButtons();status('Nova verzija je spremna.');}
    hadController=true;
  });
  const checkOnReturn = () => {
    if(!registration || document.hidden || !navigator.onLine || Date.now()-lastProbe<60000)return;
    lastProbe=Date.now();registration.update().catch(()=>{});
  };
  addEventListener('focus',checkOnReturn);document.addEventListener('visibilitychange',checkOnReturn);
  try {
    registration = await navigator.serviceWorker.register('./sw.js', { updateViaCache: 'none' });
    $('pwaCheck').disabled = false;
    const ready = () => {
      updateButtons();
      status(registration.waiting || needsReload ? 'Nova verzija je spremna.' : registration.active?.state==='activated' ? 'Aplikacija je spremna za offline rad.' : 'Pripremam aplikaciju za offline rad…');
    };
    registration.addEventListener('updatefound', () => {
      const worker = registration.installing;
      worker?.addEventListener('statechange', () => {
        if (worker.state === 'installed' || worker.state === 'activated') ready();
        if (worker.state === 'redundant') status('Offline priprema nije uspela. Proveri server i pokušaj ponovo.');
      });
    });
    if (registration.waiting || registration.active) ready();
    else { status('Pripremam aplikaciju za offline rad…'); await navigator.serviceWorker.ready; ready(); }
  } catch { status('Offline režim nije dostupan u ovom browseru ili profilu.'); }
}
