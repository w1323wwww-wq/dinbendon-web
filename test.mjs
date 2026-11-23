// Run: node test.mjs
import assert from 'node:assert/strict';
import { weekRange, summarize, formatSettlement, chunk } from './worker/settle.js';
import { flattenMenu, groupMenu, buildAddItemBody, myLines, nextWeekDays, toExpireDate, fmtTime } from './lib.js';

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
  { originator: '週一早餐', shopName: '弘爺', lastExpireDate: Date.parse('2026-11-23T00:00:00Z'), items: [
    { buyerName: 'Mao', price: 30, calculatedPrice: 30, paid: false }, { buyerName: 'ian', price: 70, calculatedPrice: 60, paid: true }] },
  { originator: '週二早餐', shopName: '弘爺', lastExpireDate: Date.parse('2026-11-24T00:00:00Z'), items: [
    { buyerName: 'Mao', price: 50, calculatedPrice: 50, paid: true }] },
];
const sum = summarize(orders);
assert.equal(sum.total, 140);
assert.deepEqual(sum.people.map(p => [p.name, p.total, p.unpaid]), [['Mao', 80, 30], ['ian', 60, 0]]);
const text = formatSettlement(wr, orders, sum);
assert.match(text, /11\/23（一） – 11\/29（日）/);
assert.match(text, /Mao：\*\*\$30\*\*（共 \$80，已付 \$50）/);
assert.match(text, /ian：\$60（已付清）/);
assert.match(text, /合計 \$140，未收 \$30/);
assert.match(formatSettlement(wr, [], summarize([])), /本週沒有訂單/);
const parts = chunk(Array.from({ length: 300 }, (_, i) => `line ${i} xxxxxxxxxx`).join('\n'));
assert.ok(parts.length > 1 && parts.every(p => p.length <= 1900));

console.log('ok');
