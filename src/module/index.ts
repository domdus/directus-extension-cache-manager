import { defineModule } from '@directus/extensions-sdk';
import { EXTENSION_ID } from '../shared/constants';
import { userHasAdminAccess } from '../shared/admin';
import AnalysisView from './analysis-view.vue';
import GranularView from './granular-view.vue';
import StatisticsView from './statistics-view.vue';
import SettingsView from './settings-view.vue';
import StatusView from './status-view.vue';

export default defineModule({
	id: EXTENSION_ID,
	name: 'Cache Manager',
	icon: 'cached',
	routes: [
		{
			path: '',
			component: StatusView,
		},
		{
			path: 'analysis',
			component: AnalysisView,
		},
		{
			path: 'cache',
			component: GranularView,
		},
		{
			path: 'statistics',
			component: StatisticsView,
		},
		{
			path: 'settings',
			component: SettingsView,
		},
		{
			// Earlier name of the Granular Cache page.
			path: 'rules',
			redirect: '/cache-manager/cache',
		},
		{
			// Earlier names of the Analysis page (it was the Ignore List until rules replaced it).
			path: 'ignore-list',
			redirect: '/cache-manager/analysis',
		},
		{
			path: 'optimize',
			redirect: '/cache-manager/analysis',
		},
		{
			path: 'clearing',
			redirect: '/cache-manager/analysis',
		},
		{
			path: 'collections',
			redirect: '/cache-manager/analysis',
		},
	],
	// The endpoint checks admin rights too; this only hides the module for everyone else.
	preRegisterCheck(user) {
		return userHasAdminAccess(user);
	},
});
