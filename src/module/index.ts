import { defineModule } from '@directus/extensions-sdk';
import { EXTENSION_ID } from '../shared/constants';
import { userHasAdminAccess } from '../shared/admin';
import OptimizeView from './optimize-view.vue';
import GranularView from './granular-view.vue';
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
			path: 'optimize',
			component: OptimizeView,
		},
		{
			path: 'cache',
			component: GranularView,
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
			// Earlier names of the Optimize page.
			path: 'clearing',
			redirect: '/cache-manager/optimize',
		},
		{
			path: 'collections',
			redirect: '/cache-manager/optimize',
		},
		{
			path: 'analysis',
			redirect: '/cache-manager/optimize',
		},
	],
	// The endpoint checks admin rights too; this only hides the module for everyone else.
	preRegisterCheck(user) {
		return userHasAdminAccess(user);
	},
});
