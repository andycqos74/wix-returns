import { useEffect, useState, type FC } from 'react';
import {
  Box, Button, Card, Dropdown, FormField, Heading, Input, InputArea, Loader, NumberInput, SectionHelper, Text, TextButton,
} from '@wix/design-system';
import {
  REASONS, allowedTransitions, applyEdit, completionCheck, editability, formatMoney, reopenStatus, withHistory,
  type ExchangeLine, type ReturnRecord,
} from '../lib/returns-logic';
import {
  createExchangeOrder, createPaymentLink, getReturn, receive, refreshPaymentStatus, restock, saveReturn,
} from '../lib/wix-ops';
import { KindBadge, StatusBadge, errorText, fmtDate, toastError, toastOk } from './common';
import { ExchangePicker } from './NewReturnForm';

type Stored = ReturnRecord & { _id: string; _createdDate?: Date };

/** Everything you do to a logged return: receive & restock, exchange order, payment link, refund, close. */
export const ReturnDetail: FC<{ returnId: string; onChanged?: () => void }> = ({ returnId, onChanged }) => {
  const [r, setR] = useState<Stored | null>();
  const [busy, setBusy] = useState('');
  const [restockQty, setRestockQty] = useState<Record<string, number>>({});
  const [receiving, setReceiving] = useState(false);
  const [notes, setNotes] = useState('');
  const [loadError, setLoadError] = useState('');
  const [editing, setEditing] = useState(false);
  const [confirming, setConfirming] = useState<'' | 'complete' | 'cancel'>('');

  useEffect(() => {
    getReturn(returnId)
      .then(async (rec) => {
        if (!rec) return setR(null);
        setR(rec);
        setNotes(rec.notes ?? '');
        setRestockQty(Object.fromEntries(rec.items.map((i) => [i.lineItemId, i.quantity])));
        // Pick up "paid" without anyone clicking anything.
        if (rec.paymentStatus === 'UNPAID') setR(await refreshPaymentStatus(rec).catch(() => rec));
      })
      .catch((e) => setLoadError(errorText(e)));
  }, [returnId]);

  if (loadError) return <SectionHelper appearance="danger">Couldn't load the return: {loadError}</SectionHelper>;
  if (r === undefined) return <Box align="center" padding="SP6"><Loader size="small" /></Box>;
  if (r === null) return <SectionHelper appearance="danger">This return no longer exists.</SectionHelper>;

  async function run(label: string, fn: () => Promise<Stored>, ok?: string) {
    setBusy(label);
    try {
      const next = await fn();
      setR(next);
      onChanged?.();
      if (ok) toastOk(ok);
    } catch (e) {
      toastError(e);
    } finally {
      setBusy('');
    }
  }

  const rec = r;
  const canMove = allowedTransitions(rec);
  const isExchange = rec.kind === 'EXCHANGE';
  const pendingRestock = rec.status !== 'AWAITING_ITEM' && rec.items.some((i) => i.restockQty > 0 && !i.restocked);
  const set = (patch: Partial<Stored>, history: string) => run(history, () => saveReturn(withHistory({ ...rec, ...patch }, history)), history);
  const can = editability(rec);
  const reopenTo = reopenStatus(rec);
  const check = completionCheck(rec);

  return (
    <Box direction="vertical" gap="SP4">
      <Box verticalAlign="middle" gap="SP2">
        <Heading size="small">{rec.returnNumber}</Heading>
        <KindBadge kind={rec.kind} />
        <StatusBadge status={rec.status} />
        <Box marginLeft="auto" gap="SP2">
          {can.any && !editing && !receiving && (
            <Button size="small" priority="secondary" disabled={!!busy} onClick={() => setEditing(true)}>Edit</Button>
          )}
          {reopenTo && (
            <Button size="small" priority="secondary" disabled={!!busy}
              onClick={() => set({ status: reopenTo }, `Reopened (was ${rec.status === 'COMPLETED' ? 'completed' : 'cancelled'}).`)}>
              Reopen
            </Button>
          )}
        </Box>
      </Box>
      {isExchange && !rec.exchangeOrderId && rec.status !== 'CANCELLED' && (
        <SectionHelper appearance="warning">
          No replacement order has been created yet, so nothing will be shipped. Use <b>Create replacement order</b> below.
        </SectionHelper>
      )}
      {editing && (
        <EditPanel rec={rec} busy={!!busy} onCancel={() => setEditing(false)}
          onSave={(edit) => run('edit', async () => {
            const next = applyEdit(rec, edit);
            setEditing(false);
            return next === rec ? rec : saveReturn(next as Stored);
          }, 'Changes saved')} />
      )}
      <Text size="small" secondary>
        Order #{rec.orderNumber} · {rec.customerName} {rec.customerEmail && `· ${rec.customerEmail}`} · {rec.reason}
      </Text>

      {/* ---------- items back / restock ---------- */}
      <Card>
        <Card.Header
          title="Items coming back"
          subtitle={rec.receivedDate ? `Received ${fmtDate(rec.receivedDate)}` : 'Not received yet'}
          suffix={
            rec.status === 'AWAITING_ITEM' && !receiving ? (
              <Button size="small" onClick={() => setReceiving(true)}>Mark received</Button>
            ) : pendingRestock ? (
              <Button size="small" priority="secondary" disabled={!!busy}
                onClick={() => run('restock', async () => {
                  const res = await restock(rec);
                  if (res.problems.length) throw new Error(res.problems.join(' '));
                  return res.record;
                }, 'Stock updated')}>
                Retry restock
              </Button>
            ) : undefined
          }
        />
        <Card.Divider />
        <Card.Content>
          <Box direction="vertical" gap="SP3">
            {rec.items.map((i) => (
              <Box key={i.lineItemId} verticalAlign="middle" gap="SP3">
                <Box direction="vertical" width="55%">
                  <Text>{i.quantity} × {i.name}</Text>
                  <Text size="small" secondary>{[i.options, i.sku && `SKU ${i.sku}`].filter(Boolean).join(' · ')}</Text>
                </Box>
                {receiving ? (
                  <Box gap="SP2" verticalAlign="middle">
                    <Text size="small">Back to stock:</Text>
                    <Box width="100px">
                      <NumberInput value={restockQty[i.lineItemId] ?? 0} min={0} max={i.quantity} step={1}
                        onChange={(v: number | null) => setRestockQty({ ...restockQty, [i.lineItemId]: v ?? 0 })} />
                    </Box>
                  </Box>
                ) : rec.status !== 'AWAITING_ITEM' && rec.status !== 'CANCELLED' ? (
                  <Text size="small" secondary>
                    {i.restockQty === 0 ? 'Not restocked' : i.restocked ? `${i.restockQty} restocked ✓` : `${i.restockQty} to restock (pending)`}
                  </Text>
                ) : null}
              </Box>
            ))}
            {receiving && (
              <Box direction="vertical" gap="SP2">
                <Text size="small" secondary>Set "Back to stock" to 0 for anything damaged or not resellable.</Text>
                <Box gap="SP2">
                  <Button priority="secondary" size="small" onClick={() => setReceiving(false)} disabled={!!busy}>Cancel</Button>
                  <Button size="small" disabled={!!busy}
                    onClick={() => run('receive', async () => {
                      const res = await receive(rec, restockQty);
                      setReceiving(false);
                      if (res.problems.length) toastError(res.problems.join(' '), 'Received, but restock had problems: ');
                      return res.record;
                    }, 'Marked received')}>
                    {busy === 'receive' ? <Loader size="tiny" /> : 'Confirm received & restock'}
                  </Button>
                </Box>
              </Box>
            )}
          </Box>
        </Card.Content>
      </Card>

      {/* ---------- exchange ---------- */}
      {isExchange && (
        <Card>
          <Card.Header title="Replacement" subtitle={rec.exchangeOrderNumber ? `Order #${rec.exchangeOrderNumber}` : 'No replacement order yet'}
            suffix={!rec.exchangeOrderId && rec.status !== 'CANCELLED' ? (
              <Button size="small" disabled={!!busy} onClick={() => run('exchange', () => createExchangeOrder(rec), 'Replacement order created')}>
                {busy === 'exchange' ? <Loader size="tiny" /> : 'Create replacement order'}
              </Button>
            ) : undefined} />
          <Card.Divider />
          <Card.Content>
            <Box direction="vertical" gap="SP2">
              {rec.exchangeItems.map((e, idx) => (
                <Text key={idx}>{e.quantity} × {e.name}{e.options ? ` (${e.options})` : ''}</Text>
              ))}
              <Text size="small" secondary>
                Price difference {formatMoney(rec.priceDifference)} + postage {formatMoney(rec.postageCharge)} ={' '}
                <b>{formatMoney(rec.amountDue)}</b> to pay
              </Text>
              {rec.exchangeOrderId && rec.amountDue > 0 && (
                <PaymentBox rec={rec} busy={busy}
                  onCreate={() => run('link', () => createPaymentLink(rec), 'Payment link created')}
                  onRefresh={() => run('refresh', () => refreshPaymentStatus(rec))}
                  onMarkPaid={() => set({ paymentStatus: 'PAID' }, 'Exchange charge marked as paid manually.')} />
              )}
            </Box>
          </Card.Content>
        </Card>
      )}

      {/* ---------- refund ---------- */}
      <Card>
        <Card.Header title="Refund"
          subtitle={rec.refundStatus === 'NONE' ? 'No refund owed' : `${formatMoney(rec.refundAmount)} ${rec.refundStatus === 'DONE' ? 'refunded' : 'owed'}`}
          suffix={rec.refundStatus === 'DUE' ? (
            <Button size="small" priority="secondary" disabled={!!busy}
              onClick={() => set({ refundStatus: 'DONE' }, `Refund of ${formatMoney(rec.refundAmount)} marked as done.`)}>
              Mark refund done
            </Button>
          ) : undefined} />
        {rec.refundStatus === 'DUE' && (
          <Card.Content>
            <Text size="small" secondary>Issue it from the original order's <b>Refund</b> button, then mark it done here.</Text>
          </Card.Content>
        )}
      </Card>

      {/* ---------- notes & history ---------- */}
      <Card>
        <Card.Header title="Notes & history" />
        <Card.Divider />
        <Card.Content>
          <Box direction="vertical" gap="SP3">
            <FormField label="Internal notes">
              <InputArea rows={2} value={notes} onChange={(e: any) => setNotes(e.target.value)} />
            </FormField>
            {notes !== (rec.notes ?? '') && (
              <Box><Button size="tiny" priority="secondary" onClick={() => run('notes', () => saveReturn({ ...rec, notes }), 'Notes saved')}>Save notes</Button></Box>
            )}
            {[...(rec.history ?? [])].reverse().map((h, idx) => (
              <Text key={idx} size="tiny" secondary>{new Date(h.at).toLocaleString('en-GB')} · {h.text}</Text>
            ))}
          </Box>
        </Card.Content>
      </Card>

      {/* ---------- close ---------- */}
      {canMove.length > 0 && !receiving && !editing && !confirming && (
        <Box direction="vertical" gap="SP2">
          {canMove.includes('COMPLETED') && check.blockers.length > 0 && (
            <Text size="tiny" secondary>Can't complete yet: {check.blockers.join(' ')}</Text>
          )}
          {canMove.includes('COMPLETED') && check.blockers.length === 0 && check.warnings.length > 0 && (
            <Text size="tiny" secondary>Still open: {check.warnings.join(' ')}</Text>
          )}
          <Box gap="SP2" align="right">
            {canMove.includes('CANCELLED') && (
              <Button skin="destructive" priority="secondary" disabled={!!busy}
                onClick={() => (rec.status === 'RECEIVED' ? setConfirming('cancel') : set({ status: 'CANCELLED' }, 'Return cancelled.'))}>
                Cancel return
              </Button>
            )}
            {canMove.includes('COMPLETED') && (
              <Button disabled={!!busy || check.blockers.length > 0}
                onClick={() => (check.warnings.length ? setConfirming('complete') : set({ status: 'COMPLETED' }, 'Return completed.'))}>
                Mark completed
              </Button>
            )}
          </Box>
        </Box>
      )}
      {confirming === 'complete' && (
        <SectionHelper appearance="warning" actionText="Complete anyway"
          onAction={() => { setConfirming(''); set({ status: 'COMPLETED' }, `Completed with open items: ${check.warnings.join(' ')}`); }}
          showCloseButton onClose={() => setConfirming('')}>
          Still open: {check.warnings.join(' ')}
        </SectionHelper>
      )}
      {confirming === 'cancel' && (
        <SectionHelper appearance="danger" actionText="Cancel the return"
          onAction={() => { setConfirming(''); set({ status: 'CANCELLED' }, 'Cancelled after the item was received.'); }}
          showCloseButton onClose={() => setConfirming('')}>
          The item has already been received.
          {rec.items.some((i) => i.restocked) ? ' Stock already added back stays added; adjust it in Inventory if needed.' : ''}
          {rec.exchangeOrderId ? ` Replacement order #${rec.exchangeOrderNumber} is not cancelled; cancel it on the order if needed.` : ''}
        </SectionHelper>
      )}
    </Box>
  );
};

type EditValues = { reason: string; refundAmount: number; priceDifference: number; postageCharge: number; exchangeItems: ExchangeLine[] };

/** Edits what's still editable: reason, refund, charges (until a payment link exists), replacements (until the order exists). */
const EditPanel: FC<{ rec: Stored; busy: boolean; onCancel: () => void; onSave: (e: EditValues) => void }> = ({
  rec, busy, onCancel, onSave,
}) => {
  const can = editability(rec);
  const [reason, setReason] = useState(rec.reason);
  const [refundAmount, setRefund] = useState(rec.refundAmount);
  const [priceDifference, setPriceDiff] = useState(rec.priceDifference);
  const [postageCharge, setPostage] = useState(rec.postageCharge);
  const [exchangeItems, setExchangeItems] = useState<ExchangeLine[]>(rec.exchangeItems);
  const money = (set: (n: number) => void) => (v: number | null) => set(v ?? 0);
  return (
    <Card>
      <Card.Header title="Edit return" />
      <Card.Divider />
      <Card.Content>
        <Box direction="vertical" gap="SP3">
          <Box gap="SP3">
            <FormField label="Reason">
              <Dropdown selectedId={reason} options={[...new Set([...REASONS, rec.reason])].map((r) => ({ id: r, value: r }))}
                onSelect={(o: any) => setReason(String(o.id))} />
            </FormField>
            <FormField label="Refund owed">
              <NumberInput prefix={<Input.Affix>£</Input.Affix>} min={0} step={0.01} value={refundAmount} onChange={money(setRefund)} />
            </FormField>
          </Box>
          {rec.kind === 'EXCHANGE' && (can.charges ? (
            <Box gap="SP3">
              <FormField label="Price difference charge">
                <NumberInput prefix={<Input.Affix>£</Input.Affix>} min={0} step={0.01} value={priceDifference} onChange={money(setPriceDiff)} />
              </FormField>
              <FormField label="Postage charge">
                <NumberInput prefix={<Input.Affix>£</Input.Affix>} min={0} step={0.01} value={postageCharge} onChange={money(setPostage)} />
              </FormField>
            </Box>
          ) : (
            <Text size="small" secondary>Charges are fixed because a payment link exists. Settle any difference with a refund.</Text>
          ))}
          {rec.kind === 'EXCHANGE' && (can.replacementItems ? (
            <ExchangePicker currency="GBP" items={exchangeItems} onChange={setExchangeItems} />
          ) : (
            <Text size="small" secondary>Replacement items are fixed because order #{rec.exchangeOrderNumber} exists. Change that order in Wix instead.</Text>
          ))}
          <Box gap="SP2" align="right">
            <Button priority="secondary" size="small" onClick={onCancel} disabled={busy}>Cancel</Button>
            <Button size="small" disabled={busy || (rec.kind === 'EXCHANGE' && can.replacementItems && exchangeItems.length === 0)}
              onClick={() => onSave({ reason, refundAmount, priceDifference, postageCharge, exchangeItems })}>
              Save changes
            </Button>
          </Box>
        </Box>
      </Card.Content>
    </Card>
  );
};

const PaymentBox: FC<{
  rec: Stored; busy: string; onCreate: () => void; onRefresh: () => void; onMarkPaid: () => void;
}> = ({ rec, busy, onCreate, onRefresh, onMarkPaid }) => {
  if (rec.paymentStatus === 'PAID') return <SectionHelper appearance="success">Customer has paid {formatMoney(rec.amountDue)}.</SectionHelper>;
  if (!rec.paymentRequestId)
    return (
      <SectionHelper appearance="warning" actionText={busy === 'link' ? 'Creating…' : 'Create payment link'} onAction={onCreate}>
        No payment link yet. (Needs a published Payment Request page on the site, see README.)
      </SectionHelper>
    );
  return (
    <SectionHelper appearance={rec.paymentStatus === 'UNPAID' ? 'warning' : 'danger'}>
      <Box direction="vertical" gap="SP1">
        <Text size="small">Payment link {rec.paymentStatus.toLowerCase()}. Send it to the customer:</Text>
        <Text size="small" weight="bold">{rec.paymentRequestUrl}</Text>
        <Box gap="SP3">
          <TextButton size="small" onClick={() => navigator.clipboard?.writeText(rec.paymentRequestUrl).then(() => toastOk('Link copied'))}>Copy link</TextButton>
          <TextButton size="small" onClick={onRefresh} disabled={!!busy}>Check if paid</TextButton>
          <TextButton size="small" onClick={onMarkPaid} disabled={!!busy}>Paid another way</TextButton>
          {rec.paymentStatus !== 'UNPAID' && <TextButton size="small" onClick={onCreate} disabled={!!busy}>New link</TextButton>}
        </Box>
      </Box>
    </SectionHelper>
  );
};
