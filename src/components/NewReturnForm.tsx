import { useEffect, useMemo, useState, type FC } from 'react';
import {
  Box, Button, Card, Divider, Dropdown, FormField, Input, InputArea, Loader, NumberInput,
  Checkbox, RadioGroup, SectionHelper, Text, TextButton,
} from '@wix/design-system';
import {
  REASONS, WIX_STORES_APP_ID, type ExchangeLine, type ReturnKind, type ReturnLine,
  amountDue, creditValue, customerName, exchangeValue, formatMoney, newRecord, nextReturnNumber,
  remainingQuantities, suggestedPriceDifference, suggestedRefund, toReturnLine, validateDraft,
} from '../lib/returns-logic';
import {
  createExchangeOrder, getOrder, insertReturn, listReturnsForOrder, listVariants, searchProducts,
  type PickableProduct, type PickableVariant,
} from '../lib/wix-ops';
import { errorText, toastError, toastOk } from './common';

interface Props {
  orderId: string;
  onDone: (returnId: string) => void;
  onCancel: () => void;
}

/** Form for logging a new return or exchange against one order. */
export const NewReturnForm: FC<Props> = ({ orderId, onDone, onCancel }) => {
  const [order, setOrder] = useState<any>();
  const [existingCount, setExistingCount] = useState(0);
  const [remaining, setRemaining] = useState<Record<string, number>>({});
  const [lines, setLines] = useState<ReturnLine[]>([]);
  const [kind, setKind] = useState<ReturnKind>('RETURN');
  const [reason, setReason] = useState('');
  const [notes, setNotes] = useState('');
  const [exchangeItems, setExchangeItems] = useState<ExchangeLine[]>([]);
  const [priceDiff, setPriceDiff] = useState<number | null>(null); // null = use suggestion
  const [postage, setPostage] = useState(0);
  const [refund, setRefund] = useState<number | null>(null);
  const [createOrderNow, setCreateOrderNow] = useState(true);
  const [busy, setBusy] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [errors, setErrors] = useState<string[]>([]);

  useEffect(() => {
    // Label each call so an error says which one failed.
    const step = <T,>(label: string, p: Promise<T>) =>
      p.catch((e) => {
        console.error(`[returns] ${label} failed`, e);
        throw new Error(`${label}: ${errorText(e)}`);
      });
    Promise.all([
      step('Reading the order (eCommerce)', getOrder(orderId)),
      step('Reading earlier returns (Returns collection)', listReturnsForOrder(orderId)),
    ])
      .then(([o, existing]) => {
        setOrder(o);
        setExistingCount(existing.length);
        setRemaining(remainingQuantities(o.lineItems ?? [], existing));
        setLines((o.lineItems ?? []).map(toReturnLine));
      })
      .catch((e) => setLoadError(e.message));
  }, [orderId]);

  const currency = order?.currency ?? 'GBP';
  const credit = useMemo(() => creditValue(lines), [lines]);
  const exch = useMemo(() => exchangeValue(exchangeItems), [exchangeItems]);
  const effPriceDiff = kind === 'EXCHANGE' ? priceDiff ?? suggestedPriceDifference(credit, exch) : 0;
  const effPostage = kind === 'EXCHANGE' ? postage : 0;
  const effRefund = refund ?? suggestedRefund(kind, credit, kind === 'EXCHANGE' ? exch : 0);
  const due = amountDue(effPriceDiff, effPostage);

  if (loadError) return <SectionHelper appearance="danger">Couldn't start the return. {loadError}</SectionHelper>;
  if (!order) return <Box align="center" padding="SP6"><Loader size="small" /></Box>;

  const setQty = (lineItemId: string, q: number) =>
    setLines((ls) => ls.map((l) => (l.lineItemId === lineItemId ? { ...l, quantity: Math.max(0, Math.floor(q || 0)) } : l)));

  async function submit() {
    const draft = { kind, reason, items: lines, exchangeItems, priceDifference: effPriceDiff, postageCharge: effPostage, refundAmount: effRefund };
    const errs = validateDraft(draft, remaining);
    setErrors(errs);
    if (errs.length) return;
    setBusy(true);
    try {
      const rec = newRecord(
        {
          returnNumber: nextReturnNumber(String(order.number), existingCount),
          orderId,
          orderNumber: String(order.number),
          customerName: customerName(order),
          customerEmail: order.buyerInfo?.email ?? '',
        },
        draft,
      );
      rec.notes = notes;
      let saved = await insertReturn(rec);
      if (kind === 'EXCHANGE' && createOrderNow) {
        try {
          saved = await createExchangeOrder(saved);
        } catch (e) {
          // The return is logged; the replacement order can be retried from the return's detail view.
          toastError(e, `${saved.returnNumber} saved, but the replacement order failed: `);
          onDone(saved._id);
          return;
        }
      }
      toastOk(`${saved.returnNumber} logged`);
      onDone(saved._id);
    } catch (e) {
      setErrors([errorText(e)]);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Box direction="vertical" gap="SP4">
      <Text size="small" secondary>
        Order #{order.number} · {customerName(order)} {order.buyerInfo?.email ? `· ${order.buyerInfo.email}` : ''}
      </Text>

      <FormField label="What's happening?">
        <RadioGroup value={kind} onChange={(v: any) => setKind(v)} display="horizontal">
          <RadioGroup.Radio value="RETURN">Return (refund)</RadioGroup.Radio>
          <RadioGroup.Radio value="EXCHANGE">Exchange (send replacement)</RadioGroup.Radio>
        </RadioGroup>
      </FormField>
      {kind === 'RETURN' && (
        <Text size="small" secondary>
          A return sends nothing back to the customer. If they're getting a replacement (even the same item), choose Exchange.
        </Text>
      )}

      <Card>
        <Card.Header title="Items coming back" subtitle="Set how many of each line the customer is sending back." />
        <Card.Divider />
        <Card.Content>
          <Box direction="vertical" gap="SP3">
            {lines.map((l) => {
              const max = remaining[l.lineItemId] ?? 0;
              return (
                <Box key={l.lineItemId} verticalAlign="middle" gap="SP3">
                  <Box direction="vertical" width="60%">
                    <Text weight="normal">{l.name}</Text>
                    <Text size="small" secondary>
                      {[l.options, l.sku && `SKU ${l.sku}`, formatMoney(l.unitPrice, currency)].filter(Boolean).join(' · ')}
                    </Text>
                  </Box>
                  <Box width="120px">
                    <NumberInput value={l.quantity} min={0} max={max} step={1} disabled={max === 0}
                      onChange={(v: number | null) => setQty(l.lineItemId, v ?? 0)} />
                  </Box>
                  <Text size="small" secondary>{max === 0 ? 'already returned' : `of ${max}`}</Text>
                </Box>
              );
            })}
          </Box>
        </Card.Content>
      </Card>

      <Box gap="SP4">
        <Box width="50%">
          <FormField label="Reason" required>
            <Dropdown placeholder="Choose a reason" selectedId={reason || undefined}
              options={REASONS.map((r) => ({ id: r, value: r }))} onSelect={(o: any) => setReason(String(o.id))} />
          </FormField>
        </Box>
        <Box width="50%">
          <FormField label="Notes (internal)">
            <Input value={notes} onChange={(e: any) => setNotes(e.target.value)} />
          </FormField>
        </Box>
      </Box>

      {kind === 'EXCHANGE' && (
        <ExchangePicker currency={currency} items={exchangeItems} onChange={setExchangeItems} />
      )}

      <Card>
        <Card.Header title="Money" subtitle="Refunds are recorded here but issued manually from the Wix order (Refund button)." />
        <Card.Divider />
        <Card.Content>
          <Box direction="vertical" gap="SP3">
            <Text>Value of items coming back: <b>{formatMoney(credit, currency)}</b></Text>
            {kind === 'EXCHANGE' && <Text>Value of replacements: <b>{formatMoney(exch, currency)}</b></Text>}
            <Box gap="SP4">
              {kind === 'EXCHANGE' && (
                <>
                  <FormField label="Charge for price difference">
                    <NumberInput prefix={<Input.Affix>£</Input.Affix>} min={0} step={0.01}
                      value={effPriceDiff} onChange={(v: number | null) => setPriceDiff(v ?? 0)} />
                  </FormField>
                  <FormField label="Charge for postage">
                    <NumberInput prefix={<Input.Affix>£</Input.Affix>} min={0} step={0.01}
                      value={postage} onChange={(v: number | null) => setPostage(v ?? 0)} />
                  </FormField>
                </>
              )}
              <FormField label="Refund owed to customer">
                <NumberInput prefix={<Input.Affix>£</Input.Affix>} min={0} step={0.01}
                  value={effRefund} onChange={(v: number | null) => setRefund(v ?? 0)} />
              </FormField>
            </Box>
            {kind === 'EXCHANGE' && (
              <SectionHelper appearance={due > 0 ? 'warning' : 'success'}>
                {due > 0
                  ? `Customer pays ${formatMoney(due, currency)}. A replacement order is created and a payment link generated for you to send them.`
                  : 'Nothing extra to pay. The replacement order is created at no charge.'}
              </SectionHelper>
            )}
            {kind === 'EXCHANGE' && (
              <Checkbox checked={createOrderNow} onChange={() => setCreateOrderNow(!createOrderNow)}>
                Create the replacement order now
              </Checkbox>
            )}
            {kind === 'EXCHANGE' && !createOrderNow && (
              <Text size="small" skin="error">
                Nothing will ship until you open this return and click Create replacement order.
              </Text>
            )}
          </Box>
        </Card.Content>
      </Card>

      {errors.length > 0 && (
        <SectionHelper appearance="danger">
          {errors.map((e) => <div key={e}>{e}</div>)}
        </SectionHelper>
      )}

      <Divider />
      <Box align="right" gap="SP2">
        <Button priority="secondary" onClick={onCancel} disabled={busy}>Cancel</Button>
        <Button onClick={submit} disabled={busy}>{busy ? <Loader size="tiny" /> : kind === 'EXCHANGE' ? 'Log exchange' : 'Log return'}</Button>
      </Box>
    </Box>
  );
};

/** Search the catalogue and build the list of replacement items. */
export const ExchangePicker: FC<{ currency: string; items: ExchangeLine[]; onChange: (x: ExchangeLine[]) => void }> = ({
  currency, items, onChange,
}) => {
  const [text, setText] = useState('');
  const [results, setResults] = useState<PickableProduct[]>([]);
  const [product, setProduct] = useState<PickableProduct>();
  const [variants, setVariants] = useState<PickableVariant[]>([]);
  const [variantIdx, setVariantIdx] = useState<number>();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [noMatch, setNoMatch] = useState('');

  async function doSearch() {
    setBusy(true); setErr(''); setNoMatch('');
    try {
      const { catalog, products } = await searchProducts(text);
      setResults(products); setProduct(undefined); setVariants([]);
      if (products.length === 0) {
        const where = catalog === 'V3_CATALOG' ? 'Stores catalogue (V3)' : catalog === 'V1_CATALOG' ? 'Stores catalogue (V1)' : 'catalogue';
        setNoMatch(`No products matching "${text.trim()}" in the ${where}. Hidden products only show if the app has the "read admin" products permission.`);
      }
    }
    catch (e) { setErr(errorText(e)); }
    finally { setBusy(false); }
  }

  async function pickProduct(p: PickableProduct) {
    setProduct(p); setVariantIdx(undefined); setBusy(true); setErr('');
    try {
      const vs = await listVariants(p.productId);
      setVariants(vs);
      if (vs.length === 1) setVariantIdx(0);
    } catch (e) { setErr(errorText(e)); }
    finally { setBusy(false); }
  }

  function add() {
    if (!product || variantIdx === undefined) return;
    const v = variants[variantIdx];
    onChange([...items, {
      catalogItemId: product.productId,
      appId: WIX_STORES_APP_ID,
      catalogOptions: v.catalogOptions,
      name: product.name,
      options: v.label === 'Standard' ? '' : v.label,
      unitPrice: v.price,
      quantity: 1,
    }]);
    setProduct(undefined); setVariants([]); setVariantIdx(undefined);
  }

  return (
    <Card>
      <Card.Header title="Replacement items" subtitle="What you're sending out instead." />
      <Card.Divider />
      <Card.Content>
        <Box direction="vertical" gap="SP3">
          {items.map((e, i) => (
            <Box key={i} verticalAlign="middle" gap="SP3">
              <Box direction="vertical" width="60%">
                <Text>{e.name}</Text>
                <Text size="small" secondary>{[e.options, formatMoney(e.unitPrice, currency)].filter(Boolean).join(' · ')}</Text>
              </Box>
              <Box width="120px">
                <NumberInput value={e.quantity} min={1} step={1}
                  onChange={(v: number | null) => onChange(items.map((x, j) => (j === i ? { ...x, quantity: Math.max(1, Math.floor(v ?? 1)) } : x)))} />
              </Box>
              <TextButton skin="destructive" size="small" onClick={() => onChange(items.filter((_, j) => j !== i))}>Remove</TextButton>
            </Box>
          ))}

          <Box gap="SP2" verticalAlign="bottom">
            <Box width="60%">
              <FormField label="Find a product">
                <Input value={text} placeholder="Start of the product name" onChange={(e: any) => setText(e.target.value)}
                  onEnterPressed={doSearch} />
              </FormField>
            </Box>
            <Button priority="secondary" onClick={doSearch} disabled={busy || !text.trim()}>Search</Button>
            {busy && <Loader size="tiny" />}
          </Box>

          {results.length > 0 && (
            <Dropdown placeholder={`${results.length} product(s) found: pick one`} selectedId={product?.productId}
              options={results.map((p) => ({ id: p.productId, value: p.name }))}
              onSelect={(o: any) => pickProduct(results.find((p) => p.productId === o.id)!)} />
          )}

          {product && variants.length > 0 && (
            <Box gap="SP2" verticalAlign="bottom">
              <Box width="60%">
                <FormField label="Option">
                  <Dropdown selectedId={variantIdx} placeholder="Choose size / colour"
                    options={variants.map((v, i) => ({ id: i, value: `${v.label} (${formatMoney(v.price, currency)})` }))}
                    onSelect={(o: any) => setVariantIdx(Number(o.id))} />
                </FormField>
              </Box>
              <Button onClick={add} disabled={variantIdx === undefined}>Add</Button>
            </Box>
          )}
          {noMatch && <Text size="small" secondary>{noMatch}</Text>}
          {err && <SectionHelper appearance="danger">{err}</SectionHelper>}
        </Box>
      </Card.Content>
    </Card>
  );
};
