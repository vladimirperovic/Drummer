import { normalize, INSTRUMENTS, slotsPerBar } from './patterns.js';
import { renderNotation } from './notation.js';
const cache = new Map();
export function appendLibraryPreview(button, source) {
  const bars = Math.min(2, source.bars), n = bars * slotsPerBar(source);
  const pattern = normalize({ ...source, bars, steps: Object.fromEntries(INSTRUMENTS.map(i => [i.id, source.steps[i.id].slice(0,n)])), sticking:(source.sticking || '').slice(0,n) });
  const key = JSON.stringify([pattern.bars,pattern.beats,pattern.beatUnit,pattern.division,pattern.swing,pattern.groups,pattern.steps,pattern.sticking]);
  let svg = cache.get(key);
  if (!svg) {
    const host = document.createElement('div');
    // getBBox() needs an attached SVG. Measuring a detached preview clips
    // accents, bar numbers and sticking when renderNotation crops its margins.
    host.style.cssText = 'position:fixed;left:-10000px;top:0;visibility:hidden;pointer-events:none';
    host.setAttribute('aria-hidden', 'true'); document.body.append(host);
    try {
      renderNotation(host, pattern, { pageWidth: Math.max(360, n * 18 + 128), barsPerLine: bars, zoom: 65 });
      svg = host.firstElementChild; svg.removeAttribute('height'); svg.removeAttribute('width');
      svg.querySelector('.playhead')?.remove(); svg.remove();
    } finally { host.remove(); }
    cache.set(key,svg); if (cache.size>200) cache.delete(cache.keys().next().value);
  }
  const preview = document.createElement('span'); preview.className='library-preview'; preview.setAttribute('aria-hidden','true');
  preview.append(svg.cloneNode(true)); button.append(preview);
  if (source.bars>bars) { const caption=document.createElement('small');caption.className='preview-caption';caption.textContent=`Taktovi 1–${bars} / ${source.bars}`;button.append(caption); }
}
