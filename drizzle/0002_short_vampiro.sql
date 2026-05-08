ALTER TABLE "frame_claim_codes" DROP CONSTRAINT "frame_claim_codes_created_by_user_id_user_id_fk";
--> statement-breakpoint
ALTER TABLE "picture_frames" ALTER COLUMN "owner_user_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "frame_claim_codes" DROP COLUMN "created_by_user_id";