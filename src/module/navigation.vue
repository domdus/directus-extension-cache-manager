<template>
	<v-list nav>
		<v-list-item to="/cache-manager" exact>
			<v-list-item-icon><v-icon name="cached" /></v-list-item-icon>
			<v-list-item-content>
				<v-text-overflow text="Status" />
			</v-list-item-content>
		</v-list-item>

		<v-list-item to="/cache-manager/collections">
			<v-list-item-icon><v-icon name="list_alt" /></v-list-item-icon>
			<v-list-item-content>
				<v-text-overflow text="Collections" />
			</v-list-item-content>
		</v-list-item>
	</v-list>
</template>

<script setup lang="ts"></script>
