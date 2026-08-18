CREATE TABLE "plugin_instances" (
	"id" serial PRIMARY KEY NOT NULL,
	"frame_id" integer NOT NULL,
	"plugin_key" text NOT NULL,
	"name" text NOT NULL,
	"endpoint_url" text NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"poll_every_seconds" integer DEFAULT 300 NOT NULL,
	"compare_meaningful_changes" boolean DEFAULT true NOT NULL,
	"display_mode" text DEFAULT 'immediate' NOT NULL,
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"next_run_at" timestamp with time zone,
	"locked_until" timestamp with time zone,
	"last_fetched_at" timestamp with time zone,
	"last_success_at" timestamp with time zone,
	"last_source_hash" text,
	"last_meaningful_hash" text,
	"last_render_hash" text,
	"last_status" text,
	"last_error" text,
	"consecutive_failures" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "pictures" ADD COLUMN "source_type" text DEFAULT 'upload' NOT NULL;--> statement-breakpoint
ALTER TABLE "pictures" ADD COLUMN "plugin_instance_id" integer;--> statement-breakpoint
ALTER TABLE "pictures" ADD COLUMN "content_hash" text;--> statement-breakpoint
ALTER TABLE "pictures" ADD COLUMN "eligible" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "pictures" ADD COLUMN "superseded_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "plugin_instances" ADD CONSTRAINT "plugin_instances_frame_id_picture_frames_id_fk" FOREIGN KEY ("frame_id") REFERENCES "public"."picture_frames"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "pictures" ADD CONSTRAINT "pictures_plugin_instance_id_plugin_instances_id_fk" FOREIGN KEY ("plugin_instance_id") REFERENCES "public"."plugin_instances"("id") ON DELETE cascade ON UPDATE cascade;