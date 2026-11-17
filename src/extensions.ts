import { app } from '@wix/custom-extensions';
import returnsExchanges from './extensions/dashboard/plugins/returns-exchanges/returns-exchanges.extension.ts';
import returnEditor from './extensions/dashboard/modals/return-editor/return-editor.extension.ts';
import returns from './extensions/dashboard/pages/returns/returns.extension.ts';
import dataCollections from './extensions/backend/data-collections/data-collections.extension.ts';

export default app().use(returnsExchanges).use(returnEditor).use(returns).use(dataCollections);
