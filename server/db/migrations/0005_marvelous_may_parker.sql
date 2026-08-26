DROP TABLE "telegram_notifications" CASCADE;--> statement-breakpoint
ALTER TABLE "members" DROP COLUMN "telegram_chat_id";--> statement-breakpoint
ALTER TABLE "members" DROP COLUMN "telegram_notifications_enabled";--> statement-breakpoint
ALTER TABLE "members" DROP COLUMN "telegram_link_token";--> statement-breakpoint
ALTER TABLE "members" DROP COLUMN "telegram_link_token_expires_at";