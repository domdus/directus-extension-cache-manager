import { defineModule } from '@directus/extensions-sdk';
import { EXTENSION_ID } from '../shared/constants';
import { userHasAdminAccess } from '../shared/admin';
import ClearingView from './clearing-view.vue';
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
			path: 'clearing',
			component: ClearingView,
		},
		{
			path: 'settings',
			component: SettingsView,
		},
		{
			// Earlier names of the Cache clearing page.
			path: 'collections',
			redirect: '/cache-manager/clearing',
		},
		{
			path: 'analysis',
			redirect: '/cache-manager/clearing',
		},
	],
	// The endpoint checks admin rights too; this only hides the module for everyone else.
	preRegisterCheck(user) {
		return userHasAdminAccess(user);
	},
});
