import { extensions } from '@wix/custom-extensions'

export default extensions.dashboardPlugin({
  id: '3f7219e6-f8a1-42f0-b0e3-2603fa92a0e2',
  title: "Returns & exchanges",
  extends: 'cb16162e-42aa-41bd-a644-dc570328c6cc',
  component: './extensions/dashboard/plugins/returns-exchanges/returns-exchanges.tsx',
});
