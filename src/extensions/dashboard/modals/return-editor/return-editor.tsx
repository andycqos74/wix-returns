// Modal opened from the order page panel and the Returns page.
// Params: { orderId, returnId? }. No returnId = log a new return for the order.
import { useEffect, useState, type FC } from 'react';
import { dashboard } from '@wix/dashboard';
import { Box, CustomModalLayout, Loader, WixDesignSystemProvider } from '@wix/design-system';
import '@wix/design-system/styles.global.css';
import { NewReturnForm } from '../../../../components/NewReturnForm';
import { ReturnDetail } from '../../../../components/ReturnDetail';

interface Params {
  orderId?: string;
  returnId?: string;
}

const ReturnEditorModal: FC = () => {
  const [params, setParams] = useState<Params>();
  const [returnId, setReturnId] = useState<string>();
  const [changed, setChanged] = useState(false);

  useEffect(() => {
    const { disconnect } = dashboard.observeState<Params>((p) => {
      setParams(p);
      setReturnId(p.returnId || undefined);
    });
    return disconnect;
  }, []);

  const close = () => dashboard.closeModal({ changed });

  return (
    <WixDesignSystemProvider features={{ newColorsBranding: true }}>
      <CustomModalLayout
        // The modal frame is already sized by return-editor.config.ts; fill it rather than match it,
        // or the layout's border overflows and adds scrollbars.
        width="100%"
        maxHeight="100vh"
        title={returnId ? 'Return / exchange' : 'Process a return or exchange'}
        onCloseButtonClick={close}
        content={
          !params ? (
            <Box align="center" padding="SP6"><Loader size="small" /></Box>
          ) : returnId ? (
            <ReturnDetail returnId={returnId} onChanged={() => setChanged(true)} />
          ) : params.orderId ? (
            <NewReturnForm
              orderId={params.orderId}
              onCancel={close}
              onDone={(id) => {
                setChanged(true);
                setReturnId(id); // stay open on the new return so payment link / restock are right there
              }}
            />
          ) : null
        }
      />
    </WixDesignSystemProvider>
  );
};

export default ReturnEditorModal;
