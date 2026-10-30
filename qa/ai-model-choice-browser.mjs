import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { encodeAiWav } from '../js/ai-audio.js';
import { parseMidiFile } from '../js/midi-file.js';

// UI/worker contract tests use controlled results. Real model inference has
// separate fixture-driven suites; switching a selector must never fetch weights.
const browser = await chromium.launch({ headless: true });
const output = resolve(process.env.DRUMMER_ARTIFACTS || 'artifacts/ai-model-choice');
await mkdir(output, { recursive: true });
try {
  const context = await browser.newContext({ serviceWorkers: 'block', viewport: { width: 1360, height: 1000 } });
  const page = await context.newPage(), requests = [], errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await context.route(/https:\/\/(huggingface.co|cdn.jsdelivr.net)\//, route => { requests.push(route.request().url()); return route.abort(); });
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'requestMIDIAccess', { configurable: true, value: async () => ({ inputs: new Map(), outputs: new Map() }) });
    window.__modelMessages = []; window.__holdModel = false; window.__terminatedModels = 0;
    const NativeWorker = window.Worker;
    window.Worker = class {
      constructor(url, options) {
        if (!/ai-transcription-worker|drum-separator-worker/.test(String(url))) return new NativeWorker(url, options);
        this.dead = false;
      }
      terminate() { this.dead = true; window.__terminatedModels++; }
      postMessage(message) {
        window.__modelMessages.push({ type: message.type, modelId: message.modelId,
          audio: message.audio && Array.from(message.audio.slice(0, 64)),
          channels: message.channels?.map(channel => Array.from(channel.slice(0, 64))) });
        if (window.__holdModel) return;
        setTimeout(() => {
          if (this.dead) return;
          let result = { backend: 'wasm', threads: 1, benchmark: null, inferenceMs: 20 };
          if (message.type === 'separate') result = { ...result, channels: message.channels.map(channel => channel.map(value => value * .5)), sampleRate: 44100 };
          if (message.type === 'transcribe') {
            const durationSeconds = message.audio.length / 44100;
            if (message.modelId.startsWith('adt-str')) result = { ...result, modelId: message.modelId, durationSeconds,
              events: [{ group: 'kick', inst: 'kick', timeSeconds: .03, velocity: 44 }, { group: 'hihat-open', inst: 'hho', timeSeconds: .12, velocity: 113 }] };
            else {
              const activations = new Float32Array(Math.ceil(durationSeconds * 100) * 5); activations[3 * 5] = .95;
              result = { ...result, modelId: message.modelId, durationSeconds, activations };
            }
          }
          this.onmessage?.({ data: { id: message.id, type: 'result', result } });
        }, 10);
      }
    };
  });
  const showAi = async () => { await page.locator('button[data-mode=song]').click(); await page.locator('#appNav [data-pane=ai]').click(); };
  await page.goto(process.env.DRUMMER_URL || 'http://127.0.0.1:8123');
  await page.waitForSelector('#aiSeparationModel option', { state: 'attached' }); await showAi();
  const adt = await page.locator('#aiTranscriptionModel option').evaluateAll(options => options.find(option => option.value.startsWith('adt-str')).value);
  const adtof = await page.locator('#aiTranscriptionModel option').evaluateAll(options => options.find(option => option.value.startsWith('adtof')).value);
  await page.locator('#aiSeparationModel').selectOption('scnet-large-int8');
  await page.locator('#aiTranscriptionModel').selectOption(adt);
  assert.match(await page.locator('#aiSeparationDescription').innerText(), /MIT/);
  assert.match(await page.locator('#aiTranscriptionDescription').innerText(), /CC BY-SA 4.0/);
  assert.equal(await page.locator('#aiTranscribe').isDisabled(), true);
  assert.deepEqual(requests, []);
  await page.reload(); await page.waitForSelector('#aiSeparationModel option', { state: 'attached' }); await showAi();
  assert.equal(await page.locator('#aiSeparationModel').inputValue(), 'scnet-large-int8');
  assert.equal(await page.locator('#aiTranscriptionModel').inputValue(), adt);
  await page.locator('#languageSelect').selectOption('sr');
  assert.match(await page.locator('#aiTranscriptionDescription').innerText(), /26 klasa/);
  await page.locator('#languageSelect').selectOption('en');
  console.log('PASS Model choices: persistence, SR/EN licenses and no implicit downloads');

  const signal = Float32Array.from({ length: 22050 }, (_, i) => .1 * Math.sin(2 * Math.PI * 80 * i / 44100));
  await page.locator('#aiAudioFile').setInputFiles({ name: 'synthetic.wav', mimeType: 'audio/wav', buffer: Buffer.from(encodeAiWav([signal], 44100)) });
  await page.waitForFunction(() => !document.querySelector('#aiSeparate').disabled);
  await page.evaluate(() => { window.__holdModel = true; });
  await page.locator('#aiSeparate').click();
  assert.equal(await page.locator('#aiSeparationModel').isDisabled(), true);
  assert.equal(await page.locator('#aiTranscriptionModel').isDisabled(), true);
  await page.locator('#aiCancel').click();
  assert.equal(await page.locator('#aiSeparationModel').isDisabled(), false);
  assert.ok(await page.evaluate(() => __terminatedModels > 0));
  await page.evaluate(() => { window.__holdModel = false; });
  await page.locator('#aiSeparate').click();
  await page.waitForFunction(() => document.querySelector('#aiAudition').value === 'drums');
  assert.ok(await page.evaluate(() => __modelMessages.some(message => message.type === 'prepare' && message.modelId === 'scnet-large-int8')));
  console.log('PASS Model choices: selected separator reaches worker, busy lock and cancellation');

  assert.equal(await page.locator('#aiTranscriptionSource').inputValue(), 'drums', 'extraction automatically feeds the next transcription step');
  await page.locator('#aiTranscribe').click(); await page.locator('#aiReview').waitFor();
  const pipeline = await page.evaluate(() => ({ source: __modelMessages.findLast(message => message.type === 'separate').channels,
    transcription: __modelMessages.findLast(message => message.type === 'transcribe').audio }));
  assert.ok(pipeline.transcription.some(value => Math.abs(value) > .001));
  pipeline.transcription.forEach((value, index) => assert.ok(Math.abs(value - .5 * pipeline.source.reduce((sum, channel) => sum + channel[index], 0) / pipeline.source.length) < 1e-8,
    'transcription receives separated samples, not original audio'));
  assert.equal(await page.locator('#aiClassMap select').count(), 26);
  assert.equal(await page.locator('#aiSensitivityLabel').isVisible(), false);
  const download = page.waitForEvent('download'); await page.locator('#aiExportMidi').click();
  const midiFile = resolve(output, 'adt-str-choice.mid'); await (await download).saveAs(midiFile);
  const midi = parseMidiFile(await readFile(midiFile));
  assert.deepEqual(midi.notes.map(note => note.velocity), [44, 113]);
  assert.deepEqual(midi.notes.map(note => note.note), [36, 46]);
  await page.locator('#aiTranscriptionModel').selectOption(adtof);
  assert.equal(await page.locator('#aiReview').isVisible(), false);
  assert.equal(await page.locator('#aiClassMap select').count(), 5);
  await page.locator('#aiTranscribe').click(); await page.locator('#aiReview').waitFor();
  assert.equal(await page.locator('#aiSensitivityLabel').isVisible(), true);
  console.log('PASS Model choices: ADT_STR articulations and velocity, ADTOF switch and fresh results');

  await page.locator('#aiTranscriptionSource').selectOption('original');
  await page.locator('#aiTranscribe').click(); await page.locator('#aiReview').waitFor();
  await page.locator('#aiSeparate').click();
  await page.waitForFunction(() => !document.querySelector('#aiSeparate').disabled);
  assert.equal(await page.locator('#aiTranscriptionSource').inputValue(), 'drums');
  assert.equal(await page.locator('#aiReview').isVisible(), false, 'fresh extraction invalidates a candidate from the previous source');
  console.log('PASS Model choices: separator output feeds transcription and replaces stale candidates');

  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true);
  await page.screenshot({ path: resolve(output, 'model-choice-phone.png'), fullPage: true });
  assert.deepEqual(requests, []); assert.deepEqual(errors, []);
  console.log('PASS Model choices: phone layout and no uncaught errors');
} finally { await browser.close(); }
