import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as L from '../src/lib/returns-logic.ts';

const STORES = L.WIX_STORES_APP_ID;

const orderLines = [
  {
    _id: 'line-shirt',
    productName: { original: 'Home shirt' },
    catalogReference: { catalogItemId: 'prod-shirt', appId: STORES, options: { variantId: 'var-shirt-m' } },
    quantity: 2,
    price: { amount: '45.00' },
    physicalProperties: { sku: 'SH-M' },
    descriptionLines: [{ name: { original: 'Size' }, plainText: { original: 'M' } }],
  },
  {
    _id: 'line-scarf',
    productName: { original: 'Scarf' },
    catalogReference: { catalogItemId: 'prod-scarf', appId: STORES, options: { options: { Colour: 'Blue' } } },
    quantity: 1,
    price: { amount: '12.50' },
  },
];

const order = {
  _id: 'order-1',
  number: '10023',
  currency: 'GBP',
  buyerInfo: { contactId: 'contact-1', email: 'fan@example.com' },
  billingInfo: { address: { country: 'GB', city: 'Edinburgh' }, contactDetails: { firstName: 'Sam', lastName: 'Fan' } },
  shippingInfo: { logistics: { shippingDestination: { address: { country: 'GB', city: 'Glasgow' }, contactDetails: { firstName: 'Sam' } } } },
  lineItems: orderLines,
};

function draft(overrides = {}) {
  const items = orderLines.map(L.toReturnLine);
  items[0].quantity = 1;
  return { kind: 'RETURN', reason: 'Wrong size', items, exchangeItems: [], priceDifference: 0, postageCharge: 0, refundAmount: 45, ...overrides };
}

test('toReturnLine picks out variant, choices, options text and price', () => {
  const [shirt, scarf] = orderLines.map(L.toReturnLine);
  assert.equal(shirt.variantId, 'var-shirt-m');
  assert.equal(shirt.options, 'Size: M');
  assert.equal(shirt.unitPrice, 45);
  assert.equal(shirt.quantity, 0);
  assert.deepEqual(scarf.choices, { Colour: 'Blue' });
  assert.equal(scarf.variantId, '');
});

test('remainingQuantities subtracts live returns and ignores cancelled / the one being edited', () => {
  const existing = [
    { _id: 'r1', status: 'AWAITING_ITEM', items: [{ lineItemId: 'line-shirt', quantity: 1 }] },
    { _id: 'r2', status: 'CANCELLED', items: [{ lineItemId: 'line-shirt', quantity: 1 }] },
    { _id: 'r3', status: 'COMPLETED', items: [{ lineItemId: 'line-scarf', quantity: 5 }] },
  ];
  assert.deepEqual(L.remainingQuantities(orderLines, existing), { 'line-shirt': 1, 'line-scarf': 0 });
  assert.deepEqual(L.remainingQuantities(orderLines, existing, 'r1'), { 'line-shirt': 2, 'line-scarf': 0 });
});

test('money sums and suggestions', () => {
  assert.equal(L.creditValue([{ quantity: 3, unitPrice: 0.1 }]), 0.3);
  assert.equal(L.suggestedPriceDifference(45, 50), 5);
  assert.equal(L.suggestedPriceDifference(45, 40), 0);
  assert.equal(L.suggestedRefund('EXCHANGE', 45, 40), 5);
  assert.equal(L.suggestedRefund('EXCHANGE', 45, 50), 0);
  assert.equal(L.suggestedRefund('RETURN', 45, 0), 45);
  assert.equal(L.amountDue(5, 3.99), 8.99);
  assert.equal(L.amountDue(-2, 3), 3);
});

test('validateDraft catches the common mistakes', () => {
  const remaining = { 'line-shirt': 2, 'line-scarf': 1 };
  assert.deepEqual(L.validateDraft(draft(), remaining), []);

  const none = draft();
  none.items.forEach((i) => (i.quantity = 0));
  assert.match(L.validateDraft(none, remaining).join(), /at least one item/);

  const tooMany = draft();
  tooMany.items[1].quantity = 2;
  assert.match(L.validateDraft(tooMany, remaining).join(), /only 1 left/);

  assert.match(L.validateDraft(draft({ reason: ' ' }), remaining).join(), /reason/);
  assert.match(L.validateDraft(draft({ kind: 'EXCHANGE' }), remaining).join(), /replacement item/);
  assert.match(L.validateDraft(draft({ postageCharge: -1 }), remaining).join(), /Postage charge can't be negative/);
});

test('newRecord keeps only chosen lines and sets refund/payment state', () => {
  const ex = {
    catalogItemId: 'prod-shirt', appId: STORES, catalogOptions: { variantId: 'var-shirt-l' },
    name: 'Home shirt', options: 'Size: L', unitPrice: 45, quantity: 1,
  };
  const r = L.newRecord(
    { returnNumber: '10023-R1', orderId: 'order-1', orderNumber: '10023', customerName: 'Sam Fan', customerEmail: 'fan@example.com' },
    draft({ kind: 'EXCHANGE', exchangeItems: [ex], priceDifference: 0, postageCharge: 3.5, refundAmount: 0 }),
    new Date('2026-11-17T10:00:00Z'),
  );
  assert.equal(r.items.length, 1);
  assert.equal(r.creditValue, 45);
  assert.equal(r.status, 'AWAITING_ITEM');
  assert.equal(r.refundStatus, 'NONE');
  assert.equal(r.amountDue, 3.5);
  assert.equal(r.history[0].at, '2026-11-17T10:00:00.000Z');

  const plain = L.newRecord({ returnNumber: 'x', orderId: 'o', orderNumber: '1', customerName: '', customerEmail: '' },
    draft({ exchangeItems: [ex], postageCharge: 9 }));
  assert.equal(plain.exchangeItems.length, 0, 'returns never carry exchange items');
  assert.equal(plain.amountDue, 0);
  assert.equal(plain.refundStatus, 'DUE');
});

test('status transitions', () => {
  assert.deepEqual(L.allowedTransitions({ status: 'AWAITING_ITEM' }), ['RECEIVED', 'CANCELLED']);
  assert.deepEqual(L.allowedTransitions({ status: 'RECEIVED' }), ['COMPLETED']);
  assert.deepEqual(L.allowedTransitions({ status: 'COMPLETED' }), []);
});

test('markReceived clamps restock quantities; restockPlan skips done, zero and non-Stores lines', () => {
  const base = L.newRecord({ returnNumber: 'x', orderId: 'o', orderNumber: '1', customerName: '', customerEmail: '' },
    draft({ items: orderLines.map((l) => ({ ...L.toReturnLine(l), quantity: 1 })) }));
  base.items.push({ ...base.items[0], lineItemId: 'line-gift', appId: 'some-other-app', quantity: 1 });

  const r = L.markReceived(base, { 'line-shirt': 5, 'line-scarf': 0, 'line-gift': 1 });
  assert.equal(r.status, 'RECEIVED');
  assert.equal(r.items[0].restockQty, 1, 'clamped to quantity returned');
  assert.equal(r.items[1].restockQty, 0);
  const plan = L.restockPlan(r.items);
  assert.deepEqual(plan.map((p) => p.lineItemId), ['line-shirt']);

  r.items[0].restocked = true;
  assert.equal(L.restockPlan(r.items).length, 0);
});

test('inventory payloads for V1 and V3 catalogs', () => {
  const targets = [
    { lineItemId: 'a', productId: 'p1', variantId: 'v1', choices: {}, qty: 2 },
    { lineItemId: 'b', productId: 'p2', variantId: '', choices: { Colour: 'Blue' }, qty: 1 },
  ];
  assert.deepEqual(L.v1IncrementData(targets), [
    { productId: 'p1', variantId: 'v1', incrementBy: 2 },
    { productId: 'p2', variantId: L.V1_DEFAULT_VARIANT_ID, incrementBy: 1 },
  ]);
  assert.deepEqual(L.v3IncrementData(targets), [{ productId: 'p1', variantId: 'v1', incrementBy: 2 }]);
});

test('buildExchangeDraft prices replacements at 0 and carries charges as applied fees', () => {
  const r = {
    returnNumber: '10023-R1',
    priceDifference: 5,
    postageCharge: 0,
    exchangeItems: [{ catalogItemId: 'prod-shirt', appId: STORES, catalogOptions: { variantId: 'var-l' }, name: 'Shirt', options: '', unitPrice: 50, quantity: 1 }],
  };
  const { draftOrder } = L.buildExchangeDraft(order, r);
  assert.deepEqual(draftOrder.catalogLineItems, [
    { catalogReference: { catalogItemId: 'prod-shirt', appId: STORES, options: { variantId: 'var-l' } }, quantity: 1, price: { amount: '0' } },
  ]);
  assert.deepEqual(draftOrder.additionalFees, [
    { name: 'Exchange price difference (10023-R1)', price: { amount: '5.00' }, applyToDraftOrder: true },
  ]);
  assert.equal(draftOrder.recipientInfo.address.city, 'Glasgow');
  assert.equal(draftOrder.billingInfo.address.city, 'Edinburgh');
  assert.deepEqual(draftOrder.buyerInfo, { contactId: 'contact-1', email: 'fan@example.com' });

  const free = L.buildExchangeDraft({ ...order, shippingInfo: null }, { ...r, priceDifference: 0 }).draftOrder;
  assert.equal(free.additionalFees, undefined);
  assert.equal(free.recipientInfo.address.city, 'Edinburgh', 'falls back to billing address');
  for (const f of L.buildExchangeDraft(order, { ...r, returnNumber: 'X'.repeat(80), postageCharge: 1 }).draftOrder.additionalFees)
    assert.ok(f.name.length <= 50, 'Wix limits fee names to 50 chars');
});

test('customerName and nextReturnNumber', () => {
  assert.equal(L.customerName(order), 'Sam Fan');
  assert.equal(L.nextReturnNumber('10023', 2), '10023-R3');
});
