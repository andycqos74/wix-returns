// Order page (Sales > Orders > an order), right-hand column.
// Lists this order's returns/exchanges and opens the editor to log a new one.
import { useCallback, useEffect, useState, type FC } from 'react';
import { dashboard } from '@wix/dashboard';
import type { plugins } from '@wix/ecom/dashboard';
import { Box, Button, Card, Loader, Text, TextButton, WixDesignSystemProvider } from '@wix/design-system';
import '@wix/design-system/styles.global.css';
import { RETURN_EDITOR_MODAL_ID } from '../../../../lib/config';
import { formatMoney } from '../../../../lib/returns-logic';
import { listReturnsForOrder } from '../../../../lib/wix-ops';
import { BuildStamp, KindBadge, StatusBadge, errorText } from '../../../../components/common';

type Props = plugins.OrderDetails.OrderRightPanelParams;

const OrderReturnsPlugin: FC<Props> = (props) => {
  // The slot passes { orderId, onOrderUpdate } as props; observeState is the fallback route for the same data.
  const [observed, setObserved] = useState<Partial<Props>>({});
  useEffect(() => dashboard.observeState<Partial<Props>>((p) => setObserved(p)).disconnect, []);
  const orderId = props.orderId ?? observed.orderId ?? '';
  const onOrderUpdate = ((props as any).onOrderUpdate ?? (observed as any).onOrderUpdate) as undefined | (() => Promise<void>);
  const [rows, setRows] = useState<Awaited<ReturnType<typeof listReturnsForOrder>>>();
  const [error, setError] = useState('');

  const load = useCallback(() => {
    if (!orderId) return;
    listReturnsForOrder(orderId).then(setRows).catch((e) => setError(errorText(e)));
  }, [orderId]);
  useEffect(load, [load]);

  function open(returnId?: string) {
    const { modalClosed } = dashboard.openModal({ modalId: RETURN_EDITOR_MODAL_ID, params: { orderId, returnId } });
    modalClosed.then(() => {
      load();
      onOrderUpdate?.().catch(() => {});
    });
  }

  return (
    <WixDesignSystemProvider features={{ newColorsBranding: true }}>
      <Card>
        <Card.Header title="Returns & exchanges"
          suffix={<Button size="small" onClick={() => open()}>Process return</Button>} />
        <Card.Divider />
        <Card.Content size="medium">
          {error ? (
            <Text size="small" skin="error">{error}</Text>
          ) : !rows ? (
            <Loader size="tiny" />
          ) : rows.length === 0 ? (
            <Text size="small" secondary>None for this order.</Text>
          ) : (
            <Box direction="vertical" gap="SP3">
              {rows.map((r) => (
                <Box key={r._id} direction="vertical" gap="SP1">
                  <Box gap="SP2" verticalAlign="middle">
                    <TextButton size="small" onClick={() => open(r._id)}>{r.returnNumber}</TextButton>
                    <KindBadge kind={r.kind} />
                    <StatusBadge status={r.status} />
                  </Box>
                  <Text size="tiny" secondary>
                    {r.items.reduce((s, i) => s + i.quantity, 0)} item(s) · {r.reason}
                    {r.kind === 'EXCHANGE' && r.exchangeOrderNumber ? ` · replacement #${r.exchangeOrderNumber}` : ''}
                    {r.kind === 'EXCHANGE' && r.amountDue > 0 ? ` · ${formatMoney(r.amountDue)} ${r.paymentStatus === 'PAID' ? 'paid' : 'due'}` : ''}
                    {r.refundStatus === 'DUE' ? ` · refund ${formatMoney(r.refundAmount)} owed` : ''}
                  </Text>
                </Box>
              ))}
            </Box>
          )}
          <Box marginTop="SP3"><BuildStamp /></Box>
        </Card.Content>
      </Card>
    </WixDesignSystemProvider>
  );
};

export default OrderReturnsPlugin;
