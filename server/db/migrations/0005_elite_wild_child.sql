CREATE INDEX `attachments_message_idx` ON `attachments` (`message_id`);--> statement-breakpoint
CREATE INDEX `messages_reply_to_idx` ON `messages` (`reply_to_id`);