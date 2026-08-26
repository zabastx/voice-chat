CREATE TABLE "member_notification_links" (
	"member_id" text NOT NULL,
	"transport" text NOT NULL,
	"external_id" text,
	"notifications_enabled" boolean DEFAULT true NOT NULL,
	"link_token" text,
	"link_token_expires_at" timestamp with time zone,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "member_notification_links_member_id_transport_pk" PRIMARY KEY("member_id","transport")
);
--> statement-breakpoint
CREATE TABLE "notification_mappings" (
	"id" text PRIMARY KEY NOT NULL,
	"transport" text NOT NULL,
	"member_id" text NOT NULL,
	"external_chat_id" text NOT NULL,
	"external_message_id" bigint NOT NULL,
	"conversation_message_id" bigint,
	"channel_id" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "member_notification_links" ADD CONSTRAINT "member_notification_links_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_mappings" ADD CONSTRAINT "notification_mappings_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_mappings" ADD CONSTRAINT "notification_mappings_channel_id_channels_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."channels"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "member_notification_links_external_idx" ON "member_notification_links" USING btree ("transport","external_id");--> statement-breakpoint
CREATE UNIQUE INDEX "notification_mappings_lookup_idx" ON "notification_mappings" USING btree ("transport","external_chat_id","external_message_id");--> statement-breakpoint
CREATE INDEX "notification_mappings_cmid_idx" ON "notification_mappings" USING btree ("transport","external_chat_id","conversation_message_id");--> statement-breakpoint
-- Carry the existing Telegram links across (adr/0011). A row is worth moving if
-- the member is linked OR still holds an unconsumed link token; members who
-- never touched Telegram get no row at all.
INSERT INTO "member_notification_links"
	("member_id", "transport", "external_id", "notifications_enabled", "link_token", "link_token_expires_at", "created_at")
SELECT
	"id",
	'telegram',
	"telegram_chat_id",
	"telegram_notifications_enabled",
	"telegram_link_token",
	"telegram_link_token_expires_at",
	now()
FROM "members"
WHERE "telegram_chat_id" IS NOT NULL OR "telegram_link_token" IS NOT NULL;--> statement-breakpoint
-- Carry live reply mappings across so a reply to a notification delivered just
-- before the deploy still routes. conversation_message_id stays null: Telegram
-- has only one id space.
INSERT INTO "notification_mappings"
	("id", "transport", "member_id", "external_chat_id", "external_message_id", "conversation_message_id", "channel_id", "created_at")
SELECT
	"id", 'telegram', "member_id", "chat_id", "telegram_message_id", NULL, "channel_id", "created_at"
FROM "telegram_notifications";
