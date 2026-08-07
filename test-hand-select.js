'use strict';
/**
 * Unit checks for HandSelect (SelectionModel + peek constants).
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const src = fs.readFileSync(path.join(__dirname, 'public', 'hand-select.js'), 'utf8');
const sandbox = { window: {}, globalThis: {} };
sandbox.window = sandbox;
sandbox.globalThis = sandbox;
vm.runInNewContext(src, sandbox);
const HS = sandbox.HandSelect;
assert.ok(HS, 'HandSelect exported');
assert.ok(HS.PEEK >= 28, `PEEK must show rank+suit, got ${HS.PEEK}`);
assert.strictEqual(typeof HS.layout, 'function');
assert.strictEqual(typeof HS.bind, 'function');
assert.strictEqual(typeof HS.paint, 'function');
assert.ok(String(src).includes('handcard'), 'hits handcard');
assert.ok(!/toggleColumn|applyCol/.test(src) || src.includes('toggleMany'), 'per-card selection');

const m = HS.SelectionModel([]);
m.toggle('a');
assert.strictEqual(JSON.stringify(m.get()), JSON.stringify(['a']));
m.toggle('a');
assert.strictEqual(JSON.stringify(m.get()), JSON.stringify([]));
m.set(['x', 'y']);
m.toggleMany(['x', 'y', 'z']);
assert.strictEqual(JSON.stringify([...m.get()].sort()), JSON.stringify(['x', 'y', 'z']));
m.toggleMany(['x', 'y', 'z']);
assert.strictEqual(JSON.stringify(m.get()), JSON.stringify([]));

console.log('OK hand-select module');
console.log('test-hand-select OK');
