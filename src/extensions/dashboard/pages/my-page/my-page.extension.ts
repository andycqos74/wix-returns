import { extensions } from '@wix/custom-extensions';

export default extensions.dashboardPage({
  id: '4f66afdb-c9f0-475a-8388-ff562474565a',
  title: 'My Page',
  routePath: '',
  component: './extensions/dashboard/pages/my-page/my-page.tsx',
  fullPage: false,
  metaData: {
    searchable: true,
    description: 'Manage My Page in your dashboard.',
  },
});
