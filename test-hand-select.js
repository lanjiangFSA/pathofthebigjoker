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
assert.ok(String(src).includes('card-top'), 'horizontal card-top');
assert.ok(String(src).includes('joker-big') && String(src).includes('joker-small'), 'joker styles');
assert.ok(String(src).includes('style.top'), 'stack by top so header peeks');
assert.ok(!String(src).includes("bottom = `${i * PEEK}`"), 'must not cover tops via bottom stack');
assert.strictEqual(typeof HS.layout, 'function');
assert.strictEqual(typeof HS.bind, 'function');
assert.ok(String(src).includes('layoutMetrics') || String(src).includes('--hand-peek'), 'css peek metrics');
assert.ok(String(src).includes('Math.floor(rel / peek)') || String(src).includes('rel / peek'), 'peek-index hit test');



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
