import { LOG_PREFIX } from '../shared/constants';
import { parseRules } from '../shared/rules';
import { parseStored } from '../shared/settings';
import { applyEffective, readRaw, type ApiContext } from './state';
import { applyRules } from './targeted';

/**
 * Keeps every Directus server on the saved settings and rules. Saving only changes the server that handled the save;
 * the others notice the change in directus_settings within SYNC_EVERY and apply it, so no restart is needed. One small
 * query per server and interval. Lives on globalThis, so a reloaded extension replaces the timer instead of adding one.
 */
export const SYNC_EVERY = 10_000;
const KEY = Symbol.for('directus-extension-cache-manager.sync');
type SyncState = { timer: ReturnType<typeof setInterval> | null; last: string | undefined };

function state(): SyncState {
	const holder = globalThis as unknown as Record<symbol, SyncState | undefined>;
	return (holder[KEY] ??= { timer: null, last: undefined });
}

function signature(raw: unknown): string {
	return JSON.stringify(raw ?? null);
}

/** Checks once: applies the stored settings and rules when they differ from what this server saw last. */
export async function syncOnce(ctx: ApiContext): Promise<boolean> {
	const sync = state();
	const raw = await readRaw(ctx.database);
	const next = signature(raw);
	if (sync.last === undefined || next === sync.last) {
		sync.last = next;
		return false;
	}
	sync.last = next;
	const effective = applyEffective(ctx.env, parseStored(raw));
	await applyRules(parseRules(raw?.rules), 'save');
	ctx.logger.info(`${LOG_PREFIX} applied settings saved on another server: Auto Purge ${effective.autoPurge ? 'on' : 'off'}, lifetime ${effective.ttl}`);
	return true;
}

/** After this server saved: remember the new state, so the next check doesn't apply it a second time. */
export async function rememberSaved(ctx: ApiContext) {
	state().last = signature(await readRaw(ctx.database));
}

export function startSettingsSync(ctx: ApiContext, every = SYNC_EVERY) {
	const sync = state();
	if (sync.timer) clearInterval(sync.timer);
	sync.last = undefined;
	const check = () => syncOnce(ctx).catch((error) => ctx.logger.warn(error, `${LOG_PREFIX} could not check the saved settings`));
	void check();
	sync.timer = setInterval(check, every);
	(sync.timer as any).unref?.();
}

/** For tests. */
export function stopSettingsSync() {
	const sync = state();
	if (sync.timer) clearInterval(sync.timer);
	sync.timer = null;
	sync.last = undefined;
}
