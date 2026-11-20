<template>
	<v-list nav>
		<v-list-item to="/cache-manager" exact>
			<v-list-item-icon><v-icon name="cached" /></v-list-item-icon>
			<v-list-item-content>
				<v-text-overflow text="Status" />
			</v-list-item-content>
		</v-list-item>

		<v-list-item to="/cache-manager/optimize">
			<v-list-item-icon><v-icon name="speed" /></v-list-item-icon>
			<v-list-item-content>
				<v-text-overflow text="Optimize" />
			</v-list-item-content>
		</v-list-item>

		<v-list-item to="/cache-manager/rules">
			<v-list-item-icon><v-icon name="rule" /></v-list-item-icon>
			<v-list-item-content>
				<v-text-overflow text="Clearing Rules" />
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
