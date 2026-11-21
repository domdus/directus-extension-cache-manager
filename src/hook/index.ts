import { defineHook } from '@directus/extensions-sdk';
import { applyEffective, captureBaseline, describe, ensureSettingsField, markStartupApplied, migrateIgnoreList, readRules, readStored, startupApplied, type ApiContext } from '../api/state';
import { installTargeted, requestMiddleware, runtime } from '../api/targeted';
import { describeRules } from '../shared/rules';
import { LOG_PREFIX } from '../shared/constants';

/**
 * Captures the values Directus started with (its configuration) as baseline and re-applies the stored override at startup.
 * Overrides live only in the process' env object and are lost on restart, so this must run on every start.
 * Also installs Granular Cache (see api/targeted.ts).
 */
export default defineHook(({ init }, context) => {
	const ctx = context as unknown as ApiContext;
	// Runs while extensions are registered, before app.before and before any override is applied.
	const baseline = captureBaseline(ctx.env);
	// Set by an earlier load in this process: the extension was reloaded in a running Directus (update, auto reload).
	// Then app.before and middlewares.after don't fire again.
	const reloaded = startupApplied();

	async function installRules() {
		try {
			const rules = await readRules(ctx.database);
			await installTargeted(ctx, rules);
			ctx.logger.info(`${LOG_PREFIX} granular cache: ${describeRules(rules)}`);
		} catch (error) {
			// Without the patches Directus clears the whole cache as usual.
			ctx.logger.error(error, `${LOG_PREFIX} could not start granular cache, Directus clears the whole cache as usual`);
		}
	}

	/** Converts a saved ignore list from an older version into rules (once). Never blocks startup. */
	async function migrate() {
		try {
			await migrateIgnoreList(ctx);
		} catch (error) {
			ctx.logger.error(error, `${LOG_PREFIX} could not move the saved ignore list to rules; it still applies`);
		}
	}

	if (reloaded) {
		// The rules work right away; the request middleware (which collections an answer uses) needs a restart.
		void (async () => {
			await migrate();
			applyEffective(ctx.env, await readStored(ctx.database));
			await installRules();
		})();
		if (!runtime().middlewareRegistered) {
			ctx.logger.warn(`${LOG_PREFIX} extension reloaded without a restart: restart Directus to use Granular mode`);
		}
	}

	init('app.before', async () => {
		try {
			await ensureSettingsField(ctx);
			await migrate();
			const stored = await readStored(ctx.database);
			const effective = applyEffective(ctx.env, stored);
			markStartupApplied();
			if (stored) ctx.logger.info(`${LOG_PREFIX} applied stored override: ${describe(effective)} (config: ${describe(baseline)})`);
			else ctx.logger.info(`${LOG_PREFIX} no stored override, using config: ${describe(baseline)}`);
		} catch (error) {
			// Never block startup: Directus keeps running with the config values.
			ctx.logger.error(error, `${LOG_PREFIX} could not apply the stored override, using config values`);
		}

		await installRules();
	});

	// After Directus' cache check, before the routes: records what each answer depends on.
	init('middlewares.after', ({ app }: any) => {
		app.use(requestMiddleware());
	});
});
