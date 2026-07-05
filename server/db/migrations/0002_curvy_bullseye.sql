CREATE TABLE "telegram_notifications" (
	"id" text PRIMARY KEY NOT NULL,
	"member_id" text NOT NULL,
	"chat_id" text NOT NULL,
	"telegram_message_id" bigint NOT NULL,
	"channel_id" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "members" ADD COLUMN "telegram_chat_id" text;--> statement-breakpoint
ALTER TABLE "members" ADD COLUMN "telegram_notifications_enabled" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "members" ADD COLUMN "telegram_link_token" text;--> statement-breakpoint
ALTER TABLE "members" ADD COLUMN "telegram_link_token_expires_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "telegram_notifications" ADD CONSTRAINT "telegram_notifications_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "telegram_notifications" ADD CONSTRAINT "telegram_notifications_channel_id_channels_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."channels"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "telegram_notifications_lookup_idx" ON "telegram_notifications" USING btree ("chat_id","telegram_message_id");