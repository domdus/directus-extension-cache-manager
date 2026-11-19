<template>
	<v-notice v-if="changes.length" type="info" class="pending">
		<div><strong>Not saved yet:</strong> {{ changes.join(' · ') }}.</div>
	</v-notice>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { useCacheManager } from './composables/use-cache-manager';
import { pendingChanges } from '../shared/pending';

const { state, draft } = useCacheManager();

const changes = computed(() => pendingChanges(draft, state.value?.effective));
</script>

<style scoped>
.pending {
	margin-bottom: 20px;
}
</style>
