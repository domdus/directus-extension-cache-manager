<template>
	<article class="setting-card">
		<div class="card-head">
			<div class="card-titles">
				<div class="title-row">
					<strong>{{ title }}</strong>
					<v-icon
						v-if="hint"
						v-tooltip.bottom="hint"
						name="help_outline"
						small
						class="help"
					/>
				</div>
				<span v-if="description" class="description">{{ description }}</span>
			</div>
			<div v-if="$slots.control" class="control">
				<slot name="control" />
			</div>
			<span v-else-if="readonly && !Array.isArray(effective)" class="value">{{ effective }}</span>
			<div v-else-if="$slots.default" class="head-actions">
				<slot />
			</div>
		</div>

		<div v-if="$slots.edit" class="edit">
			<slot name="edit" />
		</div>

		<div v-if="Array.isArray(effective)" class="chips">
			<v-chip
				v-for="name in visibleChips"
				:key="name"
				v-tooltip="isAddedHere(name) ? addedTooltip(name) : undefined"
				small
				:class="{ 'added-here': isAddedHere(name) }"
			>
				{{ name }}
			</v-chip>
			<v-chip v-if="hiddenCount" v-tooltip="hiddenNames" small class="more">+{{ hiddenCount }}</v-chip>
			<span v-if="!effective.length" class="empty">None</span>
		</div>

		<div class="card-bottom">
			<div class="card-foot">
				<div class="tags">
					<template v-if="readonly">
						<span class="tag tag-muted">From configuration</span>
					</template>
					<template v-else>
						<span class="tag">
							<span class="tag-label">In use</span>
							<span class="tag-value">{{ summary(effective) }}</span>
						</span>
						<span class="tag">
							<span class="tag-label">Configured</span>
							<span class="tag-value">{{ summary(configured) }}</span>
						</span>
						<span v-if="override !== null && override !== undefined" class="tag">
							<span class="tag-label">Saved here</span>
							<span class="tag-value">{{ summary(override) }}</span>
						</span>
						<span v-if="addedCount" class="tag tag-accent">
							{{ addedCount === 1 ? '1 added here' : `${addedCount} added here` }}
						</span>
					</template>
				</div>
				<span class="env-name">{{ env }}</span>
			</div>
			<div class="card-link">
				<slot name="link" />
			</div>
		</div>
	</article>
</template>

<script setup lang="ts">
type Value = string | string[];

import { computed } from 'vue';

const CHIP_LIMIT = 12;

const props = withDefaults(
	defineProps<{
		title: string;
		/** One sentence under the title: what the setting does. */
		description?: string;
		/** Extra explanation on the help icon next to the title. */
		hint?: string;
		env: string;
		effective: Value;
		configured?: Value | null;
		override?: Value | null;
		readonly?: boolean;
	}>(),
	{ description: '', hint: '', configured: null, override: null, readonly: false },
);

const configuredSet = computed(() => new Set(Array.isArray(props.configured) ? props.configured : []));

function isAddedHere(name: string): boolean {
	return !props.readonly && Array.isArray(props.configured) && !configuredSet.value.has(name);
}

const addedCount = computed(() => (Array.isArray(props.effective) ? props.effective.filter(isAddedHere).length : 0));

const visibleChips = computed(() => (Array.isArray(props.effective) ? props.effective.slice(0, CHIP_LIMIT) : []));
const hiddenCount = computed(() =>
	Array.isArray(props.effective) ? Math.max(0, props.effective.length - CHIP_LIMIT) : 0,
);
const hiddenNames = computed(() =>
	Array.isArray(props.effective) ? props.effective.slice(CHIP_LIMIT).join(', ') : '',
);

function addedTooltip(name: string): string {
	return `Added here, not in the configuration. To keep it long term, add "${name}" to ${props.env} in your Directus configuration.`;
}

function summary(value: Value | null | undefined): string {
	if (Array.isArray(value)) return String(value.length);
	return value ?? '–';
}
</script>

<style scoped>
.setting-card {
	display: flex;
	flex-direction: column;
	gap: 14px;
	min-width: 0;
	height: 100%;
	padding: 16px 18px;
	border-radius: var(--theme--border-radius, var(--border-radius));
	border: var(--theme--border-width, var(--border-width)) solid var(--theme--border-color, var(--border-normal));
	background: var(--theme--background, var(--background-page));
}
.card-head {
	display: flex;
	align-items: flex-start;
	gap: 12px;
}
.card-titles {
	display: flex;
	flex-direction: column;
	gap: 2px;
	min-width: 0;
	flex: 1;
}
.title-row {
	display: flex;
	align-items: center;
	gap: 6px;
	min-width: 0;
}
.card-titles strong {
	font-size: 15px;
	letter-spacing: 0.01em;
}
.help {
	--v-icon-color: var(--theme--foreground-subdued, var(--foreground-subdued));
	cursor: pointer;
	flex-shrink: 0;
}
.description {
	font-size: 12px;
	line-height: 1.45;
	color: var(--theme--foreground-subdued, var(--foreground-subdued));
}
.control,
.head-actions {
	display: flex;
	align-items: center;
	flex: none;
	min-height: 28px;
	padding-block-start: 1px;
}
.control :deep(.v-checkbox) {
	margin: 0;
}
.value {
	flex: none;
	font-size: 15px;
	font-weight: 700;
	line-height: 1.3;
	font-variant-numeric: tabular-nums;
}
.chips {
	display: flex;
	flex-wrap: wrap;
	gap: 6px;
}
.chips .added-here {
	--v-chip-color: var(--theme--primary, var(--primary));
	--v-chip-background-color: var(--theme--primary-background, var(--primary-alt));
	--v-chip-color-hover: var(--theme--primary, var(--primary));
	--v-chip-background-color-hover: var(--theme--primary-subdued, var(--primary-alt));
	cursor: help;
}
.chips .more {
	cursor: help;
}
.empty {
	font-size: 13px;
	color: var(--theme--foreground-subdued, var(--foreground-subdued));
}
.card-bottom {
	margin-top: auto;
}
.card-foot {
	display: flex;
	align-items: center;
	justify-content: space-between;
	gap: 12px;
	flex-wrap: wrap;
	padding-block-start: 12px;
	border-block-start: var(--theme--border-width, var(--border-width)) solid var(--theme--border-color-subdued, var(--border-subdued));
}
.tags {
	display: flex;
	flex-wrap: wrap;
	gap: 6px;
	align-items: center;
	min-width: 0;
}
.tag {
	display: inline-flex;
	align-items: baseline;
	gap: 0.35rem;
	max-width: 100%;
	padding: 3px 9px;
	border-radius: 4px;
	font-size: 12px;
	line-height: 1.35;
	color: var(--theme--foreground, var(--foreground-normal));
	background: var(--theme--background-normal, var(--background-subdued));
	border: var(--theme--border-width, var(--border-width)) solid var(--theme--border-color-subdued, var(--border-subdued));
}
.tag-label {
	font-weight: 600;
	color: var(--theme--foreground-subdued, var(--foreground-subdued));
}
.tag-value {
	font-weight: 700;
	font-variant-numeric: tabular-nums;
}
.tag-muted {
	color: var(--theme--foreground-subdued, var(--foreground-subdued));
}
.tag-accent {
	color: var(--theme--primary, var(--primary));
	border-color: var(--theme--primary-subdued, var(--primary-alt));
	background: var(--theme--primary-background, var(--primary-alt));
}
.env-name {
	font-family: var(--theme--fonts--monospace--font-family, var(--family-monospace, monospace));
	font-size: 11px;
	color: var(--theme--foreground-subdued, var(--foreground-subdued));
	overflow-wrap: anywhere;
}
.edit {
	display: flex;
	flex-direction: column;
	gap: 6px;
}
.card-link {
	display: flex;
	justify-content: flex-end;
	min-height: 28px;
	margin-top: 10px;
}
.card-link:empty {
	display: none;
	min-height: 0;
	margin-top: 0;
}
</style>
