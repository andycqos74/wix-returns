// Every Wix API call the returns screens make. UI code calls these, never the SDKs directly.
import { orders, draftOrders, orderPaymentRequests } from '@wix/ecom';
import { catalogVersioning, inventory, inventoryItemsV3, products, productsV3, readOnlyVariantsV3 } from '@wix/stores';
import { items } from '@wix/data';
import { PAYMENT_LINK_EXPIRY_DAYS, RETURNS_COLLECTION_ID } from './config';
import {
  WIX_STORES_APP_ID,
  type CatalogVersion,
  type OrderLike,
  type ReturnRecord,
  buildExchangeDraft,
  markReceived,
  restockPlan,
  v1IncrementData,
  v3IncrementData,
  withHistory,
} from './returns-logic';

type Stored = ReturnRecord & { _id: string; _createdDate?: Date };

/** Permission scope each Wix call needs (add in the app dashboard: Develop > Permissions). */
export const SCOPE_FOR_METHOD: Record<string, string> = {
  'catalogVersioning.getCatalogVersion': 'SCOPE.STORES.CATALOG_READ_LIMITED',
  'productsV3.searchProducts': 'SCOPE.STORES.PRODUCT_READ (hidden products: SCOPE.STORES.PRODUCT_READ_ADMIN)',
  'readOnlyVariantsV3.queryVariants': 'SCOPE.STORES.PRODUCT_READ',
  'inventoryItemsV3.bulkIncrementInventoryItemsByVariantAndLocation': 'SCOPE.STORES.INVENTORY_ITEM_WRITE',
  'products.queryProducts': 'SCOPE.DC-STORES.READ-PRODUCTS',
  'products.getProduct': 'SCOPE.DC-STORES.READ-PRODUCTS',
  'inventory.incrementInventory': 'SCOPE.DC-STORES.MANAGE-PRODUCTS',
  'orders.getOrder': 'SCOPE.DC-ECOM-MEGA.MANAGE-ECOM',
  'draftOrders.createDraftOrder': 'SCOPE.ECOM.DRAFT-ORDERS',
  'draftOrders.createOrderFromDraft': 'SCOPE.ECOM.DRAFT-ORDERS',
  'draftOrders.deleteDraftOrder': 'SCOPE.ECOM.DRAFT-ORDERS',
  'orderPaymentRequests.createOrderPaymentRequest': 'SCOPE.DC-ECOM-MEGA.MANAGE-ECOM',
  'orderPaymentRequests.getOrderPaymentRequest': 'SCOPE.DC-ECOM-MEGA.MANAGE-ECOM',
};

/** Labels a Wix call's error with the method name, so permission errors say which call was refused. */
function tag<T>(method: string, p: Promise<T>): Promise<T> {
  return p.catch((e) => {
    if (e && typeof e === 'object') (e as any).wixMethod ??= method;
    throw e;
  });
}

// ---------- orders ----------

export async function getOrder(orderId: string): Promise<OrderLike & Record<string, any>> {
  return (await tag('orders.getOrder', orders.getOrder(orderId))) as any;
}

// ---------- returns collection ----------

export async function listReturnsForOrder(orderId: string): Promise<Stored[]> {
  const res = await tag('items.query', items.query(RETURNS_COLLECTION_ID).eq('orderId', orderId).ascending('_createdDate').limit(100).find());
  return res.items as unknown as Stored[];
}

/** Latest 500 returns, newest first, filtered by status/kind. Text search happens in the page. */
export async function listReturns(filter: { status?: string; kind?: string } = {}): Promise<Stored[]> {
  let q = items.query(RETURNS_COLLECTION_ID);
  if (filter.status) q = q.eq('status', filter.status);
  if (filter.kind) q = q.eq('kind', filter.kind);
  const res = await q.descending('_createdDate').limit(500).find();
  return res.items as unknown as Stored[];
}

export async function getReturn(id: string): Promise<Stored | null> {
  return (await tag('items.get', items.get(RETURNS_COLLECTION_ID, id))) as unknown as Stored | null;
}

export async function insertReturn(r: ReturnRecord): Promise<Stored> {
  return (await tag('items.insert', items.insert(RETURNS_COLLECTION_ID, r as any))) as unknown as Stored;
}

export async function saveReturn(r: Stored): Promise<Stored> {
  return (await tag('items.update', items.update(RETURNS_COLLECTION_ID, r as any))) as unknown as Stored;
}

// ---------- stock ----------

let catalogVersionCache: Promise<CatalogVersion> | null = null;
export function getCatalogVersion(): Promise<CatalogVersion> {
  catalogVersionCache ??= tag('catalogVersioning.getCatalogVersion', catalogVersioning.getCatalogVersion())
    .then((r) => (r.catalogVersion ?? 'V1_CATALOG') as CatalogVersion)
    .catch((e) => {
      catalogVersionCache = null;
      throw e;
    });
  return catalogVersionCache;
}

/**
 * Puts each line's restockQty back into Wix Stores stock (lines not yet restocked).
 * Marks each successful line `restocked` and saves. Returns any per-line problems.
 */
export async function restock(r: Stored): Promise<{ record: Stored; problems: string[] }> {
  const plan = restockPlan(r.items);
  if (plan.length === 0) return { record: r, problems: [] };
  const version = await getCatalogVersion();
  const done = new Set<string>();
  const problems: string[] = [];

  if (version === 'V3_CATALOG') {
    // V3 needs the variant ID. Order lines normally carry it; look it up for any that don't.
    for (const t of plan) {
      if (t.variantId) continue;
      const v = await tag('readOnlyVariantsV3.queryVariants', readOnlyVariantsV3.queryVariants().eq('productData.productId', t.productId).limit(2).find());
      if (v.items.length === 1) t.variantId = (v.items[0] as any)._id ?? (v.items[0] as any).variantId ?? '';
    }
    const payload = v3IncrementData(plan);
    const sent = plan.filter((t) => t.variantId);
    for (const t of plan) if (!t.variantId) problems.push(`${nameOf(r, t.lineItemId)}: couldn't find which variant to restock.`);
    if (payload.length) {
      const res = await tag('inventoryItemsV3.bulkIncrementInventoryItemsByVariantAndLocation', inventoryItemsV3.bulkIncrementInventoryItemsByVariantAndLocation(payload as any, { reason: 'MANUAL' } as any));
      (res.results ?? []).forEach((result: any, i: number) => {
        const t = sent[result.itemMetadata?.originalIndex ?? i];
        if (!t) return;
        if (result.itemMetadata?.success) done.add(t.lineItemId);
        else problems.push(`${nameOf(r, t.lineItemId)}: ${result.itemMetadata?.error?.description ?? 'stock update failed'}.`);
      });
    }
  } else if (version === 'V1_CATALOG') {
    // V1 increments one call for the batch; it either all works or throws.
    await tag('inventory.incrementInventory', inventory.incrementInventory(v1IncrementData(plan) as any));
    plan.forEach((t) => done.add(t.lineItemId));
  } else {
    problems.push('Wix Stores is not installed, so nothing was restocked.');
  }

  let record: Stored = { ...r, items: r.items.map((i) => (done.has(i.lineItemId) ? { ...i, restocked: true } : i)) };
  const units = plan.filter((t) => done.has(t.lineItemId)).reduce((s, t) => s + t.qty, 0);
  if (units) record = withHistory(record, `${units} unit(s) added back to stock.`);
  for (const p of problems) record = withHistory(record, `Restock problem: ${p}`);
  return { record: await saveReturn(record), problems };
}

function nameOf(r: ReturnRecord, lineItemId: string) {
  const i = r.items.find((x) => x.lineItemId === lineItemId);
  return i ? `${i.name}${i.options ? ` (${i.options})` : ''}` : 'Item';
}

/** Marks the return received, saves, then restocks. */
export async function receive(r: Stored, restockQtyByLine: Record<string, number>) {
  const saved = await saveReturn(markReceived(r, restockQtyByLine) as Stored);
  return restock(saved);
}

// ---------- exchanges ----------

/**
 * Creates the replacement order for an exchange, then (if money is owed) a payment link.
 * Safe to call again: skips the order if one already exists, and skips the link if one exists.
 */
export async function createExchangeOrder(r: Stored): Promise<Stored> {
  let record = r;
  if (!record.exchangeOrderId) {
    const order = await getOrder(record.orderId);
    const draftRes: any = await tag('draftOrders.createDraftOrder', draftOrders.createDraftOrder(buildExchangeDraft(order, record) as any));
    const draft = draftRes.calculatedDraftOrder;
    const draftId: string = draft?.draftOrder?._id;
    const errs = calculationErrorText(draft?.calculationErrors);
    if (errs) {
      await tag('draftOrders.deleteDraftOrder', draftOrders.deleteDraftOrder(draftId).catch(() => {}));
      throw new Error(`Wix couldn't price the replacement order: ${errs}`);
    }
    const created: any = await tag('draftOrders.createOrderFromDraft', draftOrders.createOrderFromDraft(draftId, {
      reason: `Exchange for order #${record.orderNumber} (${record.returnNumber})`,
    }));
    const newOrder = created.createdOrder;
    record = withHistory(
      { ...record, exchangeOrderId: newOrder?._id ?? '', exchangeOrderNumber: String(newOrder?.number ?? '') },
      `Replacement order #${newOrder?.number} created.`,
    );
    record = await saveReturn(record);
  }
  if (record.amountDue > 0 && !record.paymentRequestId) record = await createPaymentLink(record);
  return record;
}

export async function createPaymentLink(r: Stored): Promise<Stored> {
  const expiry = PAYMENT_LINK_EXPIRY_DAYS ? new Date(Date.now() + PAYMENT_LINK_EXPIRY_DAYS * 864e5) : undefined;
  const res: any = await tag('orderPaymentRequests.createOrderPaymentRequest', orderPaymentRequests.createOrderPaymentRequest({
    orderPaymentRequest: {
      orderId: r.exchangeOrderId,
      amount: { amount: r.amountDue.toFixed(2) },
      title: `Exchange for order #${r.orderNumber}`,
      description: [
        r.priceDifference > 0 ? `Price difference £${r.priceDifference.toFixed(2)}` : '',
        r.postageCharge > 0 ? `Postage £${r.postageCharge.toFixed(2)}` : '',
      ].filter(Boolean).join(' + ').slice(0, 300) || undefined,
      source: { externalId: r._id },
      ...(expiry ? { expirationDate: expiry } : {}),
    },
  } as any));
  const req = res.orderPaymentRequest ?? res;
  const updated = withHistory(
    {
      ...r,
      paymentRequestId: req?._id ?? '',
      paymentRequestUrl: res.orderPaymentRequestUrl ?? '',
      paymentStatus: (req?.status ?? 'UNPAID') as ReturnRecord['paymentStatus'],
    },
    `Payment link created for £${r.amountDue.toFixed(2)}.`,
  );
  return saveReturn(updated);
}

/** Re-reads the payment link status from Wix and saves it if it changed. */
export async function refreshPaymentStatus(r: Stored): Promise<Stored> {
  if (!r.paymentRequestId || r.paymentStatus === 'PAID') return r;
  const req: any = await tag('orderPaymentRequests.getOrderPaymentRequest', orderPaymentRequests.getOrderPaymentRequest(r.paymentRequestId));
  const status = (req?.status ?? r.paymentStatus) as ReturnRecord['paymentStatus'];
  if (status === r.paymentStatus) return r;
  return saveReturn(withHistory({ ...r, paymentStatus: status }, `Payment link is now ${status.toLowerCase()}.`));
}

function calculationErrorText(ce: any): string {
  if (!ce) return '';
  const parts: string[] = [];
  const g = ce.generalShippingCalculationError;
  if (g?.applicationError?.description) parts.push(g.applicationError.description);
  for (const v of g?.validationError?.fieldViolations ?? []) parts.push(`${v.field}: ${v.description}`);
  for (const e of ce.orderValidationErrors ?? []) parts.push(e.description ?? e.code ?? String(e));
  return parts.join('; ');
}

// ---------- catalogue search (replacement items) ----------

export interface PickableVariant {
  label: string;
  catalogOptions: Record<string, unknown>;
  price: number;
}
export interface PickableProduct {
  productId: string;
  name: string;
}

/** Finds products by name (or SKU on V3). Also returns which catalogue was searched, for the UI. */
export async function searchProducts(text: string): Promise<{ catalog: CatalogVersion; products: PickableProduct[] }> {
  const q = text.trim();
  const catalog = await getCatalogVersion();
  if (!q) return { catalog, products: [] };
  if (catalog === 'V3_CATALOG') {
    // V3 free-text search only looks in the fields you list; with none listed it matches nothing.
    const res: any = await tag('productsV3.searchProducts', productsV3.searchProducts(
      { search: { expression: q, fields: ['name', 'variantsInfo.variants.sku'], fuzzy: true }, cursorPaging: { limit: 20 } } as any,
      {} as any,
    ));
    return { catalog, products: (res.products ?? []).map((p: any) => ({ productId: p._id, name: p.name ?? '' })) };
  }
  const res = await tag('products.queryProducts', products.queryProducts().startsWith('name', q).limit(20).find());
  return { catalog, products: res.items.map((p: any) => ({ productId: p._id, name: p.name ?? '' })) };
}

export async function listVariants(productId: string): Promise<PickableVariant[]> {
  if ((await getCatalogVersion()) === 'V3_CATALOG') {
    const res: any = await tag('readOnlyVariantsV3.queryVariants', readOnlyVariantsV3.queryVariants().eq('productData.productId', productId).limit(100).find());
    return res.items.map((v: any) => ({
      label:
        (v.optionChoices ?? [])
          .map((c: any) => c.optionChoiceNames && `${c.optionChoiceNames.optionName}: ${c.optionChoiceNames.choiceName}`)
          .filter(Boolean)
          .join(', ') || 'Standard',
      catalogOptions: { variantId: v._id ?? v.variantId },
      price: Number(v.price?.actualPrice?.amount ?? 0),
    }));
  }
  const res: any = await tag('products.getProduct', products.getProduct(productId));
  const p = res.product ?? res;
  const basePrice = Number(p.priceData?.discountedPrice ?? p.priceData?.price ?? 0);
  const variants: any[] = p.variants?.length ? p.variants : [{ _id: '', choices: {} }];
  return variants.map((v) => {
    const choices: Record<string, string> = v.choices ?? {};
    const hasChoices = Object.keys(choices).length > 0;
    return {
      label: hasChoices ? Object.entries(choices).map(([k, val]) => `${k}: ${val}`).join(', ') : 'Standard',
      catalogOptions: p.manageVariants && v._id ? { variantId: v._id } : hasChoices ? { options: choices } : {},
      price: Number(v.variant?.priceData?.discountedPrice ?? v.variant?.priceData?.price ?? basePrice),
    };
  });
}

export const STORES_APP_ID = WIX_STORES_APP_ID;
