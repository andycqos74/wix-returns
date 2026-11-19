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

/**
 * Readable text for a Wix SDK error. The SDK puts a JSON blob in `message` and reports
 * "UNKNOWN" as the description when the HTTP response has no status text, so dig out
 * the server message, HTTP status, error code and request ID instead.
 */
export function errorText(e: unknown): string {
  if (typeof e === 'string') return e;
  const err = e as any;
  if (!err) return 'Something went wrong';
  let message: string = err.message ?? '';
  try {
    const parsed = JSON.parse(message);
    if (parsed && typeof parsed.message === 'string') message = parsed.message;
  } catch {
    /* plain-text message */
  }
  const app = err.details?.applicationError;
  const code = app?.code && app.code !== 'UNKNOWN' ? app.code : '';
  const description = app?.description && app.description !== 'UNKNOWN' && app.description !== message ? app.description : '';
  const status: number | undefined = err.status;
  const requestId: string | undefined = err.requestId ?? err.details?.requestId;

  const main = [message && message !== 'UNKNOWN' ? message : '', description].filter(Boolean).join(': ') || 'Request failed';
  const meta = [status && `HTTP ${status}`, code, requestId && `request ${requestId}`].filter(Boolean).join(', ');
  const hint =
    status === 403 || status === 401
      ? ' The app is missing a permission on this site: add it in the app dashboard (Develop > Permissions), then re-approve the app on the site (Agree & Update).'
      : status === 404
        ? ' Wix says this does not exist on this site.'
        : '';
  return `${main}${meta ? ` (${meta})` : ''}.${hint}`;
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
