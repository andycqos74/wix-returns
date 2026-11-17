import { useEffect, useState, type FC } from 'react';
import {
  Box, Button, Card, FormField, Heading, InputArea, Loader, NumberInput, SectionHelper, Text, TextButton,
} from '@wix/design-system';
import { allowedTransitions, formatMoney, withHistory, type ReturnRecord } from '../lib/returns-logic';
import {
  createExchangeOrder, createPaymentLink, getReturn, receive, refreshPaymentStatus, restock, saveReturn,
} from '../lib/wix-ops';
import { KindBadge, StatusBadge, errorText, fmtDate, toastError, toastOk } from './common';

type Stored = ReturnRecord & { _id: string; _createdDate?: Date };

/** Everything you do to a logged return: receive & restock, exchange order, payment link, refund, close. */
export const ReturnDetail: FC<{ returnId: string; onChanged?: () => void }> = ({ returnId, onChanged }) => {
  const [r, setR] = useState<Stored | null>();
  const [busy, setBusy] = useState('');
  const [restockQty, setRestockQty] = useState<Record<string, number>>({});
  const [receiving, setReceiving] = useState(false);
  const [notes, setNotes] = useState('');
  const [loadError, setLoadError] = useState('');

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

  return (
    <Box direction="vertical" gap="SP4">
      <Box verticalAlign="middle" gap="SP2">
        <Heading size="small">{rec.returnNumber}</Heading>
        <KindBadge kind={rec.kind} />
        <StatusBadge status={rec.status} />
      </Box>
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
      {canMove.length > 0 && !receiving && (
        <Box gap="SP2" align="right">
          {canMove.includes('CANCELLED') && (
            <Button skin="destructive" priority="secondary" disabled={!!busy}
              onClick={() => set({ status: 'CANCELLED' }, 'Return cancelled.')}>Cancel return</Button>
          )}
          {canMove.includes('COMPLETED') && (
            <Button disabled={!!busy} onClick={() => set({ status: 'COMPLETED' }, 'Return completed.')}>Mark completed</Button>
          )}
        </Box>
      )}
      {rec.status === 'RECEIVED' && (rec.refundStatus === 'DUE' || (isExchange && rec.amountDue > 0 && rec.paymentStatus !== 'PAID') || pendingRestock) && (
        <Text size="tiny" secondary>Still open: {[
          rec.refundStatus === 'DUE' && 'refund',
          isExchange && rec.amountDue > 0 && rec.paymentStatus !== 'PAID' && 'customer payment',
          pendingRestock && 'restock',
        ].filter(Boolean).join(', ')}.</Text>
      )}
    </Box>
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
