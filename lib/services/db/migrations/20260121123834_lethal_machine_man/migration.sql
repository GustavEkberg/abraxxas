ALTER TABLE "manifests" ADD COLUMN "name" text NOT NULL;--> statement-breakpoint
ALTER TABLE "manifests" ALTER COLUMN "prdName" DROP NOT NULL;