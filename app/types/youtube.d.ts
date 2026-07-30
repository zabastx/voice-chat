// Minimal ambient types for the YouTube IFrame Player API, hand-written rather
// than pulled from @types/youtube: we touch a dozen members of a large surface,
// and one of them (`getVideoData`) is undocumented and absent from the official
// types anyway. See app/components/WatchStage.vue.

export {}

declare global {
	namespace YT {
		// -1 unstarted · 0 ended · 1 playing · 2 paused · 3 buffering · 5 cued
		type PlayerState = -1 | 0 | 1 | 2 | 3 | 5

		interface VideoData {
			video_id?: string
			title?: string
			// undocumented, but the only signal the embed gives for a live
			// broadcast — see the `live` handling in WatchStage.vue
			isLive?: boolean
		}

		interface Player {
			playVideo(): void
			pauseVideo(): void
			seekTo(seconds: number, allowSeekAhead: boolean): void
			getCurrentTime(): number
			getDuration(): number
			getPlayerState(): PlayerState
			getVideoData(): VideoData | undefined
			setVolume(volume: number): void
			setPlaybackRate(rate: number): void
			getPlaybackRate(): number
			getAvailablePlaybackRates(): number[]
			loadVideoById(options: { videoId: string; startSeconds?: number }): void
			destroy(): void
		}

		interface PlayerEvent {
			target: Player
		}
		interface StateChangeEvent extends PlayerEvent {
			data: PlayerState
		}
		interface PlaybackRateChangeEvent extends PlayerEvent {
			// the newly selected rate; YouTube offers 0.25–2, varying per video
			data: number
		}
		// 2 invalid id · 5 html5 error · 100 removed/private · 101,150 embedding disabled
		interface ErrorEvent extends PlayerEvent {
			data: 2 | 5 | 100 | 101 | 150
		}

		interface PlayerOptions {
			videoId: string
			playerVars?: Record<string, string | number>
			events?: {
				onReady?: (event: PlayerEvent) => void
				onStateChange?: (event: StateChangeEvent) => void
				onPlaybackRateChange?: (event: PlaybackRateChangeEvent) => void
				onError?: (event: ErrorEvent) => void
			}
		}
	}

	interface Window {
		YT?: {
			Player: new (element: HTMLElement, options: YT.PlayerOptions) => YT.Player
			PlayerState: { UNSTARTED: -1; ENDED: 0; PLAYING: 1; PAUSED: 2; BUFFERING: 3; CUED: 5 }
		}
		onYouTubeIframeAPIReady?: () => void
	}
}
