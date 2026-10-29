import { INST, INSTRUMENTS, normalize, slotsPerBar, slotOffsetMs, slotAtMs, slotDurationMs } from './patterns.js';
import { renderNotation } from './notation.js';
import { getLanguage } from './i18n.js';

const words = (sr, en) => getLanguage() === 'en' ? en : sr;
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const NS = 'http://www.w3.org/2000/svg';
const signed = value => `${value > 0 ? '+' : ''}${Number(value.toFixed(1))} ms`;
const svgEl = (tag, attrs, parent, text) => {
  const node = document.createElementNS(NS, tag);
  for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, value);
  if (text != null) node.textContent = text;
  parent.appendChild(node); return node;
};

export function performancePasses(session) {
  const loops = new Set();
  for (const key of ['timeline', 'expected', 'hits']) for (const event of session[key] || []) {
    const loop = Number(event.loop); loops.add(Number.isFinite(loop) ? Math.max(0, Math.floor(loop)) : 0);
  }
  return [...loops].sort((a, b) => a - b);
}

function fallbackKnots(session, loop, expected) {
  const p = session.pattern, spBar = slotsPerBar(p), first = ((session.range?.from || 1) - 1) * spBar;
  const last = (session.range?.to || p.bars) * spBar, defaultBpm = session.bpmStart || p.bpm;
  const bpm = session.passes?.find(pass => pass.loop === loop)?.bpm || defaultBpm;
  // Old journals did not contain the slot clock. Expectations still anchor the
  // pass in absolute recording time; a hit must never become its own reference.
  if (expected.length) return expected.map(e => ({ ...e, bpm })).sort((a, b) => a.slot - b.slot);
  const duration = tempo => slotOffsetMs({ ...p, bpm: tempo }, last) - slotOffsetMs({ ...p, bpm: tempo }, first);
  const base = duration(defaultBpm); let start = loop * base;
  const accounted = new Set();
  for (const pass of session.passes || []) if (pass.loop < loop && !accounted.has(pass.loop)) {
    start += duration(pass.bpm || defaultBpm) - base; accounted.add(pass.loop);
  }
  return [{ slot: first, timeMs: start, bpm }];
}

// The recorded slot clock includes live tempo changes and swing. Interpolation
// uses that clock, rather than stretching a whole session at its final BPM.
export function performanceBar(session, loop, bar, index = null) {
  const p = session.pattern, spBar = slotsPerBar(p), firstSlot = (bar - 1) * spBar;
  const timeline = index?.timeline.get(loop) || (session.timeline || []).filter(e => e.loop === loop).sort((a, b) => a.slot - b.slot);
  const loopExpected = index?.expected.get(loop) || (session.expected || []).filter(e => e.loop === loop);
  const knots = timeline.length ? timeline : fallbackKnots(session, loop, loopExpected);
  const timeAt = slot => {
    let anchor = knots[0];
    for (const knot of knots) { if (knot.slot > slot) break; anchor = knot; }
    const timed = { ...p, bpm: anchor.bpm || p.bpm };
    return anchor.timeMs + slotOffsetMs(timed, slot) - slotOffsetMs(timed, anchor.slot);
  };
  const slotAt = timeMs => {
    let low = 0, high = knots.length;
    while (low < high) { const mid = (low + high) >> 1; if (knots[mid].timeMs <= timeMs) low = mid + 1; else high = mid; }
    const a = knots[Math.max(0, low - 1)], b = knots[low];
    if (b && a !== b && timeMs >= a.timeMs && b.timeMs > a.timeMs)
      return a.slot + (timeMs - a.timeMs) / (b.timeMs - a.timeMs) * (b.slot - a.slot);
    const timed = { ...p, bpm: a.bpm || p.bpm };
    return slotAtMs(timed, slotOffsetMs(timed, a.slot) + timeMs - a.timeMs);
  };
  const expectedById = index?.expectedById || new Map((session.expected || []).map(e => [e.id, e]));
  const firstBar = session.range?.from || 1, lastBar = session.range?.to || p.bars;
  const hits = (index?.deferHits ? [] : index?.hits.get(loop) || session.hits.filter(h => h.loop === loop)).map((hit, index) => {
    const expected = expectedById.get(hit.expectedId);
    const adjustedTimeMs = expected && Number.isFinite(hit.err) ? expected.timeMs + hit.err : hit.timeMs - (session.calib || 0);
    const slot = slotAt(adjustedTimeMs);
    const owner = expected ? Math.floor(expected.slot / spBar) + 1 : Math.max(firstBar, Math.min(lastBar, Math.floor(slot / spBar) + 1));
    return { ...hit, index, expected, adjustedTimeMs, localSlot: slot - firstSlot, bar: owner };
  }).filter(hit => hit.bar === bar);
  const expected = loopExpected.filter(e => e.slot >= firstSlot && e.slot < firstSlot + spBar);
  const hitIds = index?.hitIds || new Set(session.hits.map(h => h.expectedId).filter(Boolean));
  const missed = expected.filter(e => !hitIds.has(e.id));
  const oneBar = normalize({ ...p, bars: 1, steps: Object.fromEntries(INSTRUMENTS.map(i => [i.id, p.steps[i.id].slice(firstSlot, firstSlot + spBar)])), sticking: (p.sticking || '').slice(firstSlot, firstSlot + spBar) });
  if (timeline.length) {
    const scheduled = new Set(timeline.map(e => e.slot));
    for (const values of Object.values(oneBar.steps)) for (let i = 0; i < spBar; i++) if (!scheduled.has(firstSlot + i)) values[i] = 0;
  }
  // Recording can edit the live pattern; scored expectations are the source of
  // truth for the notes the player actually heard during this pass.
  for (const e of expected) oneBar.steps[e.inst][e.slot - firstSlot] = e.dyn;
  const end = knots.at(-1), timed = { ...p, bpm: end.bpm || p.bpm };
  const startMs = timeAt(firstSlot), barEnd = timeAt(firstSlot + spBar);
  const recordedEnd = timeline.length ? end.timeMs + slotDurationMs(timed, end.slot) : (session.durationMs > 0 ? session.durationMs : barEnd);
  return { pattern: oneBar, hits, expected, missed, firstSlot, startMs,
    endMs: Math.max(startMs, Math.min(barEnd, recordedEnd)), loop, bar, positionAt: time => slotAt(time) - firstSlot };
}

function drawHead(parent, inst, x, y, className, radius = 5.6) {
  const g = svgEl('g', { class: className }, parent);
  if (inst.head === 'normal' || inst.head === 'rimshot') {
    svgEl('ellipse', { cx: x, cy: y, rx: radius, ry: radius * .7, transform: `rotate(-20 ${x} ${y})` }, g);
    if (inst.head === 'rimshot') svgEl('path', { d: `M${x - radius - 2} ${y + radius}L${x + radius + 2} ${y - radius}`, fill: 'none' }, g);
  }
  else if (inst.head === 'diamond') svgEl('path', { d: `M${x} ${y - radius}L${x + radius} ${y}L${x} ${y + radius}L${x - radius} ${y}Z` }, g);
  else {
    svgEl('path', { d: `M${x - radius} ${y - radius}L${x + radius} ${y + radius}M${x + radius} ${y - radius}L${x - radius} ${y + radius}`, fill: 'none' }, g);
    if (inst.head === 'circlex') svgEl('circle', { cx: x, cy: y, r: radius + 2, fill: 'none' }, g);
  }
  return g;
}

// Index the recording once, so a long report does not rescan the whole journal
// for each displayed bar. Red events are assigned to their actual audible time,
// including hits that cross a bar/pass boundary.
export function performanceTimeline(session) {
  const index = {timeline:new Map(),expected:new Map(),hits:new Map(),expectedById:new Map(),hitIds:new Set(),deferHits:true};
  for (const key of ['timeline','expected','hits']) for (const event of session[key] || []) {
    const loop = Math.max(0,event.loop || 0), list=index[key].get(loop) || [];
    list.push(event); index[key].set(loop,list);
    if (key==='expected') index.expectedById.set(event.id,event);
    if (key==='hits' && event.expectedId) index.hitIds.add(event.expectedId);
  }
  for (const list of index.timeline.values()) list.sort((a,b)=>a.slot-b.slot);
  const spBar=slotsPerBar(session.pattern), models=[];
  for (const loop of performancePasses(session)) {
    const timeline=index.timeline.get(loop),from=session.range?.from || 1,to=session.range?.to || session.pattern.bars;
    const bars=timeline?.length ? [...new Set(timeline.map(e=>Math.floor((e.slot || 0)/spBar)+1))].sort((a,b)=>a-b)
      : Array.from({length:to-from+1},(_,i)=>from+i);
    for (const bar of bars) {
      const model=performanceBar(session,loop,bar,index);
      if (timeline?.length || !session.durationMs || model.startMs<session.durationMs) models.push(model);
    }
  }
  models.sort((a,b)=>a.startMs-b.startMs || a.loop-b.loop || a.bar-b.bar);
  for (const model of models) model.hits=[];
  for (const [indexInTake,hit] of (session.hits || []).entries()) {
    if (!models.length || !INST[hit.inst]) continue;
    const expected=index.expectedById.get(hit.expectedId);
    const adjustedTimeMs=expected && Number.isFinite(hit.err) ? expected.timeMs+hit.err : hit.timeMs-(session.calib || 0);
    let low=0,high=models.length;
    while(low<high){const mid=(low+high)>>1;if(models[mid].startMs<=adjustedTimeMs)low=mid+1;else high=mid;}
    const owner=models[Math.max(0,low-1)];
    owner.hits.push({...hit,index:indexInTake,expected,adjustedTimeMs,localSlot:owner.positionAt(adjustedTimeMs),bar:owner.bar});
  }
  return models;
}

export function renderPerformanceReport(container, session) {
  container._reportObserver?.disconnect();
  const models=performanceTimeline(session);
  if (!models.length) { container.replaceChildren(); return; }
  container.className='performance-report';
  container.innerHTML=`<header><h3>${words('Celo izvođenje u notama','Your complete performance in notation')}</h3><p>${words('Crne note su zadate. Crveni udarci su na istom notnom sistemu, tačno tamo gde si ih odsvirao. Levo = ranije, desno = kasnije.','Black notes are the exercise. Red hits share the same staff and show exactly when you played. Left = early, right = late.')}</p></header>
    <div class="performance-controls"><label>${words('Instrument','Instrument')} <select data-report-instrument><option value="">${words('Svi instrumenti','All instruments')}</option>${INSTRUMENTS.filter(i=>session.hits.some(h=>h.inst===i.id)||session.pattern.steps[i.id]?.some(Boolean)).map(i=>`<option value="${i.id}">${esc(i.label)}</option>`).join('')}</select></label>
    <label>${words('Taktova u redu','Bars per row')} <select data-report-columns><option value="1">1</option><option value="2" selected>2</option><option value="4">4</option></select></label><label><input type="checkbox" data-report-labels checked> ${words('Odstupanje u ms','Timing error in ms')}</label></div>
    <p class="performance-legend"><span class="reference-key">● ${words('Zadato','Expected')}</span><span class="actual-key">● ${words('Tvoj udarac','Your hit')}</span><span class="miss-key">○ ${words('Propuštena nota','Missed note')}</span></p>
    <p class="performance-summary" aria-live="polite"></p><div class="performance-score performance-full-score"></div><button data-report-more></button><p class="performance-calibration"></p>
    <details class="performance-details"><summary>${words('Tačna vremena udaraca','Exact hit times')}</summary><div class="table-wrap"><table class="data-table"><thead><tr><th>${words('Instrument','Instrument')}</th><th>${words('Vreme od početka','Time from start')}</th><th>${words('Odstupanje','Timing error')}</th></tr></thead><tbody></tbody></table></div><button data-report-more-times>${words('Još vremena udaraca','More hit times')}</button></details>`;
  const find=s=>container.querySelector(s), scoreHost=find('.performance-score'), instrument=find('[data-report-instrument]');
  let shown=0,tableShown=0,selected='', filteredHits=[];
  const chronologicalHits=[...session.hits].sort((a,b)=>a.timeMs-b.timeMs);
  const drawBar=(model,ordinal)=>{
    const article=document.createElement('section');article.className='performance-bar';article.dataset.reportBar=ordinal+1;
    const label=document.createElement('div');label.className='performance-bar-title';
    label.textContent=words(`Takt ${ordinal+1} · prolaz ${model.loop+1}, takt ${model.bar}`,`Bar ${ordinal+1} · pass ${model.loop+1}, bar ${model.bar}`);
    const host=document.createElement('div');article.append(label,host);scoreHost.append(article);
    const pattern=structuredClone(model.pattern);if(selected)for(const id of Object.keys(pattern.steps))if(id!==selected)pattern.steps[id].fill(0);
    const width=Math.max(650,slotsPerBar(pattern)*26+110);
    const score=renderNotation(host,pattern,{pageWidth:width,barsPerLine:1,barOffset:ordinal,finalBar:ordinal===models.length-1,zoom:85});
    const svg=score.svg,first=score.slotPos(0),next=score.slotPos(1),slotWidth=next.x-first.x,half=score.geometry.halfStep;
    // Each card already carries its chronological bar number. Equal vertical
    // bounds keep adjacent staves aligned even when one bar has no red hits.
    for(const number of svg.querySelectorAll('.barnum'))number.remove();
    const xAt=s=>first.x+s*slotWidth,layer=svgEl('g',{class:'performance-overlay'},svg),hits=model.hits.filter(h=>!selected||h.inst===selected);
    const xFor=h=>{
      const same=h.expected?.loop===model.loop && Math.floor(h.expected.slot/slotsPerBar(pattern))+1===model.bar;
      const s=same ? h.expected.slot-model.firstSlot : null;
      return xAt(h.localSlot)+(s==null?0:score.instrumentPos(h.expected.inst,s).x-xAt(s));
    };
    for(const expected of model.missed.filter(e=>!selected||e.inst===selected)){
      const at=score.instrumentPos(expected.inst,expected.slot-model.firstSlot),g=svgEl('g',{class:'performance-missed','data-expected-id':expected.id},layer);
      svgEl('circle',{cx:at.x,cy:at.y,r:8},g);svgEl('title',{},g,words('Propuštena nota','Missed note'));
    }
    const lanes=[-Infinity,-Infinity,-Infinity,-Infinity];let bottom=first.line.y0+90;
    for(const h of [...hits].sort((a,b)=>a.localSlot-b.localSlot)){
      const inst=INST[h.inst],x=xFor(h),y=first.line.y0+inst.pos*half;
      const g=svgEl('g',{class:'performance-hit','data-time-ms':h.timeMs,'data-adjusted-time-ms':h.adjustedTimeMs,'data-slot':h.localSlot,'data-inst':h.inst,tabindex:0},layer);
      const text=h.err==null?words(h.kind==='extra'?'višak':'slobodno',h.kind==='extra'?'extra':'free'):signed(h.err);
      const description=`${inst.label}: ${(h.timeMs/1000).toFixed(3)} s; ${text}`;
      svgEl('title',{},g,description);g.setAttribute('aria-label',description);
      // A translucent red head leaves the black reference visible when exact.
      drawHead(g,inst,x,y,'performance-actual',5);
      const down=inst.voice==='down',stemX=x+(down?-4:4);
      svgEl('line',{x1:stemX,x2:stemX,y1:y,y2:y+(down?22:-22),class:'performance-stem'},g);
      for(let position=-2;position>=inst.pos;position-=2)svgEl('line',{x1:x-8,x2:x+8,y1:first.line.y0+position*half,y2:first.line.y0+position*half,class:'performance-stem'},g);
      if(inst.open)svgEl('circle',{cx:x,cy:y-30,r:3,fill:'none',class:'performance-stem'},g);
      if(inst.badge)svgEl('text',{x:x-6,y:y+17,class:'performance-badge'},g,inst.badge);
      if(h.expected?.loop===model.loop && h.expected.slot>=model.firstSlot && h.expected.slot<model.firstSlot+slotsPerBar(pattern)){
        const at=score.instrumentPos(h.expected.inst,h.expected.slot-model.firstSlot);
        svgEl('line',{x1:at.x,x2:x,y1:y+9,y2:y+9,class:'performance-offset'},g);
      }
      const lane=lanes.findIndex(end=>end<x-18),chosen=lane<0?lanes.indexOf(Math.min(...lanes)):lane;lanes[chosen]=x+22;
      const labelY=first.line.y0+100+chosen*15;bottom=Math.max(bottom,labelY+10);
      svgEl('text',{x,y:labelY,class:'performance-delta'},g,text);
    }
    const box=svg.getBBox();let minX=Math.min(0,box.x-8),maxX=Math.max(svg.viewBox.baseVal.width,box.x+box.width+8);
    for(const hit of hits){const x=xFor(hit);minX=Math.min(minX,x-28);maxX=Math.max(maxX,x+28);}
    const minY=Math.min(first.line.y0-72,box.y-8),height=Math.max(first.line.y0+160,bottom,box.y+box.height+8)-minY;
    svg.setAttribute('viewBox',`${minX} ${minY} ${maxX-minX} ${height}`);svg.removeAttribute('width');svg.removeAttribute('height');
    svg.setAttribute('role','img');svg.setAttribute('aria-label',label.textContent);
  };
  const updateMore=()=>{find('[data-report-more]').hidden=shown>=models.length;find('[data-report-more]').textContent=words(`Prikaži sledeće taktove (${shown} / ${models.length})`,`Show more bars (${shown} / ${models.length})`);};
  const append=()=>{const end=Math.min(models.length,shown+20);for(;shown<end;shown++)drawBar(models[shown],shown);updateMore();};
  const table=()=>{const next=Math.min(filteredHits.length,tableShown+100);find('tbody').insertAdjacentHTML('beforeend',filteredHits.slice(tableShown,next).map(h=>`<tr><td>${esc(INST[h.inst]?.label || h.inst)}</td><td>${(h.timeMs/1000).toFixed(3)} s</td><td>${h.err==null?'—':signed(h.err)}</td></tr>`).join(''));tableShown=next;find('[data-report-more-times]').hidden=tableShown>=filteredHits.length;};
  const draw=()=>{
    selected=instrument.value;shown=0;tableShown=0;scoreHost.replaceChildren();find('tbody').replaceChildren();
    filteredHits=selected ? chronologicalHits.filter(h=>h.inst===selected) : chronologicalHits;
    const hitCount=filteredHits.length,missed=models.reduce((n,m)=>n+m.missed.filter(e=>!selected||e.inst===selected).length,0);
    find('.performance-summary').textContent=words(`${models.length} taktova · ${hitCount} udaraca · propuštene note: ${missed} · od početka do kraja`,`${models.length} bars · ${hitCount} hits · missed notes: ${missed} · from first to last`);
    append();if(find('details').open)table();
  };
  instrument.onchange=draw;
  find('[data-report-columns]').onchange=e=>scoreHost.style.setProperty('--report-columns',e.target.value);
  find('[data-report-labels]').onchange=e=>scoreHost.classList.toggle('hide-deltas',!e.target.checked);
  find('[data-report-more]').onclick=append;find('[data-report-more-times]').onclick=table;
  find('details').ontoggle=()=>{if(find('details').open&&!tableShown)table();};
  find('.performance-calibration').textContent=words(`Crvene note uključuju kalibraciju (${session.calib || 0} ms). Tabela čuva originalna vremena. Taktovi se dopunjavaju dok listaš.`,`Red notes include calibration (${session.calib || 0} ms). The table preserves original times. More bars load as you scroll.`);
  draw();
  if(typeof IntersectionObserver!=='undefined'){
    const observer=new IntersectionObserver(entries=>{if(entries.some(e=>e.isIntersecting)&&container.isConnected&&shown<models.length)append();},{rootMargin:'900px'});
    observer.observe(find('[data-report-more]'));container._reportObserver=observer;
  }
}
