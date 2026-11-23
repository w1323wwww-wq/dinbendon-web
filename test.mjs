// Run: node test.mjs
import assert from 'node:assert/strict';
import { parseRpcResponse, unwrapToolResult, groupMenu, nextWeekDays, fmtTime, pkcePair } from './lib.js';

const sse = 'event: message\ndata: {"jsonrpc":"2.0","method":"notifications/progress"}\n\nevent: message\ndata: {"jsonrpc":"2.0","id":7,"result":{"ok":1}}\n\n';
assert.deepEqual(parseRpcResponse('text/event-stream', sse, 7).result, { ok: 1 });
assert.deepEqual(parseRpcResponse('application/json', '{"id":1,"result":{}}', 1).result, {});

assert.deepEqual(unwrapToolResult({ content: [{ type: 'text', text: '{"a":1}' }] }), { a: 1 });
assert.throws(() => unwrapToolResult({ isError: true, content: [{ type: 'text', text: '[ORDER_CLOSED] x' }] }), /ORDER_CLOSED/);

const g = groupMenu([
  { category: 'A', product: 'p1', variation: '吐司', price: 50 },
  { category: 'B', product: 'p2', price: 30 },
  { category: 'A', product: 'p1', variation: '漢堡', price: 50 },
]);
assert.equal(g.length, 2);
assert.equal(g[0].products[0].variants.length, 2);

// Mon 2026-11-23 10:00 Taipei → next week starts Mon 11-30
const w = nextWeekDays(new Date('2026-11-23T02:00:00Z'));
assert.equal(w[0].date, '2026-11-30');
assert.equal(w[0].weekday, '一');
assert.equal(w[6].date, '2026-12-06');
// Sun 23:30 Taipei → next week is the following Monday
assert.equal(nextWeekDays(new Date('2026-11-29T15:30:00Z'))[0].date, '2026-11-30');

assert.equal(fmtTime('2026-11-24T08:00:00+08:00'), '11/24（二）08:00');

const { verifier, challenge } = await pkcePair();
assert.match(verifier, /^[A-Za-z0-9_-]{43}$/);
assert.match(challenge, /^[A-Za-z0-9_-]{43}$/);

console.log('ok');
