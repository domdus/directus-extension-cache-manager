<template>
	<!-- Header actions (private-view #actions): discard and save, like Directus' own pages. -->
	<template v-if="state">
		<v-button
			v-tooltip.bottom="'Discard Changes'"
			rounded
			icon
			secondary
			:disabled="!dirty || saving"
			@click="discard"
		>
			<v-icon name="undo" />
		</v-button>
		<v-button v-tooltip.bottom="saveTooltip" rounded icon :loading="saving" :disabled="!canSave || busy" @click="save">
			<v-icon name="check" />
		</v-button>
	</template>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { useCacheManager } from './composables/use-cache-manager';
import { pendingChanges, saveBarText } from '../shared/pending';

const { state, draft, dirty, canSave, ttlValid, busy, saving, save, discard } = useCacheManager();

/** "Save & Apply (2 unsaved changes)", or why saving is not possible. */
const saveTooltip = computed(() => {
	const status = saveBarText(pendingChanges(draft, state.value?.effective).length, ttlValid.value);
	return dirty.value || status.danger ? `Save & Apply · ${status.text}` : 'Save & Apply';
});
</script>
