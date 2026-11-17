import test from 'node:test';
import assert from 'node:assert/strict';
import { gzipSync } from 'node:zlib';
import { readRecording, prepare } from '../src/judges.js';

const replay = {
  format: 'shredbound-judge-replay', version: 1, key: 'ABCD23:host-1-1', mode: 'slvsh', winner: 'a',
  riders: [{ id: 'a', name: 'ALBA', role: 'rider' }, { id: 'b', name: 'MONTE', role: 'rider' }, { id: 'j', name: 'JUDGE', role: 'judge' }],
  points: Array.from({ length: 21 }, (_, i) => 'p' + i), lines: [[0, 1]],
  calls: [{ t: 9000, kind: 'judged', n: 0, runner: 'a', value: 1 }, { t: 3000, kind: 'call', runner: 'a', trick: 'BIO 900' }],
  frames: { a: { t: [0, 100, 200], p: [Array(63).fill(0), Array(63).fill(100), Array(63).fill(200)] }, b: { t: [0, 250], p: [Array(63).fill(5), Array(63).fill(6)] } },
};

test('judges: a gzipped recording reads back with its tracks, its length and its calls in order', async () => {
  const read = await readRecording(gzipSync(Buffer.from(JSON.stringify(replay))));
  assert.equal(read.tracks.length, 2, 'the judge rides nothing and has no track');
  assert.equal(read.duration, 250);
  assert.deepEqual(read.calls.map(c => c.kind), ['call', 'judged']);
  assert.equal(read.tracks[0].colour, '#ff8a33');
});

test('judges: plain JSON (a browser that already unzipped it) reads too, and a stranger file does not', async () => {
  const read = await readRecording(Buffer.from(JSON.stringify(replay)));
  assert.equal(read.tracks[1].name, 'MONTE');
  await assert.rejects(readRecording(Buffer.from(JSON.stringify({ format: 'other' }))));
  assert.equal(prepare({ format: 'shredbound-judge-replay', riders: [], frames: {} }).duration, 0);
});

test('judges: the module the Domare tab imports is published with the pages and served by the Worker', async () => {
  const { readdirSync, readFileSync } = await import('node:fs');
  assert.ok(readdirSync(new URL('../dist/pages/', import.meta.url)).includes('judges.js'), 'GitHub Pages carries judges.js');
  const client = readFileSync(new URL('../src/client.js', import.meta.url), 'utf8');
  for (const [, file] of client.matchAll(/from '\.\/([\w-]+\.js)'/g)) {
    assert.ok(readdirSync(new URL('../dist/pages/', import.meta.url)).includes(file), 'every module client.js imports is published: ' + file);
  }
  assert.match(readFileSync(new URL('../src/server.js', import.meta.url), 'utf8'), /'\/judges\.js'/);
});
