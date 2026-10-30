// View preferences never change the pattern or transport. Resizing uses a
// pointer capture so mouse, pen and touch keep working outside the handle.
export class WorkspaceView {
  constructor(settings, save, render) {
    this.settings = settings; this.save = save; this.render = render;
    this.sheet = document.querySelector('.sheet'); this.handle = document.getElementById('sheetResize');
    this.focus = !!settings.scoreOnly;
    settings.scoreRows = [0, 1, 2, 4, 8].includes(Number(settings.scoreRows)) ? Number(settings.scoreRows) : 0;
    settings.scoreScale = Math.max(40, Math.min(140, Number(settings.scoreScale) || 100));
    document.getElementById('scoreRows').value = settings.scoreRows;
    document.getElementById('scoreRows').onchange = e => { settings.scoreRows = +e.target.value; save(); render(); };
    document.getElementById('scoreView').onclick = () => this.toggle(!this.focus);
    const only = document.getElementById('scoreOnly'), scale = document.getElementById('scoreScale');
    if (only) only.onchange = e => this.toggle(e.target.checked);
    if (scale) {
      scale.oninput = e => {
        settings.scoreScale = Math.max(40, Math.min(140, Number(e.target.value) || 100));
        this.applyScale();
        // A slider can emit several events in a frame. Paint at most once per
        // frame and persist after the gesture instead of writing on each tick.
        if (!this.scaleFrame) this.scaleFrame = requestAnimationFrame(() => { this.scaleFrame = 0; render(); });
      };
      scale.onchange = () => save();
    }
    document.getElementById('resetSheet').onclick = () => { settings.sheetHeight = 0; this.apply(); save(); render(); };
    this.handle.onpointerdown = e => {
      if (e.button !== 0 || this.focus) return;
      e.preventDefault(); this.drag = { id: e.pointerId, y: e.clientY, height: this.sheet.getBoundingClientRect().height };
      this.handle.setPointerCapture(e.pointerId); this.handle.classList.add('dragging');
    };
    this.handle.onpointermove = e => {
      if (this.drag?.id !== e.pointerId) return;
      settings.sheetHeight = this.drag.height + e.clientY - this.drag.y; this.apply();
    };
    const end = () => { if (!this.drag) return; this.drag = null; this.handle.classList.remove('dragging'); save(); };
    this.handle.onpointerup = end; this.handle.onpointercancel = end; this.handle.onlostpointercapture = end;
    this.handle.onkeydown = e => {
      const delta = { ArrowDown: 40, ArrowUp: -40, PageDown: 120, PageUp: -120 }[e.key];
      if (delta || ['Home', 'End'].includes(e.key)) {
        e.preventDefault(); e.stopPropagation(); settings.sheetHeight = e.key === 'Home' ? 180 : e.key === 'End' ? this.maximum : this.sheet.getBoundingClientRect().height + delta;
        this.apply(); save();
      }
    };
    document.addEventListener('keydown', e => { if (e.key === 'Escape' && this.focus) { e.preventDefault(); this.toggle(false); } });
    addEventListener('resize', () => this.apply());
    this.apply();
  }
  get maximum() { return Math.max(280, Math.min(1000, innerHeight - 130)); }
  apply() {
    // Phone controls need more vertical space; leave a full staff visible at the default zoom.
    const defaultHeight = innerWidth <= 700 ? 320 : Math.min(280, innerHeight * .32);
    const height = Math.round(Math.max(180, Math.min(this.maximum, Number(this.settings.sheetHeight) || defaultHeight)));
    if (this.settings.sheetHeight) this.settings.sheetHeight = height;
    this.sheet.style.height = this.focus ? '' : `${height}px`;
    document.body.classList.toggle('notes-only', this.focus);
    this.handle.setAttribute('aria-valuemax', this.maximum); this.handle.setAttribute('aria-valuenow', height);
    const button = document.getElementById('scoreView');
    button.textContent = this.focus ? '↩ Vrati editor' : '⤢ Samo note'; button.setAttribute('aria-pressed', this.focus);
    const only = document.getElementById('scoreOnly'); if (only) only.checked = this.focus;
    this.applyScale();
    document.getElementById('resetSheet').hidden = this.focus;
  }
  applyScale() {
    const scale = document.getElementById('scoreScale'), value = document.getElementById('scoreScaleValue');
    if (scale) { scale.value = this.settings.scoreScale; scale.setAttribute('aria-valuetext', `${this.settings.scoreScale}%`); }
    if (value) value.textContent = `${this.settings.scoreScale}%`;
  }
  toggle(focus) {
    this.focus = focus; this.settings.scoreOnly = focus;
    this.apply(); this.render(); this.save();
    if (focus) { window.scrollTo({ top: 0 }); document.getElementById('notation').scrollTop = 0; }
    else document.getElementById('scoreView').focus();
  }
  notationOptions(pattern) {
    const rows = this.settings.scoreRows || (this.focus ? pattern.bars : 0);
    return { maxHeight: Infinity, zoom: this.settings.scoreScale,
      ...(rows ? { barsPerLine: Math.ceil(pattern.bars / rows) } : {}) };
  }
}
