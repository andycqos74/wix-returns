import { extensions } from '@wix/custom-extensions'
import config from './return-editor.config.ts';

export default extensions.dashboardModal({
  id: 'ab10af7d-6a6e-496e-95d9-586683e9e16a',
  title: config.title,
  width: config.width,
  height: config.height,
  component: './extensions/dashboard/modals/return-editor/return-editor.tsx',
});
