CREATE TABLE "picture_frames" (
	"id" serial PRIMARY KEY NOT NULL,
	"owner_user_id" text NOT NULL,
	"frame_name" text NOT NULL,
	"auth_key" text NOT NULL,
	"current_picture_id" integer,
	"refresh_every_seconds" integer DEFAULT 3600 NOT NULL,
	"auto_rotate" boolean DEFAULT true NOT NULL,
	"show_favorites_only" boolean DEFAULT false NOT NULL,
	"disabled" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pictures" (
	"id" serial PRIMARY KEY NOT NULL,
	"owner_user_id" text,
	"uploader_name" text NOT NULL,
	"file_name" text NOT NULL,
	"favorite" boolean DEFAULT false NOT NULL,
	"skipped" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "public_upload_links" (
	"id" serial PRIMARY KEY NOT NULL,
	"frame_id" integer NOT NULL,
	"code_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"max_uploads" integer DEFAULT 0 NOT NULL,
	"upload_count" integer DEFAULT 0 NOT NULL,
	"disabled" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "session" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user" (
	"id" text PRIMARY KEY NOT NULL,
	"email" text,
	"created_at" timestamp with time zone NOT NULL,
	"last_login" timestamp with time zone,
	"username" text NOT NULL,
	"password_hash" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "picture_frames" ADD CONSTRAINT "picture_frames_owner_user_id_user_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "picture_frames" ADD CONSTRAINT "picture_frames_current_picture_id_pictures_id_fk" FOREIGN KEY ("current_picture_id") REFERENCES "public"."pictures"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "pictures" ADD CONSTRAINT "pictures_owner_user_id_user_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "public_upload_links" ADD CONSTRAINT "public_upload_links_frame_id_picture_frames_id_fk" FOREIGN KEY ("frame_id") REFERENCES "public"."picture_frames"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
CREATE UNIQUE INDEX "picture_frames_auth_key_unique" ON "picture_frames" USING btree ("auth_key");--> statement-breakpoint
CREATE UNIQUE INDEX "public_upload_links_code_hash_unique" ON "public_upload_links" USING btree ("code_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "user_username_unique" ON "user" USING btree ("username");--> statement-breakpoint
CREATE UNIQUE INDEX "user_email_unique" ON "user" USING btree ("email");