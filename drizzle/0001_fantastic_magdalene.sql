CREATE TABLE "frame_claim_codes" (
	"id" serial PRIMARY KEY NOT NULL,
	"frame_id" integer NOT NULL,
	"code_hash" text NOT NULL,
	"created_by_user_id" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"claimed_by_user_id" text,
	"claimed_at" timestamp with time zone,
	"disabled" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "frame_claim_codes" ADD CONSTRAINT "frame_claim_codes_frame_id_picture_frames_id_fk" FOREIGN KEY ("frame_id") REFERENCES "public"."picture_frames"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "frame_claim_codes" ADD CONSTRAINT "frame_claim_codes_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "frame_claim_codes" ADD CONSTRAINT "frame_claim_codes_claimed_by_user_id_user_id_fk" FOREIGN KEY ("claimed_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
CREATE UNIQUE INDEX "frame_claim_codes_code_hash_unique" ON "frame_claim_codes" USING btree ("code_hash");