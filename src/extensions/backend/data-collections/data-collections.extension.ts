import { extensions } from '@wix/custom-extensions'

import returnsCollection from './returns';

export default extensions.dataCollections({
  id: 'e9c39cbe-e835-4e44-bcd1-2eba855d2de6',
  name: 'Returns data',
  collections: [returnsCollection],
});
