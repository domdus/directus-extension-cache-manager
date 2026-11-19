<template>
	<sidebar-detail id="stale-reads" icon="schedule" title="Stale reads (CACHE_TTL)">
		<p class="sidebar-text">
			Cached responses live for <strong>CACHE_TTL = {{ ttl }}</strong>. The value is read from the running
			configuration.
		</p>
		<p class="sidebar-text">
			Writes to an ignored collection do not clear the cache. Apps can then read data up to {{ ttl }} old, unless
			they send <code>Cache-Control: no-store</code>, which only works with CACHE_SKIP_ALLOWED on.
		</p>
		<p class="sidebar-text">The Data Studio always bypasses the cache for ignored collections, so editors see current data.</p>
		<p class="sidebar-text">With CACHE_AUTO_PURGE off, this applies to every collection.</p>
	</sidebar-detail>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { useCacheManager } from './composables/use-cache-manager';

const { state } = useCacheManager();
const ttl = computed(() => String(state.value?.env.CACHE_TTL ?? '–'));
</script>

<style scoped>
.sidebar-text {
	margin: 0 0 16px;
	line-height: 1.55;
	color: var(--theme--foreground);
}
</style>
