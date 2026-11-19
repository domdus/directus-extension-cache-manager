import { defineEndpoint } from '@directus/extensions-sdk';
import type { NextFunction, Request, Response } from 'express';
import { buildAnalysis, parseHours, toBuckets } from '../shared/analysis';
import { DEFAULT_HOURS, EXTENSION_ID, LOG_PREFIX, MAX_HOURS, WRITE_ACTIONS } from '../shared/constants';
import { isEmptyOverride, mergeValues, readValues, sameValues, validateInput, type StoredOverride } from '../shared/settings';
import {
	applyEffective,
	describe,
	deleteSettingsField,
	ensureSettingsField,
	getBaseline,
	readStored,
	startupApplied,
	writeStored,
	type ApiContext,
} from '../api/state';

class HttpError extends Error {
	constructor(
		public status: number,
		message: string,
		public code = 'CACHE_MANAGER_ERROR',
	) {
		super(message);
	}
}

/** SQL for "epoch minute of activity.timestamp" per database client. */
function minuteExpression(client: string): string | null {
	if (['pg', 'postgres', 'postgresql', 'cockroachdb'].includes(client)) return 'floor(extract(epoch from ??) / 60)';
	if (['mysql', 'mysql2'].includes(client)) return 'floor(unix_timestamp(??) / 60)';
	return null;
}

function publicOrigin(env: Record<string, unknown>): string | null {
	try {
		return new URL(String(env['PUBLIC_URL'] ?? '')).origin;
	} catch {
		return null;
	}
}

function configPath(env: Record<string, unknown>): string | null {
	const value = env['CONFIG_PATH'] ?? process.env['CONFIG_PATH'];
	return typeof value === 'string' && value.trim() ? value.trim() : null;
}

export default defineEndpoint({
	id: EXTENSION_ID,
	handler: (router, context) => {
		const ctx = context as unknown as ApiContext;
		const { env, database, logger } = ctx;

		const adminOnly = (req: Request, _res: Response, next: NextFunction) => {
			const accountability = (req as any).accountability;
			if (!accountability?.user) return next(new HttpError(401, 'Log in as an administrator', 'UNAUTHORIZED'));
			if (accountability.admin !== true) return next(new HttpError(403, 'Only administrators can manage the cache', 'FORBIDDEN'));
			next();
		};

		const wrap = (fn: (req: Request, res: Response) => Promise<unknown>) => async (req: Request, res: Response) => {
			try {
				res.json(await fn(req, res));
			} catch (error) {
				const err = error as any;
				const status = err instanceof HttpError ? err.status : 500;
				if (status >= 500) logger.error(err, `${LOG_PREFIX} request failed`);
				res.status(status).json({ errors: [{ message: err?.message || 'Request failed', extensions: { code: err?.code ?? 'CACHE_MANAGER_ERROR' } }] });
			}
		};

		router.use(adminOnly);

		async function state() {
			const baseline = getBaseline(env);
			const stored = await readStored(database);
			const effective = readValues(env);
			const expected = mergeValues(baseline, stored);
			const schema = await ctx.getSchema();
			return {
				baseline,
				effective,
				stored,
				/** false when env differs from baseline + override (e.g. hook did not run, or another process saved). */
				inSync: sameValues(effective, expected),
				startupApplied: startupApplied(),
				env: {
					CACHE_ENABLED: Boolean(env['CACHE_ENABLED']),
					CACHE_TTL: env['CACHE_TTL'] ?? null,
					CACHE_STORE: env['CACHE_STORE'] ?? null,
					CACHE_AUTO_PURGE_IGNORE_LIST: effective.ignoreList,
				},
				/** Only shown when Directus was started with CONFIG_PATH; the source is not detected otherwise. */
				configPath: configPath(env),
				collections: Object.keys(schema.collections ?? {}).sort(),
			};
		}

		router.get('/state', wrap(state));

		router.get(
			'/analysis',
			wrap(async (req) => {
				const hours = parseHours(req.query['hours'], DEFAULT_HOURS, MAX_HOURS);
				const client = String(database.client?.config?.client ?? '');
				const minuteSql = minuteExpression(client);
				if (!minuteSql) throw new HttpError(501, `The analysis supports Postgres and MySQL, not "${client}"`, 'UNSUPPORTED_DATABASE');

				const windowMinutes = hours * 60;
				const nowMinute = Math.floor(Date.now() / 60000);
				const startMinute = nowMinute - windowMinutes + 1;
				const from = new Date(startMinute * 60000);
				const origin = publicOrigin(env);

				const minute = database.raw(minuteSql, ['timestamp']);
				const rows = await database('directus_activity')
					.select('collection')
					.select(database.raw(`${minuteSql} as minute`, ['timestamp']))
					.count({ writes: '*' })
					.select(
						origin
							? database.raw('sum(case when ?? is not null and ?? = ? then 1 else 0 end) as editor_writes', ['user', 'origin', origin])
							: database.raw('0 as editor_writes'),
					)
					.where('timestamp', '>=', from)
					.whereIn('action', WRITE_ACTIONS)
					.whereNotNull('collection')
					.groupBy('collection', minute);

				const candidateRaw = typeof req.query['candidate'] === 'string' ? req.query['candidate'] : null;
				const candidate = candidateRaw === null ? null : candidateRaw.split(',').map((entry) => entry.trim()).filter(Boolean);
				const effective = readValues(env);

				return buildAnalysis(toBuckets(rows, startMinute), {
					hours,
					windowMinutes,
					from,
					to: new Date(),
					ignoreList: effective.ignoreList,
					autoPurge: effective.autoPurge,
					editorHeuristic: Boolean(origin),
					candidate,
				});
			}),
		);

		router.post(
			'/apply',
			wrap(async (req) => {
				const schema = await ctx.getSchema();
				const result = validateInput(req.body, new Set(Object.keys(schema.collections ?? {})));
				if (!result.ok) throw new HttpError(400, result.errors.join('; '), 'INVALID_PAYLOAD');
				const accountability = (req as any).accountability;

				await ensureSettingsField(ctx);
				const stored: StoredOverride | null = isEmptyOverride(result.value)
					? null
					: { ...result.value, updatedAt: new Date().toISOString(), updatedBy: accountability.user };
				await writeStored(ctx, accountability, stored);
				const effective = applyEffective(env, stored);
				logger.info(`${LOG_PREFIX} override saved by ${accountability.user}: ${describe(effective)}`);
				return state();
			}),
		);

		router.post(
			'/reset',
			wrap(async (req) => {
				const accountability = (req as any).accountability;
				await ensureSettingsField(ctx);
				await writeStored(ctx, accountability, null);
				const effective = applyEffective(env, null);
				logger.info(`${LOG_PREFIX} reset to config by ${accountability.user}: ${describe(effective)}`);
				return state();
			}),
		);

		router.post(
			'/cleanup',
			wrap(async (req) => {
				const accountability = (req as any).accountability;
				const effective = applyEffective(env, null);
				const deletedField = await deleteSettingsField(ctx, accountability);
				logger.info(`${LOG_PREFIX} extension data removed by ${accountability.user}: ${describe(effective)}`);
				return { deletedField, state: await state() };
			}),
		);

		// Errors from adminOnly.
		router.use((error: any, _req: Request, res: Response, next: NextFunction) => {
			if (!(error instanceof HttpError)) return next(error);
			res.status(error.status).json({ errors: [{ message: error.message, extensions: { code: error.code } }] });
		});
	},
});
