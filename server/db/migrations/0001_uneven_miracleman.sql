CREATE TABLE "channel_participants" (
	"channel_id" text NOT NULL,
	"member_id" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "channel_participants_channel_id_member_id_pk" PRIMARY KEY("channel_id","member_id")
);
--> statement-breakpoint
ALTER TABLE "channel_participants" ADD CONSTRAINT "channel_participants_channel_id_channels_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."channels"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "channel_participants" ADD CONSTRAINT "channel_participants_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "channel_participants_member_idx" ON "channel_participants" USING btree ("member_id");