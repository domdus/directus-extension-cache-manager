import { test } from 'node:test';
import assert from 'node:assert/strict';
import { redisOf, SharedIndex, type RedisLike } from './shared-index';

/** Just enough of ioredis for SharedIndex: strings and sets, MULTI as a queue. */
class FakeRedis implements RedisLike {
	strings = new Map<string, string>();
	sets = new Map<string, Set<string>>();
	ttl = new Map<string, number>();
	private run(cmd: string, args: any[]): unknown {
		switch (cmd) {
			case 'sadd': {
				const [key, ...members] = args;
				const set = this.sets.get(key) ?? new Set<string>();
				for (const m of members) set.add(m);
				this.sets.set(key, set);
				return members.length;
			}
			case 'pexpire':
				this.ttl.set(args[0], args[1]);
				return 1;
			case 'sunion':
				return [...new Set(args.flatMap((key: string) => [...(this.sets.get(key) ?? [])]))];
			case 'del':
				for (const key of args) {
					this.sets.delete(key);
					this.strings.delete(key);
				}
				return args.length;
			case 'incr': {
				const next = (Number(this.strings.get(args[0])) || 0) + 1;
				this.strings.set(args[0], String(next));
				return next;
			}
			case 'set':
				this.strings.set(args[0], args[1]);
				return 'OK';
			case 'mset':
				for (let i = 0; i < args.length; i += 2) this.strings.set(args[i], args[i + 1]);
				return 'OK';
			case 'scard':
				return this.sets.get(args[0])?.size ?? 0;
		}
		throw new Error(`unknown ${cmd}`);
	}
	multi(): any {
		const queue: Array<[string, any[]]> = [];
		const proxy: any = new Proxy(
			{},
			{
				get: (_t, cmd: string) =>
					cmd === 'exec'
						? async () => queue.map(([c, a]) => [null, this.run(c, a)])
						: (...args: any[]) => {
								queue.push([cmd, args]);
								return proxy;
							},
			},
		);
		return proxy;
	}
	async get(key: string) {
		return this.strings.get(key) ?? null;
	}
	async mget(...keys: string[]) {
		return keys.map((key) => this.strings.get(key) ?? null);
	}
	async smembers(key: string) {
		return [...(this.sets.get(key) ?? [])];
	}
}

test('shared index: what one server stored, a change on another server finds', async () => {
	const redis = new FakeRedis();
	const serverA = new SharedIndex(redis, 'cache-manager:system-cache');
	const serverB = new SharedIndex(redis, 'cache-manager:system-cache');
	await serverA.add('k-pages', ['pages', 'services'], 3_600_000);
	await serverA.add('k-visits', ['visits'], 3_600_000);
	await serverB.add('k-graphql', ['*'], 3_600_000);
	assert.deepEqual(await serverB.counts(), { pages: 1, services: 1, visits: 1, '*': 1 });

	// A change to services, handled by server B, clears what server A stored (and responses that use everything).
	assert.deepEqual((await serverB.take(['services', '*'])).sort(), ['k-graphql', 'k-pages']);
	assert.deepEqual(await serverA.counts(), { pages: 1, visits: 1 });
	assert.equal(redis.ttl.get('cache-manager:system-cache:tag:pages'), 3_600_000);

	await serverA.clearAll();
	assert.deepEqual(await serverB.counts(), {});
});

test('shared index: a response read before a change on any server is recognised as stale', async () => {
	const redis = new FakeRedis();
	const serverA = new SharedIndex(redis, 'p');
	const serverB = new SharedIndex(redis, 'p');
	const start = await serverA.start();
	assert.equal(await serverA.isStale(new Set(['pages']), start), false);
	await serverB.markCleared(['visits']);
	assert.equal(await serverA.isStale(new Set(['pages']), start), false, 'another collection');
	assert.equal(await serverA.isStale(new Set(['*']), start), true, 'responses that use everything');
	await serverB.markCleared(['pages']);
	assert.equal(await serverA.isStale(new Set(['pages']), start), true);
	const later = await serverA.start();
	assert.equal(await serverA.isStale(new Set(['pages']), later), false);
	await serverB.markCleared('full');
	assert.equal(await serverA.isStale(new Set(['visits']), later), true);
});

test('shared index: found only behind a Redis store', () => {
	const client = new FakeRedis();
	assert.equal(redisOf({ opts: { store: { redis: client } } }), client);
	assert.equal(redisOf({ store: { redis: client } }), client);
	assert.equal(redisOf({ opts: { store: new Map() } }), null);
});
