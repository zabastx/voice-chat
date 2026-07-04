<template>
	<ChannelVoice v-if="channel?.kind === 'voice'" :key="channelId" />
	<ChannelChat v-else :key="channelId" />
</template>

<script lang="ts" setup>
const route = useRoute()
const store = useChannelsStore()

const channelId = computed(() => route.params.id as string)
const channel = computed(() => store.channels.value.find((c) => c.id === channelId.value))
</script>
