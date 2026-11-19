<template>
	<v-notice v-if="changes.length" type="info" class="pending">
		<div>
			<strong>Not saved yet:</strong> {{ changes.join(' · ') }}.
			Save &amp; apply (top right) saves the changes from both pages.
			<button type="button" class="text-link" @click="discard">Discard</button>
		</div>
	</v-notice>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { useCacheManager } from './composables/use-cache-manager';
import { sameDuration } from '../shared/duration';

const { state, draft, discard } = useCacheManager();

const changes = computed(() => {
	const effective = state.value?.effective;
	if (!effective) return [];
	const list: string[] = [];
	const onOff = (value: boolean) => (value ? 'on' : 'off');
	if (draft.autoPurge !== effective.autoPurge) list.push(`clear the cache when content changes: ${onOff(draft.autoPurge)}`);
	if (draft.skipAllowed !== effective.skipAllowed) list.push(`allow apps to skip the cache: ${onOff(draft.skipAllowed)}`);
	if (!sameDuration(draft.ttl, effective.ttl)) list.push(`keep answers in the cache for: ${draft.ttl.trim() || '(empty)'}`);
	const now = new Set(effective.ignoreList);
	const next = new Set(draft.ignoreList);
	const added = draft.ignoreList.filter((name) => !now.has(name));
	const removed = effective.ignoreList.filter((name) => !next.has(name));
	if (added.length) list.push(`don't clear the cache for ${added.join(', ')}`);
	if (removed.length) list.push(`clear the cache again for ${removed.join(', ')}`);
	return list;
});
</script>

<style scoped>
.pending {
	margin-bottom: 20px;
}
.text-link {
	margin-left: 8px;
	padding: 0;
	border: none;
	background: none;
	color: var(--theme--primary);
	cursor: pointer;
	text-decoration: underline;
}
</style>
