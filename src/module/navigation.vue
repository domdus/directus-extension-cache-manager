<template>
	<v-list nav>
		<v-list-item to="/cache-manager" exact>
			<v-list-item-icon><v-icon name="cached" /></v-list-item-icon>
			<v-list-item-content>
				<v-text-overflow text="Status" />
			</v-list-item-content>
		</v-list-item>

		<v-list-item to="/cache-manager/cache">
			<v-list-item-icon><v-icon name="grain" /></v-list-item-icon>
			<v-list-item-content>
				<v-text-overflow text="Granular Cache" />
			</v-list-item-content>
		</v-list-item>

		<v-list-item to="/cache-manager/analysis">
			<v-list-item-icon><v-icon name="insights" /></v-list-item-icon>
			<v-list-item-content>
				<v-text-overflow text="Analysis" />
			</v-list-item-content>
		</v-list-item>

		<v-list-item to="/cache-manager/statistics">
			<v-list-item-icon><v-icon name="query_stats" /></v-list-item-icon>
			<v-list-item-content>
				<v-text-overflow text="Statistics" />
			</v-list-item-content>
		</v-list-item>

		<v-divider />

		<v-list-item to="/cache-manager/settings">
			<v-list-item-icon><v-icon name="settings" /></v-list-item-icon>
			<v-list-item-content>
				<v-text-overflow text="Settings" />
			</v-list-item-content>
		</v-list-item>
	</v-list>
</template>

<script setup lang="ts"></script>
