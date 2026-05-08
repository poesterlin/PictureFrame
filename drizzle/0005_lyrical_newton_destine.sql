ALTER TABLE "pictures" DROP CONSTRAINT "pictures_owner_user_id_user_id_fk";
--> statement-breakpoint
ALTER TABLE "pictures" DROP COLUMN "owner_user_id";