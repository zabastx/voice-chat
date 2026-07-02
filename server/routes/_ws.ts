export default defineWebSocketHandler({
	message(peer, raw) {
		let data: Partial<ClientEvent>
		try {
			data = JSON.parse(raw.text())
		} catch {
			return
		}

		if (data.type === 'auth') {
			const member = consumeWsTicket(data.ticket)
			if (!member) {
				peer.send(JSON.stringify({ type: 'auth.error' } satisfies ServerEvent))
				peer.close(4001, 'Invalid ticket')
				return
			}
			wsRegister(peer, member)
			peer.send(
				JSON.stringify({
					type: 'snapshot',
					online: wsOnline(),
					voice: voiceRooms()
				} satisfies ServerEvent)
			)
			return
		}

		const member = wsMemberFor(peer)
		if (!member) return

		if (data.type === 'voice.self' && typeof data.muted === 'boolean') {
			voiceSetMutedByMember(member.memberId, data.muted)
		}
	},
	close(peer) {
		wsUnregister(peer)
	}
})
