DELETE FROM "pictures";--> statement-breakpoint
ALTER TABLE "pictures" ADD COLUMN "frame_id" integer NOT NULL;--> statement-breakpoint
ALTER TABLE "pictures" ADD CONSTRAINT "pictures_frame_id_picture_frames_id_fk" FOREIGN KEY ("frame_id") REFERENCES "public"."picture_frames"("id") ON DELETE cascade ON UPDATE cascade;
