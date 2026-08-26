// The messengers that can carry a Notification (adr/0011). One list: the DTO
// shape, the settings screen and the server's transport registry all read from
// it, so adding a third is a compile error at each site rather than a silent gap.
//
// It lives in shared/utils rather than shared/types because it is a runtime
// value — shared/types is auto-imported for types only, so a const there
// typechecks and then throws "not defined" at runtime.
export const NOTIFICATION_TRANSPORTS = ['telegram', 'vk'] as const

export type NotificationTransport = (typeof NOTIFICATION_TRANSPORTS)[number]
