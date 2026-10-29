import { INST } from './patterns.js';

export const ROUTING_KEY = 'drummer.midiRouting.v1';
const port = value => typeof value === 'string' && value.length <= 300 && value ? value : '*';
const integer = (value, low, high) => Number.isInteger(value) && value >= low && value <= high;
export function normalizeRouting(value) {
  const inputs = new Map();
  for (const row of Array.isArray(value?.inputs) ? value.inputs.slice(0, 4096) : []) {
    if (!row || !integer(row.note, 0, 127) || !integer(row.channel, 0, 16) || !Object.hasOwn(INST, row.inst)) continue;
    const route = { device: port(row.device), deviceName: typeof row.deviceName === 'string' ? row.deviceName.slice(0, 200) : '', channel: row.channel, note: row.note, inst: row.inst };
    inputs.set(JSON.stringify([route.device, route.channel, route.note]), route);
  }
  const outputs = {};
  for (const [inst, row] of Object.entries(value?.outputs || {})) {
    if (!Object.hasOwn(INST, inst) || !row || !integer(row.note, 0, 127) || !integer(row.channel, 1, 16)) continue;
    outputs[inst] = { device: port(row.device), deviceName: typeof row.deviceName === 'string' ? row.deviceName.slice(0, 200) : '', channel: row.channel, note: row.note };
  }
  return { inputs: [...inputs.values()], outputs };
}

// Device specificity wins over a channel-only rule. Exact device+channel wins
// over both. Equal route keys are normalized to the last explicit assignment.
export function resolveRoute(routing, map, note, source = {}) {
  let match, specificity = -1;
  for (const route of routing.inputs) {
    if (route.note !== note || (route.device !== '*' && route.device !== source.deviceId) || (route.channel !== 0 && route.channel !== source.channel)) continue;
    const score = (route.device === '*' ? 0 : 2) + (route.channel ? 1 : 0);
    if (score > specificity) { match = route; specificity = score; }
  }
  return match?.inst || map[note];
}

export function sourceMetadata(source, status) {
  return { deviceId: typeof source?.id === 'string' ? source.id : '', deviceName: typeof source?.name === 'string' ? source.name : '', channel: (status & 15) + 1 };
}
