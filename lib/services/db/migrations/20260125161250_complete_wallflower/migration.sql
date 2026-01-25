CREATE TYPE "sprite_status" AS ENUM('pending', 'active', 'running', 'error');--> statement-breakpoint
CREATE TYPE "sprite_type" AS ENUM('manifest', 'invocation');--> statement-breakpoint
CREATE TABLE "sprites" (
	"id" text PRIMARY KEY,
	"projectId" text NOT NULL,
	"branchName" text NOT NULL,
	"type" "sprite_type" NOT NULL,
	"status" "sprite_status" DEFAULT 'pending'::"sprite_status" NOT NULL,
	"spriteName" text,
	"spriteUrl" text,
	"webhookSecret" text,
	"errorMessage" text,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "sprites" ADD CONSTRAINT "sprites_projectId_projects_id_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE;