CREATE TABLE "attachments" (
	"id" text PRIMARY KEY NOT NULL,
	"message_id" text,
	"uploader_id" text NOT NULL,
	"filename" text NOT NULL,
	"mime" text NOT NULL,
	"size" integer NOT NULL,
	"object_key" text NOT NULL,
	"preview_key" text,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "attachments_object_key_unique" UNIQUE("object_key")
);
--> statement-breakpoint
CREATE TABLE "channels" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"kind" text NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "invites" (
	"token" text PRIMARY KEY NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"used_by" text,
	"used_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "member_channel_state" (
	"member_id" text NOT NULL,
	"channel_id" text NOT NULL,
	"last_read_at" timestamp with time zone NOT NULL,
	CONSTRAINT "member_channel_state_member_id_channel_id_pk" PRIMARY KEY("member_id","channel_id")
);
--> statement-breakpoint
CREATE TABLE "members" (
	"id" text PRIMARY KEY NOT NULL,
	"username" text NOT NULL,
	"password_hash" text NOT NULL,
	"display_name" text,
	"avatar_id" text,
	"role" text DEFAULT 'member' NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "members_username_unique" UNIQUE("username")
);
--> statement-breakpoint
CREATE TABLE "messages" (
	"id" text PRIMARY KEY NOT NULL,
	"channel_id" text NOT NULL,
	"author_id" text NOT NULL,
	"content" text NOT NULL,
	"reply_to_id" text,
	"created_at" timestamp with time zone NOT NULL,
	"edited_at" timestamp with time zone,
	"content_tsv" "tsvector" GENERATED ALWAYS AS (to_tsvector('russian', content)) STORED
);
--> statement-breakpoint
CREATE TABLE "reactions" (
	"message_id" text NOT NULL,
	"member_id" text NOT NULL,
	"emoji" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "reactions_message_id_member_id_emoji_pk" PRIMARY KEY("message_id","member_id","emoji")
);
--> statement-breakpoint
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_message_id_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."messages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_uploader_id_members_id_fk" FOREIGN KEY ("uploader_id") REFERENCES "public"."members"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invites" ADD CONSTRAINT "invites_created_by_members_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."members"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invites" ADD CONSTRAINT "invites_used_by_members_id_fk" FOREIGN KEY ("used_by") REFERENCES "public"."members"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member_channel_state" ADD CONSTRAINT "member_channel_state_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member_channel_state" ADD CONSTRAINT "member_channel_state_channel_id_channels_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."channels"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_channel_id_channels_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."channels"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_author_id_members_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."members"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reactions" ADD CONSTRAINT "reactions_message_id_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."messages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reactions" ADD CONSTRAINT "reactions_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "attachments_message_idx" ON "attachments" USING btree ("message_id");--> statement-breakpoint
CREATE INDEX "messages_channel_created_idx" ON "messages" USING btree ("channel_id","created_at");--> statement-breakpoint
CREATE INDEX "messages_reply_to_idx" ON "messages" USING btree ("reply_to_id");--> statement-breakpoint
CREATE INDEX "messages_content_tsv_idx" ON "messages" USING gin ("content_tsv");--> statement-breakpoint
CREATE INDEX "reactions_message_idx" ON "reactions" USING btree ("message_id");