// @ts-check
import { defineWixConfig } from '@wix/cli/config';
import customExtensions from '@wix/custom-extensions/flow';
import zeroConfig from '@wix/cli-zero-config-flow';

const appId = '9a720d8c-fc6a-4a64-85c4-6c64f8f26da9';

export default defineWixConfig({
  flows: [
    customExtensions({
      appId,
      projectId: 'returns-desk-admin',
      namespace: '@digital36657/returns-desk-admin',
      codeIdentifier: 'returns_desk_admin',
    }),
    zeroConfig({ appId }),
  ],
});
