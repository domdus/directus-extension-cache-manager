import { defineHook } from '@directus/extensions-sdk';
import { applyEffective, captureBaseline, describe, ensureSettingsField, markStartupApplied, readStored, type ApiContext } from '../api/state';
import { LOG_PREFIX } from '../shared/constants';

/**
 * Captures the values Directus started with (its configuration) as baseline and re-applies the stored override at startup.
 * Overrides live only in the process' env object and are lost on restart, so this must run on every start.
 */
export default defineHook(({ init }, context) => {
	const ctx = context as unknown as ApiContext;
	// Runs while extensions are registered, before app.before and before any override is applied.
	const baseline = captureBaseline(ctx.env);

	init('app.before', async () => {
		try {
			await ensureSettingsField(ctx);
			const stored = await readStored(ctx.database);
			const effective = applyEffective(ctx.env, stored);
			markStartupApplied();
			if (stored) ctx.logger.info(`${LOG_PREFIX} applied stored override: ${describe(effective)} (config: ${describe(baseline)})`);
			else ctx.logger.info(`${LOG_PREFIX} no stored override, using config: ${describe(baseline)}`);
		} catch (error) {
			// Never block startup: Directus keeps running with the config values.
			ctx.logger.error(error, `${LOG_PREFIX} could not apply the stored override, using config values`);
		}
	});
});
