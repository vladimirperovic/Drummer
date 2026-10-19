import { DYN_VEL } from './patterns.js';

export class ReplayPlayer {
  constructor(audio, onPosition, onStop) {
    this.audio = audio; this.onPosition = onPosition; this.onStop = onStop;
    this.playing = false; this.starting = false; this.position = 0; this.speed = 1; this.token = 0;
  }

  async start(session, { speed = 1, position = 0, reference = false } = {}) {
    this.pause(); const token = ++this.token;
    this.starting = true;
    try { await this.audio.ensure(); }
    finally { if (token === this.token) this.starting = false; }
    if (token !== this.token) return;
    this.session = session; this.speed = speed; this.position = position;
    this.startTime = this.audio.time + .08; this.startPosition = position;
    this.events = [
      ...session.hits.map(h => ({ ...h, bus: 'live' })),
      ...(reference ? session.expected.map(n => ({ ...n, vel: DYN_VEL[n.dyn] || 92, bus: 'pattern' })) : []),
    ].filter(e => e.timeMs >= position).sort((a, b) => a.timeMs - b.timeMs);
    this.index = 0; this.playing = true;
    this.timer = setInterval(() => this.tick(), 20); this.tick();
  }

  tick() {
    if (!this.playing) return;
    const now = this.audio.time;
    while (this.index < this.events.length) {
      const event = this.events[this.index], at = this.startTime + (event.timeMs - this.startPosition) / 1000 / this.speed;
      if (at > now + .1) break;
      this.audio.play(event.inst, at, event.vel / 127, event.bus); this.index++;
    }
    this.position = Math.max(this.startPosition, this.startPosition + (now - this.startTime) * 1000 * this.speed);
    this.onPosition(Math.min(this.position, this.session.durationMs));
    if (this.position >= this.session.durationMs + 120) { this.pause(); this.position = 0; this.onPosition(0); this.onStop(); }
  }

  pause() {
    const active = this.playing || this.starting;
    this.token++; this.playing = false; this.starting = false; clearInterval(this.timer);
    if (active) this.audio.stopScheduled();
  }

  stop() { this.pause(); this.position = 0; this.onPosition(0); this.onStop(); }
}
