// Pure returns/exchanges rules. No Wix imports, so it can be unit-tested locally
// (node --test runs this file directly: keep to type-strippable TypeScript, no enums).

export const WIX_STORES_APP_ID = '215238eb-22a5-4c36-9e7b-e7c08025e04e';
export const V1_DEFAULT_VARIANT_ID = '00000000-0000-0000-0000-000000000000';

export type ReturnKind = 'RETURN' | 'EXCHANGE';
export type ReturnStatus = 'AWAITING_ITEM' | 'RECEIVED' | 'COMPLETED' | 'CANCELLED';
export type RefundStatus = 'NONE' | 'DUE' | 'DONE';
export type PaymentStatus = 'NONE' | 'UNPAID' | 'PAID' | 'EXPIRED' | 'VOIDED';
export type CatalogVersion = 'V1_CATALOG' | 'V3_CATALOG' | 'STORES_NOT_INSTALLED';

export const STATUS_LABELS: Record<ReturnStatus, string> = {
  AWAITING_ITEM: 'Awaiting item',
  RECEIVED: 'Received',
  COMPLETED: 'Completed',
  CANCELLED: 'Cancelled',
};

export const REASONS = [
  'Wrong size',
  'Changed mind',
  'Faulty / damaged',
  'Wrong item sent',
  'Not as described',
  'Other',
];

/** An item coming back from the customer (one per original order line). */
export interface ReturnLine {
  lineItemId: string;
  name: string;
  options: string;
  sku: string;
  catalogItemId: string;
  appId: string;
  variantId: string;
  /** V1 catalogs without managed variants identify the variant by its choices. */
  choices: Record<string, string>;
  quantity: number;
  unitPrice: number;
  /** How many of `quantity` go back into stock (set when the item is received). */
  restockQty: number;
  restocked: boolean;
}

/** A replacement item sent out on an exchange. */
export interface ExchangeLine {
  catalogItemId: string;
  appId: string;
  /** Ready-made catalogReference.options for the draft order. */
  catalogOptions: Record<string, unknown>;
  name: string;
  options: string;
  unitPrice: number;
  quantity: number;
}

export interface HistoryEntry {
  at: string;
  text: string;
}

export interface ReturnRecord {
  _id?: string;
  returnNumber: string;
  orderId: string;
  orderNumber: string;
  customerName: string;
  customerEmail: string;
  kind: ReturnKind;
  status: ReturnStatus;
  reason: string;
  notes: string;
  items: ReturnLine[];
  creditValue: number;
  refundStatus: RefundStatus;
  refundAmount: number;
  exchangeItems: ExchangeLine[];
  priceDifference: number;
  postageCharge: number;
  amountDue: number;
  exchangeOrderId: string;
  exchangeOrderNumber: string;
  paymentRequestId: string;
  paymentRequestUrl: string;
  paymentStatus: PaymentStatus;
  receivedDate: string;
  history: HistoryEntry[];
}

/** Minimal view of a Wix eCommerce order line, as the logic needs it. */
export interface OrderLineLike {
  _id?: string;
  productName?: { original?: string };
  catalogReference?: { catalogItemId?: string; appId?: string; options?: Record<string, any> | null };
  quantity?: number;
  price?: { amount?: string };
  physicalProperties?: { sku?: string | null } | null;
  descriptionLines?: Array<{
    name?: { original?: string };
    plainText?: { original?: string };
    colorInfo?: { original?: string };
  }>;
}

export function money(n: number): number {
  return Math.round((Number(n) || 0) * 100) / 100;
}

export function formatMoney(n: number, currency = 'GBP'): string {
  try {
    return new Intl.NumberFormat('en-GB', { style: 'currency', currency }).format(money(n));
  } catch {
    return money(n).toFixed(2);
  }
}

export function describeOptions(line: OrderLineLike): string {
  return (line.descriptionLines ?? [])
    .map((d) => {
      const name = d.name?.original ?? '';
      const value = d.plainText?.original ?? d.colorInfo?.original ?? '';
      return name && value ? `${name}: ${value}` : name || value;
    })
    .filter(Boolean)
    .join(', ');
}

/** Turns an order line into a return line with nothing selected yet. */
export function toReturnLine(line: OrderLineLike): ReturnLine {
  const opts = line.catalogReference?.options ?? {};
  return {
    lineItemId: line._id ?? '',
    name: line.productName?.original ?? 'Item',
    options: describeOptions(line),
    sku: line.physicalProperties?.sku ?? '',
    catalogItemId: line.catalogReference?.catalogItemId ?? '',
    appId: line.catalogReference?.appId ?? '',
    variantId: typeof opts.variantId === 'string' ? opts.variantId : '',
    choices: opts.options && typeof opts.options === 'object' ? { ...opts.options } : {},
    quantity: 0,
    unitPrice: money(Number(line.price?.amount ?? 0)),
    restockQty: 0,
    restocked: false,
  };
}

/**
 * Quantity of each order line still available to return: ordered minus what is
 * already on other (non-cancelled) returns for the same order.
 */
export function remainingQuantities(
  lines: OrderLineLike[],
  existing: Pick<ReturnRecord, '_id' | 'status' | 'items'>[],
  excludeReturnId?: string,
): Record<string, number> {
  const remaining: Record<string, number> = {};
  for (const l of lines) if (l._id) remaining[l._id] = l.quantity ?? 0;
  for (const r of existing) {
    if (r.status === 'CANCELLED' || (excludeReturnId && r._id === excludeReturnId)) continue;
    for (const it of r.items ?? []) {
      if (it.lineItemId in remaining) remaining[it.lineItemId] -= it.quantity;
    }
  }
  for (const k of Object.keys(remaining)) remaining[k] = Math.max(0, remaining[k]);
  return remaining;
}

export function creditValue(items: Pick<ReturnLine, 'quantity' | 'unitPrice'>[]): number {
  return money(items.reduce((s, i) => s + i.quantity * i.unitPrice, 0));
}

export function exchangeValue(items: Pick<ExchangeLine, 'quantity' | 'unitPrice'>[]): number {
  return money(items.reduce((s, i) => s + i.quantity * i.unitPrice, 0));
}

/** What the customer should pay extra for the replacement products (never negative). */
export function suggestedPriceDifference(credit: number, exchange: number): number {
  return money(Math.max(0, exchange - credit));
}

/** What the business owes back. Returns: full credit. Exchanges: any credit left after the replacements. */
export function suggestedRefund(kind: ReturnKind, credit: number, exchange: number): number {
  return kind === 'RETURN' ? money(credit) : money(Math.max(0, credit - exchange));
}

export function amountDue(priceDifference: number, postageCharge: number): number {
  return money(Math.max(0, priceDifference) + Math.max(0, postageCharge));
}

export function nextReturnNumber(orderNumber: string, existingCount: number): string {
  return `${orderNumber}-R${existingCount + 1}`;
}

export interface DraftInput {
  kind: ReturnKind;
  reason: string;
  items: ReturnLine[];
  exchangeItems: ExchangeLine[];
  priceDifference: number;
  postageCharge: number;
  refundAmount: number;
}

export function validateDraft(d: DraftInput, remaining: Record<string, number>): string[] {
  const errors: string[] = [];
  const chosen = d.items.filter((i) => i.quantity > 0);
  if (chosen.length === 0) errors.push('Choose at least one item coming back.');
  for (const i of chosen) {
    const max = remaining[i.lineItemId] ?? 0;
    if (!Number.isInteger(i.quantity) || i.quantity < 0) errors.push(`${i.name}: quantity must be a whole number.`);
    else if (i.quantity > max) errors.push(`${i.name}: only ${max} left to return on this order.`);
  }
  if (!d.reason.trim()) errors.push('Pick a reason.');
  if (d.kind === 'EXCHANGE') {
    const out = d.exchangeItems.filter((e) => e.quantity > 0);
    if (out.length === 0) errors.push('Add at least one replacement item for an exchange.');
    for (const e of out) {
      if (!e.catalogItemId) errors.push(`${e.name}: pick a product from the catalogue.`);
      if (!Number.isInteger(e.quantity)) errors.push(`${e.name}: quantity must be a whole number.`);
    }
  }
  for (const [label, v] of [
    ['Price difference', d.priceDifference],
    ['Postage charge', d.postageCharge],
    ['Refund amount', d.refundAmount],
  ] as const) {
    if (!Number.isFinite(v) || v < 0) errors.push(`${label} can't be negative.`);
  }
  return errors;
}

export function newRecord(
  base: Pick<ReturnRecord, 'returnNumber' | 'orderId' | 'orderNumber' | 'customerName' | 'customerEmail'>,
  d: DraftInput,
  now = new Date(),
): ReturnRecord {
  const items = d.items.filter((i) => i.quantity > 0).map((i) => ({ ...i, restockQty: 0, restocked: false }));
  const exchangeItems = d.kind === 'EXCHANGE' ? d.exchangeItems.filter((e) => e.quantity > 0) : [];
  const credit = creditValue(items);
  const priceDifference = d.kind === 'EXCHANGE' ? money(d.priceDifference) : 0;
  const postageCharge = d.kind === 'EXCHANGE' ? money(d.postageCharge) : 0;
  const refundAmount = money(d.refundAmount);
  return {
    ...base,
    kind: d.kind,
    status: 'AWAITING_ITEM',
    reason: d.reason,
    notes: '',
    items,
    creditValue: credit,
    refundStatus: refundAmount > 0 ? 'DUE' : 'NONE',
    refundAmount,
    exchangeItems,
    priceDifference,
    postageCharge,
    amountDue: amountDue(priceDifference, postageCharge),
    exchangeOrderId: '',
    exchangeOrderNumber: '',
    paymentRequestId: '',
    paymentRequestUrl: '',
    paymentStatus: 'NONE',
    receivedDate: '',
    history: [{ at: now.toISOString(), text: `${d.kind === 'EXCHANGE' ? 'Exchange' : 'Return'} logged (${d.reason}).` }],
  };
}

export function withHistory<T extends { history: HistoryEntry[] }>(r: T, text: string, now = new Date()): T {
  return { ...r, history: [...(r.history ?? []), { at: now.toISOString(), text }] };
}

/** Which status changes the UI offers from each status. */
export function allowedTransitions(r: Pick<ReturnRecord, 'status'>): ReturnStatus[] {
  switch (r.status) {
    case 'AWAITING_ITEM':
      return ['RECEIVED', 'CANCELLED'];
    case 'RECEIVED':
      return ['COMPLETED', 'CANCELLED'];
    case 'COMPLETED':
    case 'CANCELLED':
      return [];
  }
}

/** Where "Reopen" takes a completed or cancelled return (null = can't reopen). */
export function reopenStatus(r: Pick<ReturnRecord, 'status' | 'receivedDate'>): ReturnStatus | null {
  if (r.status === 'COMPLETED') return 'RECEIVED';
  if (r.status === 'CANCELLED') return r.receivedDate ? 'RECEIVED' : 'AWAITING_ITEM';
  return null;
}

/**
 * What stands in the way of completing a return.
 * `blockers` must be fixed first; `warnings` can be overridden on purpose.
 */
export function completionCheck(
  r: Pick<ReturnRecord, 'kind' | 'status' | 'exchangeOrderId' | 'amountDue' | 'paymentStatus' | 'refundStatus' | 'items'>,
): { blockers: string[]; warnings: string[] } {
  const blockers: string[] = [];
  const warnings: string[] = [];
  if (r.status !== 'RECEIVED') blockers.push('The item has to be marked received first.');
  if (r.kind === 'EXCHANGE' && !r.exchangeOrderId) blockers.push('The replacement order hasn\'t been created.');
  if (r.kind === 'EXCHANGE' && r.amountDue > 0 && r.paymentStatus !== 'PAID') warnings.push('The customer hasn\'t paid the exchange charge.');
  if (r.refundStatus === 'DUE') warnings.push('A refund is still marked as owed.');
  if (r.items.some((i) => i.restockQty > 0 && !i.restocked)) warnings.push('Some items haven\'t been restocked.');
  return { blockers, warnings };
}

export interface ReturnEdit {
  reason: string;
  refundAmount: number;
  priceDifference: number;
  postageCharge: number;
  /** Only applied while no replacement order exists. */
  exchangeItems: ExchangeLine[];
}

/** Which parts of a return can still be edited. */
export function editability(r: Pick<ReturnRecord, 'kind' | 'status' | 'exchangeOrderId' | 'paymentRequestId'>) {
  const open = r.status === 'AWAITING_ITEM' || r.status === 'RECEIVED';
  const exchangeOpen = open && r.kind === 'EXCHANGE' && !r.exchangeOrderId;
  return {
    any: open,
    reason: open,
    refund: open,
    // Charges feed the replacement order's fees and the payment link, so they're fixed once a link exists.
    charges: open && r.kind === 'EXCHANGE' && !r.paymentRequestId,
    replacementItems: exchangeOpen,
  };
}

/** Applies an edit and records what changed in the history. Returns the record unchanged if nothing did. */
export function applyEdit(r: ReturnRecord, e: ReturnEdit, now = new Date()): ReturnRecord {
  const can = editability(r);
  const changes: string[] = [];
  let next: ReturnRecord = { ...r };

  if (can.reason && e.reason.trim() && e.reason !== r.reason) {
    changes.push(`reason "${r.reason}" → "${e.reason}"`);
    next.reason = e.reason;
  }
  if (can.refund && money(e.refundAmount) !== money(r.refundAmount)) {
    changes.push(`refund ${money(r.refundAmount).toFixed(2)} → ${money(e.refundAmount).toFixed(2)}`);
    next.refundAmount = money(e.refundAmount);
    if (next.refundStatus !== 'DONE') next.refundStatus = next.refundAmount > 0 ? 'DUE' : 'NONE';
  }
  if (can.charges) {
    if (money(e.priceDifference) !== money(r.priceDifference)) {
      changes.push(`price difference ${money(r.priceDifference).toFixed(2)} → ${money(e.priceDifference).toFixed(2)}`);
      next.priceDifference = money(e.priceDifference);
    }
    if (money(e.postageCharge) !== money(r.postageCharge)) {
      changes.push(`postage ${money(r.postageCharge).toFixed(2)} → ${money(e.postageCharge).toFixed(2)}`);
      next.postageCharge = money(e.postageCharge);
    }
    next.amountDue = amountDue(next.priceDifference, next.postageCharge);
  }
  if (can.replacementItems) {
    const items = e.exchangeItems.filter((x) => x.quantity > 0);
    const describe = (xs: ExchangeLine[]) => xs.map((x) => `${x.quantity}× ${x.name}${x.options ? ` (${x.options})` : ''}`).join(', ') || 'none';
    if (describe(items) !== describe(r.exchangeItems)) {
      changes.push(`replacements: ${describe(items)}`);
      next.exchangeItems = items;
    }
  }
  if (changes.length === 0) return r;
  next = withHistory(next, `Edited: ${changes.join('; ')}.`, now);
  return next;
}

/**
 * Applies the "received" step: records how many of each line go back to stock.
 * `restockQtyByLine` maps lineItemId -> qty to restock (clamped to 0..quantity).
 */
export function markReceived(r: ReturnRecord, restockQtyByLine: Record<string, number>, now = new Date()): ReturnRecord {
  const items = r.items.map((i) => {
    const q = Math.floor(Number(restockQtyByLine[i.lineItemId] ?? 0));
    return { ...i, restockQty: Math.min(i.quantity, Math.max(0, q)) };
  });
  const toStock = items.reduce((s, i) => s + i.restockQty, 0);
  return withHistory(
    { ...r, items, status: 'RECEIVED', receivedDate: now.toISOString() },
    `Item(s) received. ${toStock} unit(s) to go back to stock.`,
    now,
  );
}

export interface RestockTarget {
  lineItemId: string;
  productId: string;
  variantId: string;
  choices: Record<string, string>;
  qty: number;
}

/** Lines that still need stock adding (Wix Stores items only, not yet restocked). */
export function restockPlan(items: ReturnLine[]): RestockTarget[] {
  return items
    .filter((i) => !i.restocked && i.restockQty > 0 && i.appId === WIX_STORES_APP_ID && i.catalogItemId)
    .map((i) => ({
      lineItemId: i.lineItemId,
      productId: i.catalogItemId,
      variantId: i.variantId,
      choices: i.choices,
      qty: i.restockQty,
    }));
}

/** Payload for stores `inventory.incrementInventory` (V1 catalog). */
export function v1IncrementData(targets: RestockTarget[]) {
  return targets.map((t) => ({
    productId: t.productId,
    variantId: t.variantId || V1_DEFAULT_VARIANT_ID,
    incrementBy: t.qty,
  }));
}

/** Payload for stores `inventoryItemsV3.bulkIncrementInventoryItemsByVariantAndLocation` (V3 catalog). */
export function v3IncrementData(targets: RestockTarget[]) {
  return targets
    .filter((t) => t.variantId)
    .map((t) => ({ productId: t.productId, variantId: t.variantId, incrementBy: t.qty }));
}

interface AddressWithContactLike {
  address?: Record<string, unknown> | null;
  contactDetails?: Record<string, unknown> | null;
}

export interface OrderLike {
  _id?: string;
  number?: string;
  currency?: string;
  buyerInfo?: { contactId?: string | null; email?: string | null } | null;
  billingInfo?: AddressWithContactLike | null;
  shippingInfo?: { title?: string; logistics?: { shippingDestination?: AddressWithContactLike | null } | null } | null;
  lineItems?: OrderLineLike[];
}

function cleanAddress(a?: AddressWithContactLike | null) {
  if (!a?.address) return undefined;
  return { address: a.address, contactDetails: a.contactDetails ?? undefined };
}

/**
 * Options for draftOrders.createDraftOrder building the replacement order.
 * Replacement products are priced at 0 so stock and fulfilment work as normal;
 * money owed is carried by two applied fees (price difference, postage).
 */
export function buildExchangeDraft(order: OrderLike, r: Pick<ReturnRecord, 'returnNumber' | 'exchangeItems' | 'priceDifference' | 'postageCharge'>) {
  const fees = [] as Array<{ name: string; price: { amount: string }; applyToDraftOrder: boolean }>;
  if (r.priceDifference > 0)
    fees.push({ name: `Exchange price difference (${r.returnNumber})`.slice(0, 50), price: { amount: money(r.priceDifference).toFixed(2) }, applyToDraftOrder: true });
  if (r.postageCharge > 0)
    fees.push({ name: `Exchange postage (${r.returnNumber})`.slice(0, 50), price: { amount: money(r.postageCharge).toFixed(2) }, applyToDraftOrder: true });

  const shipTo = cleanAddress(order.shippingInfo?.logistics?.shippingDestination) ?? cleanAddress(order.billingInfo);
  const billTo = cleanAddress(order.billingInfo) ?? shipTo;
  return {
    draftOrder: {
      catalogLineItems: r.exchangeItems.map((e) => ({
        catalogReference: { catalogItemId: e.catalogItemId, appId: e.appId, options: e.catalogOptions },
        quantity: e.quantity,
        price: { amount: '0' },
      })),
      buyerInfo: {
        ...(order.buyerInfo?.contactId ? { contactId: order.buyerInfo.contactId } : {}),
        ...(order.buyerInfo?.email ? { email: order.buyerInfo.email } : {}),
      },
      ...(shipTo ? { recipientInfo: shipTo } : {}),
      ...(billTo ? { billingInfo: billTo } : {}),
      ...(fees.length ? { additionalFees: fees } : {}),
    },
  };
}

export function customerName(order: OrderLike): string {
  const c = (order.billingInfo?.contactDetails ?? order.shippingInfo?.logistics?.shippingDestination?.contactDetails ?? {}) as {
    firstName?: string;
    lastName?: string;
  };
  return [c.firstName, c.lastName].filter(Boolean).join(' ');
}
