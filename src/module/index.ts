import { defineModule } from '@directus/extensions-sdk';
import ModuleComponent from './module.vue';
import { EXTENSION_ID } from '../shared/constants';

export default defineModule({
	id: EXTENSION_ID,
	name: 'Cache manager',
	icon: 'cached',
	routes: [{ path: '', component: ModuleComponent }],
	// The endpoint checks admin rights too; this only hides the module for everyone else.
	preRegisterCheck: (user) => user.admin_access === true,
});
