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
assert.strictEqual(typeof HS.fitColumns, 'function', 'fitColumns export');
assert.ok(HS.fitColumns(8, 320).rows === 1, '8 cols fit one row');
assert.ok(HS.fitColumns(16, 200).rows === 2, 'many cols wrap to two rows');
assert.ok(HS.fitColumns(16, 900).rows === 1, 'wide desktop stays one row');
assert.ok(HS.fitColumns(16, 900).colW > 40, 'wide desktop grows columns past mobile max');
assert.ok(String(src).includes('hand-rows-2'), 'two-row class toggle');
assert.ok(String(src).includes('MAX_COL_W_WIDE'), 'wide max constant');
assert.ok(String(src).includes("removeProperty('--hand-peek')"), 'strip inline peek before metrics');
assert.ok(String(src).includes("removeProperty('--hand-card-h')"), 'strip inline cardH before metrics');
assert.ok(String(src).includes('Math.min(1,') || String(src).includes('hScale'), 'height scale does not grow above CSS base');



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
