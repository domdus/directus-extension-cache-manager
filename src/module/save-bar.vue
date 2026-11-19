<template>
	<div v-if="state" class="save-bar">
		<span class="muted" :class="{ danger: status.danger }">{{ status.text }}</span>
		<div class="actions-right">
			<v-button secondary :disabled="!dirty || saving" @click="discard">Discard Changes</v-button>
			<v-button :loading="saving" :disabled="!canSave || busy" @click="save">Save &amp; Apply</v-button>
		</div>
	</div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { useCacheManager } from './composables/use-cache-manager';
import { pendingChanges, saveBarText } from '../shared/pending';

const { state, draft, dirty, canSave, ttlValid, busy, saving, save, discard } = useCacheManager();

const status = computed(() => saveBarText(pendingChanges(draft, state.value?.effective).length, ttlValid.value));
</script>

<style scoped>
/* Stays visible at the bottom of the page content while scrolling, like a form footer. */
.save-bar {
	position: sticky;
	bottom: 0;
	z-index: 5;
	display: flex;
	flex-wrap: wrap;
	align-items: center;
	justify-content: flex-end;
	gap: 12px;
	margin-top: 20px;
	padding: 12px 0;
	border-top: var(--theme--border-width, 1px) solid var(--theme--border-color-subdued);
	background: var(--theme--background);
}
.muted {
	margin-right: auto;
	color: var(--theme--foreground-subdued);
}
.muted.danger {
	color: var(--theme--danger);
}
.actions-right {
	display: flex;
	flex-wrap: wrap;
	align-items: center;
	gap: 8px;
}
</style>
