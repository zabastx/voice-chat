ALTER TABLE `members` ADD `role` text DEFAULT 'member' NOT NULL;--> statement-breakpoint
UPDATE `members` SET `role` = 'admin' WHERE `is_admin` = 1;
