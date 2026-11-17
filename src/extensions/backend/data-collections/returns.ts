import type { DataCollection } from '@wix/custom-extensions';

export const collectionIdSuffix = 'returns';

export default {
  idSuffix: collectionIdSuffix,
  displayName: 'Returns & Exchanges',
  displayField: 'returnNumber',
  fields: [
    { key: 'returnNumber', displayName: 'Return no.', type: 'TEXT' },
    { key: 'orderId', displayName: 'Order ID', type: 'TEXT' },
    { key: 'orderNumber', displayName: 'Order no.', type: 'TEXT' },
    { key: 'customerName', displayName: 'Customer', type: 'TEXT' },
    { key: 'customerEmail', displayName: 'Email', type: 'TEXT' },
    { key: 'kind', displayName: 'Type (RETURN / EXCHANGE)', type: 'TEXT' },
    { key: 'status', displayName: 'Status', type: 'TEXT' },
    { key: 'reason', displayName: 'Reason', type: 'TEXT' },
    { key: 'notes', displayName: 'Notes', type: 'TEXT' },
    { key: 'items', displayName: 'Items returned', type: 'ARRAY' },
    { key: 'creditValue', displayName: 'Value returned', type: 'NUMBER' },
    { key: 'refundStatus', displayName: 'Refund (NONE / DUE / DONE)', type: 'TEXT' },
    { key: 'refundAmount', displayName: 'Refund amount', type: 'NUMBER' },
    { key: 'exchangeItems', displayName: 'Replacement items', type: 'ARRAY' },
    { key: 'priceDifference', displayName: 'Price difference charged', type: 'NUMBER' },
    { key: 'postageCharge', displayName: 'Postage charged', type: 'NUMBER' },
    { key: 'amountDue', displayName: 'Amount due', type: 'NUMBER' },
    { key: 'exchangeOrderId', displayName: 'Replacement order ID', type: 'TEXT' },
    { key: 'exchangeOrderNumber', displayName: 'Replacement order no.', type: 'TEXT' },
    { key: 'paymentRequestId', displayName: 'Payment link ID', type: 'TEXT' },
    { key: 'paymentRequestUrl', displayName: 'Payment link', type: 'TEXT' },
    { key: 'paymentStatus', displayName: 'Payment status', type: 'TEXT' },
    { key: 'receivedDate', displayName: 'Received', type: 'TEXT' },
    { key: 'history', displayName: 'History', type: 'ARRAY' },
  ],
  // Dashboard-only data: no site visitor can read or write it.
  dataPermissions: {
    itemInsert: 'CMS_EDITOR',
    itemRead: 'CMS_EDITOR',
    itemRemove: 'CMS_EDITOR',
    itemUpdate: 'CMS_EDITOR',
  },
  indexes: [],
  initialData: [],
} satisfies DataCollection;
