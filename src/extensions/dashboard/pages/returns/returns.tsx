// Dashboard page: every return/exchange, filterable. Click a row to open it.
import { useCallback, useEffect, useMemo, useState, type FC } from 'react';
import { dashboard } from '@wix/dashboard';
import {
  Box, Card, Dropdown, Page, Search, Table, TableToolbar, Text, WixDesignSystemProvider,
} from '@wix/design-system';
import '@wix/design-system/styles.global.css';
import { RETURN_EDITOR_MODAL_ID } from '../../../../lib/config';
import { STATUS_LABELS, formatMoney, type ReturnRecord } from '../../../../lib/returns-logic';
import { listReturns } from '../../../../lib/wix-ops';
import { KindBadge, StatusBadge, errorText, fmtDate } from '../../../../components/common';

type Row = ReturnRecord & { _id: string; _createdDate?: Date };

const STATUS_OPTIONS = [
  { id: 'OPEN', value: 'Open (awaiting + received)' },
  { id: '', value: 'All statuses' },
  ...Object.entries(STATUS_LABELS).map(([id, value]) => ({ id, value })),
];
const KIND_OPTIONS = [
  { id: '', value: 'Returns & exchanges' },
  { id: 'RETURN', value: 'Returns only' },
  { id: 'EXCHANGE', value: 'Exchanges only' },
];

function outstanding(r: Row): string {
  return [
    r.status === 'AWAITING_ITEM' && 'item back',
    r.items.some((i) => i.restockQty > 0 && !i.restocked) && r.status !== 'AWAITING_ITEM' && 'restock',
    r.kind === 'EXCHANGE' && !r.exchangeOrderId && r.status !== 'CANCELLED' && 'replacement order',
    r.kind === 'EXCHANGE' && r.amountDue > 0 && r.paymentStatus !== 'PAID' && r.status !== 'CANCELLED' && `${formatMoney(r.amountDue)} from customer`,
    r.refundStatus === 'DUE' && r.status !== 'CANCELLED' && `${formatMoney(r.refundAmount)} refund`,
  ].filter(Boolean).join(', ');
}

const ReturnsPage: FC = () => {
  const [status, setStatus] = useState('OPEN');
  const [kind, setKind] = useState('');
  const [search, setSearch] = useState('');
  const [rows, setRows] = useState<Row[]>();
  const [error, setError] = useState('');

  const load = useCallback(() => {
    setError('');
    listReturns({ kind: kind || undefined, status: status && status !== 'OPEN' ? status : undefined })
      .then((rs) => setRows(status === 'OPEN' ? rs.filter((r) => r.status === 'AWAITING_ITEM' || r.status === 'RECEIVED') : rs))
      .catch((e) => setError(errorText(e)));
  }, [status, kind]);
  useEffect(load, [load]);

  const shown = useMemo(() => {
    const s = search.trim().toLowerCase();
    if (!s || !rows) return rows;
    return rows.filter((r) =>
      [r.returnNumber, r.orderNumber, r.customerName, r.customerEmail, r.exchangeOrderNumber]
        .some((v) => String(v ?? '').toLowerCase().includes(s)));
  }, [rows, search]);

  function open(r: Row) {
    dashboard.openModal({ modalId: RETURN_EDITOR_MODAL_ID, params: { orderId: r.orderId, returnId: r._id } })
      .modalClosed.then(load);
  }

  const columns = [
    { title: 'Return', render: (r: Row) => <Text weight="normal">{r.returnNumber}</Text> },
    { title: 'Type', render: (r: Row) => <KindBadge kind={r.kind} /> },
    { title: 'Status', render: (r: Row) => <StatusBadge status={r.status} /> },
    { title: 'Customer', render: (r: Row) => <Text size="small">{r.customerName || r.customerEmail}</Text> },
    { title: 'Logged', render: (r: Row) => <Text size="small">{fmtDate(r._createdDate)}</Text> },
    { title: 'Still to do', render: (r: Row) => <Text size="small" secondary>{outstanding(r) || '—'}</Text> },
  ];

  return (
    <WixDesignSystemProvider features={{ newColorsBranding: true }}>
      <Page>
        <Page.Header title="Returns & exchanges"
          subtitle="Start a new one from an order: Sales > Orders > open the order > Process return." />
        <Page.Content>
          <Card>
            <TableToolbar>
              <TableToolbar.ItemGroup position="start">
                <TableToolbar.Item>
                  <Box width="220px"><Dropdown size="small" options={STATUS_OPTIONS} selectedId={status} onSelect={(o: any) => setStatus(String(o.id))} /></Box>
                </TableToolbar.Item>
                <TableToolbar.Item>
                  <Box width="200px"><Dropdown size="small" options={KIND_OPTIONS} selectedId={kind} onSelect={(o: any) => setKind(String(o.id))} /></Box>
                </TableToolbar.Item>
              </TableToolbar.ItemGroup>
              <TableToolbar.ItemGroup position="end">
                <TableToolbar.Item>
                  <Search size="small" placeholder="Return, order, customer" value={search}
                    onChange={(e: any) => setSearch(e.target.value)} onClear={() => setSearch('')} />
                </TableToolbar.Item>
              </TableToolbar.ItemGroup>
            </TableToolbar>
            {error ? (
              <Box padding="SP4"><Text skin="error">{error}</Text></Box>
            ) : shown && shown.length === 0 ? (
              <Box padding="SP6" align="center"><Text secondary>Nothing here.</Text></Box>
            ) : (
              <Table data={shown ?? []} columns={columns} onRowClick={(r: Row) => open(r)} showSelection={false}>
                <Table.Content />
              </Table>
            )}
          </Card>
        </Page.Content>
      </Page>
    </WixDesignSystemProvider>
  );
};

export default ReturnsPage;
