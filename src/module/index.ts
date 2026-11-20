import { defineModule } from '@directus/extensions-sdk';
import { EXTENSION_ID } from '../shared/constants';
import { userHasAdminAccess } from '../shared/admin';
import IgnoreListView from './ignore-list-view.vue';
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
			path: 'ignore-list',
			component: IgnoreListView,
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
			// Earlier names of the Ignore List page.
			path: 'optimize',
			redirect: '/cache-manager/ignore-list',
		},
		{
			path: 'clearing',
			redirect: '/cache-manager/ignore-list',
		},
		{
			path: 'collections',
			redirect: '/cache-manager/ignore-list',
		},
		{
			path: 'analysis',
			redirect: '/cache-manager/ignore-list',
		},
	],
	// The endpoint checks admin rights too; this only hides the module for everyone else.
	preRegisterCheck(user) {
		return userHasAdminAccess(user);
	},
});
