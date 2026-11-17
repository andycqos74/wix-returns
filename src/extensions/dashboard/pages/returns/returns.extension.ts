import { extensions } from '@wix/custom-extensions'

export default extensions.dashboardPage({
  id: '0ca4903f-127c-4ad5-aaf8-7f2eddbddb40',
  title: "Returns & exchanges",
  routePath: 'returns',
  component: './extensions/dashboard/pages/returns/returns.tsx',
  fullPage: false,
  metaData: {
    searchable: true,
    description: "Manage Returns & exchanges in your dashboard.",
  },
});
