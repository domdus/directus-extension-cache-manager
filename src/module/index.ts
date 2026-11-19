import { defineModule } from '@directus/extensions-sdk';
import { EXTENSION_ID } from '../shared/constants';
import { userHasAdminAccess } from '../shared/admin';
import AnalysisView from './analysis-view.vue';
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
	],
	// The endpoint checks admin rights too; this only hides the module for everyone else.
	preRegisterCheck(user) {
		return userHasAdminAccess(user);
	},
});
