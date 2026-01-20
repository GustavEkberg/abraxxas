CREATE TYPE "manifest_status" AS ENUM('pending', 'active', 'running', 'completed', 'error');--> statement-breakpoint
CREATE TABLE "manifests" (
	"id" text PRIMARY KEY,
	"projectId" text NOT NULL,
	"prdName" text NOT NULL,
	"status" "manifest_status" DEFAULT 'pending'::"manifest_status" NOT NULL,
	"spriteName" text,
	"spriteUrl" text,
	"spritePassword" text,
	"webhookSecret" text,
	"prdJson" text,
	"errorMessage" text,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL,
	"completedAt" timestamp
);
--> statement-breakpoint
ALTER TABLE "manifests" ADD CONSTRAINT "manifests_projectId_projects_id_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE;