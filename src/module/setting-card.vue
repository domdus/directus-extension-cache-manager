<template>
	<article class="setting-card">
		<div class="card-titles">
			<strong>{{ title }}</strong>
			<span class="env-name">{{ env }}</span>
		</div>

		<div class="in-effect">
			<span class="caption">In use now</span>
			<div v-if="Array.isArray(effective)" class="chips">
				<v-chip v-for="name in effective" :key="name" small>{{ name }}</v-chip>
				<span v-if="!effective.length" class="value">None</span>
			</div>
			<span v-else class="value">{{ effective }}</span>
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

withDefaults(
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
.lines {
	display: flex;
	flex-direction: column;
	gap: 2px;
	font-size: 12px;
	color: var(--theme--foreground-subdued);
	overflow-wrap: anywhere;
}
.card-actions {
	display: flex;
	justify-content: flex-end;
	padding-block-start: 12px;
	border-block-start: var(--theme--border-width) solid var(--theme--border-color-subdued);
}
</style>
