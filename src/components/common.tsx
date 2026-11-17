import type { FC } from 'react';
import { Badge } from '@wix/design-system';
import { dashboard } from '@wix/dashboard';
import { STATUS_LABELS, type ReturnRecord } from '../lib/returns-logic';

export const StatusBadge: FC<{ status: ReturnRecord['status'] }> = ({ status }) => {
  const skin = ({ AWAITING_ITEM: 'warning', RECEIVED: 'general', COMPLETED: 'success', CANCELLED: 'neutralLight' } as const)[status];
  return (
    <Badge size="small" skin={skin as any}>
      {STATUS_LABELS[status] ?? status}
    </Badge>
  );
};

export const KindBadge: FC<{ kind: ReturnRecord['kind'] }> = ({ kind }) => (
  <Badge size="small" skin={kind === 'EXCHANGE' ? 'premium' : 'standard'} type="outlined">
    {kind === 'EXCHANGE' ? 'Exchange' : 'Return'}
  </Badge>
);

export function errorText(e: unknown): string {
  const anyE = e as any;
  return (
    anyE?.details?.applicationError?.description ??
    anyE?.message ??
    (typeof e === 'string' ? e : 'Something went wrong')
  );
}

export function toastError(e: unknown, prefix = '') {
  console.error(e);
  dashboard.showToast({ message: `${prefix}${errorText(e)}`, type: 'error' });
}

export function toastOk(message: string) {
  dashboard.showToast({ message, type: 'success' });
}

export function fmtDate(iso?: string | Date) {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}
