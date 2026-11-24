<template>
	<span v-if="trend" v-tooltip.top="trend.tooltip" class="trend" :class="`trend--${trend.tone}`">
		<v-icon :name="trend.up ? 'trending_up' : 'trending_down'" x-small />
		{{ trend.text }}
	</span>
</template>

<script setup lang="ts">
import type { Trend } from '../shared/trend';

defineProps<{ trend: Trend | null | undefined }>();
</script>

<style scoped>
.trend {
	display: inline-flex;
	align-items: center;
	gap: 2px;
	cursor: pointer;
	font-size: 0.75rem;
	font-weight: 600;
	font-variant-numeric: tabular-nums;
	white-space: nowrap;
}
.trend .v-icon {
	--v-icon-color: currentColor;
}
.trend--good {
	color: var(--theme--success, var(--success));
}
.trend--bad {
	color: var(--theme--danger, var(--danger));
}
.trend--neutral {
	color: var(--theme--foreground-subdued, var(--foreground-subdued));
}
</style>
