<template>
	<article class="setting-card">
		<div class="card-titles">
			<strong>{{ title }}</strong>
			<span class="env-name">{{ env }}</span>
		</div>

		<div class="in-effect">
			<span class="caption">In use now</span>
			<div v-if="Array.isArray(effective)" class="chips">
				<v-chip
					v-for="name in effective"
					:key="name"
					v-tooltip="isAddedHere(name) ? addedTooltip(name) : undefined"
					small
					:class="{ 'added-here': isAddedHere(name) }"
				>
					{{ name }}
				</v-chip>
				<span v-if="!effective.length" class="value">None</span>
			</div>
			<span v-else class="value">{{ effective }}</span>
			<span v-if="addedCount" class="legend">
				<span class="legend-dot" />
				{{ addedCount === 1 ? '1 entry is' : `${addedCount} entries are` }} only saved here, not in the configuration.
			</span>
		</div>

		<div v-if="$slots.edit" class="edit">
			<slot name="edit" />
		</div>

		<div class="lines">
			<template v-if="readonly">
				<span>From the configuration. Can't be changed here.</span>
			</template>
			<template v-else>
				<span>Configured: {{ text(configured) }}</span>
				<span v-if="override !== null && override !== undefined">Saved here: {{ text(override) }}</span>
			</template>
		</div>

		<div v-if="$slots.default" class="card-actions">
			<slot />
		</div>
	</article>
</template>

<script setup lang="ts">
type Value = string | string[];

import { computed } from 'vue';

const props = withDefaults(
	defineProps<{
		title: string;
		env: string;
		effective: Value;
		configured?: Value | null;
		override?: Value | null;
		readonly?: boolean;
	}>(),
	{ configured: null, override: null, readonly: false },
);

const configuredSet = computed(() => new Set(Array.isArray(props.configured) ? props.configured : []));

function isAddedHere(name: string): boolean {
	return !props.readonly && Array.isArray(props.configured) && !configuredSet.value.has(name);
}

const addedCount = computed(() => (Array.isArray(props.effective) ? props.effective.filter(isAddedHere).length : 0));

function addedTooltip(name: string): string {
	return `Added here, not in the configuration. To keep it long term, add "${name}" to ${props.env} in your Directus configuration.`;
}

function text(value: Value | null | undefined): string {
	if (Array.isArray(value)) return value.length ? value.join(', ') : 'none';
	return value ?? '–';
}
</script>

<style scoped>
.setting-card {
	display: flex;
	flex-direction: column;
	gap: 12px;
	min-width: 0;
	padding: 16px 18px;
	border-radius: var(--theme--border-radius);
	border: var(--theme--border-width) solid var(--theme--border-color-subdued);
	background: var(--theme--background);
}
.card-titles {
	display: flex;
	flex-direction: column;
	gap: 2px;
	min-width: 0;
}
.card-titles strong {
	font-size: 15px;
	letter-spacing: 0.01em;
}
.env-name {
	font-family: var(--theme--fonts--monospace--font-family, monospace);
	font-size: 12px;
	color: var(--theme--foreground-subdued);
	overflow-wrap: anywhere;
}
.in-effect {
	display: flex;
	flex-direction: column;
	gap: 4px;
}
.caption {
	font-size: 12px;
	color: var(--theme--foreground-subdued);
}
.value {
	font-size: 18px;
	font-weight: 600;
}
.chips {
	display: flex;
	flex-wrap: wrap;
	gap: 6px;
}
.chips .added-here {
	--v-chip-color: var(--theme--primary);
	--v-chip-background-color: var(--theme--primary-background);
	--v-chip-color-hover: var(--theme--primary);
	--v-chip-background-color-hover: var(--theme--primary-subdued);
	cursor: help;
}
.legend {
	display: flex;
	align-items: center;
	gap: 6px;
	font-size: 12px;
	color: var(--theme--foreground-subdued);
}
.legend-dot {
	flex: none;
	inline-size: 8px;
	block-size: 8px;
	border-radius: 50%;
	background: var(--theme--primary);
}
.lines {
	display: flex;
	flex-direction: column;
	gap: 2px;
	font-size: 12px;
	color: var(--theme--foreground-subdued);
	overflow-wrap: anywhere;
}
.edit {
	display: flex;
	flex-direction: column;
	gap: 6px;
}
.card-actions {
	display: flex;
	justify-content: flex-end;
	padding-block-start: 12px;
	border-block-start: var(--theme--border-width) solid var(--theme--border-color-subdued);
}
</style>
