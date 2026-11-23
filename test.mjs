// Run: node test.mjs
import assert from 'node:assert/strict';
import { weekRange, summarize, formatSettlement, chunk } from './worker/settle.js';
import { flattenMenu, groupMenu, buildAddItemBody, myLines, nextWeekDays, toExpireDate, fmtTime, addHistory, matchHistory, shopOrderText } from './lib.js';

// Shape recorded from dinbendon /order/{id}/get-add-item
const data = {
  shop: {
    revisionNo: 30,
    categories: [
      { name: '冬季限定', defined: true, products: [{ id: 1, name: '玉米濃湯', variations: [{ id: 11, name: '', price: 45 }] }] },
      { name: '經典系列', defined: true, products: [{ id: 2, name: '日式豬排蛋', variations: [{ id: 21, name: '吐司', price: 100 }, { id: 22, name: '漢堡', price: 100 }] }] },
      { name: '', defined: false, products: [{ id: 3, name: '薯條', variations: [{ id: 31, name: '', price: 35 }] }] },
    ],
  },
};
const rows = flattenMenu(data);
assert.equal(rows.length, 4);
assert.equal(rows[3].categoryName, null);
const g = groupMenu(rows);
assert.equal(g.length, 3);
assert.equal(g[1].products[0].variants.length, 2);

const body = buildAddItemBody(data, rows, new Map([['2:22', { qty: 2, note: ' 不要醬 ' }], ['1:11', { qty: 1, note: '' }]]), ' 小明 ');
assert.deepEqual(body.addProducts[0], { productId: 2, variationId: 22, qty: 2, comment: '不要醬', categoryName: '經典系列', productName: '日式豬排蛋', variationName: '漢堡', price: 100 });
assert.equal(body.addProducts[1].comment, null);
assert.equal(body.playedName, '小明');
assert.equal(body.shopRevisionNo, 30);
assert.throws(() => buildAddItemBody(data, rows, new Map(), '小明'), /還沒選/);
assert.throws(() => buildAddItemBody(data, rows, new Map([['1:11', { qty: 1 }]]), ' '), /名字/);
assert.throws(() => buildAddItemBody(data, rows, new Map([['9:9', { qty: 1 }]]), 'a'), /菜單已變更/);

// Shape recorded from /order/{id}/expand-for-buyer
const lines = myLines([
  { id: 1, buyerName: 'Mao', productFullName: '蔥抓餅加蛋', comment: '不要醬油', price: 50, paid: false, buyer: true },
  { id: 2, buyerName: 'Mao', productFullName: '蔥抓餅加蛋', comment: '不要醬油', price: 50, paid: true, buyer: true },
  { id: 3, buyerName: 'Bob', productFullName: '薯條', comment: null, price: 35, paid: false, buyer: false },
]);
assert.equal(lines.length, 1);
assert.deepEqual([lines[0].ids, lines[0].paidIds], [[1], [2]]);
const byName = myLines([{ id: 3, buyerName: 'Bob', productFullName: '薯條', comment: null, price: 35, paid: false, buyer: false }], 'Bob');
assert.deepEqual([byName.length, byName[0].ids, byName[0].otherIds], [1, [], [3]]);

const w = nextWeekDays(new Date('2026-11-23T02:00:00Z')); // Mon 10:00 Taipei
assert.equal(w[0].date, '2026-11-30');
assert.equal(w[6].date, '2026-12-06');
assert.equal(nextWeekDays(new Date('2026-11-29T15:30:00Z'))[0].date, '2026-11-30'); // Sun 23:30 Taipei

assert.equal(toExpireDate('2026-12-01', '08:00'), '20261201 0800');
assert.equal(fmtTime(1795478400000), '11/24（二）08:00');

// Settlement: Fri 2026-11-27 12:00 Taipei → week Mon 11/23 00:00 .. Mon 11/30 00:00 Taipei
const wr = weekRange(Date.parse('2026-11-27T04:00:00Z'));
assert.equal(new Date(wr.start).toISOString(), '2026-11-22T16:00:00.000Z');
assert.equal(wr.end - wr.start, 7 * 86400e3);
assert.equal(weekRange(Date.parse('2026-11-22T16:00:00Z')).start, wr.start); // Mon 00:00 itself
const orders = [
  { items: [{ buyerName: 'Mao', price: 30, calculatedPrice: 30 }, { buyerName: 'Ian', price: 70, calculatedPrice: 60 }, { buyerName: 'Ian', price: 40, calculatedPrice: 40 }] },
  { items: [{ buyerName: 'Mao', price: 50, calculatedPrice: 50 }] },
  { items: [{ buyerName: 'u', price: 30 }] },
];
const people = summarize(orders);
assert.deepEqual(people.map(p => [p.name, p.parts, p.total]), [['Ian', [100], 100], ['Mao', [30, 50], 80], ['u', [30], 30]]);
assert.equal(formatSettlement(people), '周杰\nIan: 100\nMao: 30 + 50 = 80\nu: 30');
assert.equal(formatSettlement([]), '周杰\n本週沒有訂單');
const parts = chunk(Array.from({ length: 300 }, (_, i) => `line ${i} xxxxxxxxxx`).join('\n'));
assert.ok(parts.length > 1 && parts.every(p => p.length <= 1900));

// 再買一次
let hist = addHistory([], rows, new Map([['2:22', { qty: 2, note: '不要醬' }]]));
hist = addHistory(hist, rows, new Map([['1:11', { qty: 1, note: '' }], ['2:22', { qty: 1, note: '不要醬' }]]));
assert.deepEqual(hist.map(h => h.product + h.variation + h.note), ['玉米濃湯', '日式豬排蛋漢堡不要醬']);
const m = matchHistory([...hist, { product: '已下架', variation: '', note: '' }], rows);
assert.deepEqual(m.map(h => h.row.key), ['1:11', '2:22']);

// 給早餐店
const shopItems = [
  { buyerName: 'Mao', productFullName: '紅茶(M冰)', comment: '微糖', price: 20 },
  { buyerName: 'ian', productFullName: '日式豬排蛋(漢堡)', comment: null, price: 100 },
  { buyerName: 'Mao', productFullName: '日式豬排蛋(漢堡)', comment: null, price: 100 },
  { buyerName: 'Bob', productFullName: '紅茶(M冰)', comment: null, price: 20, calculatedPrice: 15 },
];
assert.equal(shopOrderText(shopItems, { title: '週三早餐' }), '週三早餐\n1. 紅茶(M冰) ×1（微糖）\n2. 日式豬排蛋(漢堡) ×2\n3. 紅茶(M冰) ×1\n共 4 份，$235');
assert.match(shopOrderText(shopItems, { withNames: true }), /日式豬排蛋\(漢堡\) ×2　ian、Mao/);

console.log('ok');
