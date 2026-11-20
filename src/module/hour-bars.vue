<template>
	<figure class="hour-bars">
		<figcaption class="chart-head">
			<span class="chart-title">{{ title }}</span>
			<span v-if="legend.length > 1" class="legend">
				<span v-for="item in legend" :key="item.label" class="legend-item">
					<span class="swatch" :style="{ background: item.color }" />{{ item.label }}
				</span>
			</span>
		</figcaption>
		<p v-if="empty" class="empty">{{ emptyText }}</p>
		<div v-else class="plot">
			<span class="axis-max">{{ maxLabel }}</span>
			<div class="columns" role="img" :aria-label="title">
				<div v-for="(column, i) in columns" :key="i" v-tooltip="column.tooltip" class="column">
					<div class="stack">
						<div
							v-for="(segment, j) in column.segments.filter((s) => s.value > 0)"
							:key="j"
							class="segment"
							:style="{ height: `${(segment.value / max) * 100}%`, background: segment.color }"
						/>
					</div>
				</div>
			</div>
		</div>
		<div v-if="!empty" class="x-axis">
			<span v-for="(column, i) in columns" :key="i" class="tick">{{ i % 6 === 0 || i === columns.length - 1 ? column.label : '' }}</span>
		</div>
	</figure>
</template>

<script setup lang="ts">
import { computed } from 'vue';

export type BarColumn = { label: string; tooltip: string; segments: Array<{ value: number; color: string }> };

const props = defineProps<{
	title: string;
	columns: BarColumn[];
	legend: Array<{ label: string; color: string }>;
	format: (value: number) => string;
	emptyText?: string;
}>();

const empty = computed(() => props.columns.every((column) => column.segments.every((s) => !(s.value > 0))));

const max = computed(() => Math.max(1, ...props.columns.map((column) => column.segments.reduce((sum, s) => sum + s.value, 0))));
const maxLabel = computed(() => props.format(max.value));
</script>

<style scoped>
.hour-bars {
	margin: 0;
	min-width: 0;
	padding: 16px 18px;
	border-radius: var(--theme--border-radius, var(--border-radius));
	border: var(--theme--border-width, var(--border-width)) solid var(--theme--border-color-subdued, var(--border-subdued));
	background: var(--theme--background, var(--background-page));
}
.chart-head {
	display: flex;
	flex-wrap: wrap;
	justify-content: space-between;
	gap: 8px 16px;
	margin-bottom: 12px;
}
.chart-title {
	font-size: 15px;
	font-weight: 600;
}
.legend {
	display: flex;
	flex-wrap: wrap;
	gap: 12px;
	font-size: 12px;
	color: var(--theme--foreground-subdued, var(--foreground-subdued));
}
.legend-item {
	display: inline-flex;
	align-items: center;
	gap: 6px;
}
.swatch {
	inline-size: 10px;
	block-size: 10px;
	border-radius: 2px;
}
.empty {
	margin: 0;
	block-size: 140px;
	display: flex;
	align-items: center;
	justify-content: center;
	text-align: center;
	color: var(--theme--foreground-subdued, var(--foreground-subdued));
}
.plot {
	position: relative;
	block-size: 140px;
	border-block-start: 1px dashed var(--theme--border-color-subdued, var(--border-subdued));
	border-block-end: var(--theme--border-width, var(--border-width)) solid var(--theme--border-color, var(--border-normal));
}
.axis-max {
	position: absolute;
	inset-block-start: 2px;
	inset-inline-start: 0;
	font-size: 11px;
	color: var(--theme--foreground-subdued, var(--foreground-subdued));
	pointer-events: none;
}
.columns {
	display: flex;
	align-items: stretch;
	block-size: 100%;
	gap: 2px;
}
.column {
	flex: 1 1 0;
	min-width: 0;
	display: flex;
	align-items: flex-end;
	cursor: default;
}
.column:hover {
	background: var(--theme--background-subdued, var(--background-subdued));
}
.stack {
	display: flex;
	flex-direction: column-reverse;
	gap: 2px;
	inline-size: 100%;
	block-size: 100%;
	justify-content: flex-start;
}
.segment {
	inline-size: 100%;
	min-block-size: 2px;
}
.segment:last-child {
	border-radius: 4px 4px 0 0;
}
.x-axis {
	display: flex;
	gap: 2px;
	margin-top: 4px;
}
.tick {
	flex: 1 1 0;
	min-width: 0;
	overflow: visible;
	white-space: nowrap;
	font-size: 11px;
	color: var(--theme--foreground-subdued, var(--foreground-subdued));
}
</style>
