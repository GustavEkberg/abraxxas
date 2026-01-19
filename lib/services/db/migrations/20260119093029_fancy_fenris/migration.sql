CREATE TYPE "execution_mode" AS ENUM('local', 'sprite');--> statement-breakpoint
CREATE TYPE "session_status" AS ENUM('pending', 'in_progress', 'completed', 'error');--> statement-breakpoint
CREATE TYPE "task_execution_state" AS ENUM('idle', 'in_progress', 'awaiting_review', 'completed', 'error');--> statement-breakpoint
CREATE TYPE "task_model" AS ENUM('grok-1', 'claude-opus-4-5', 'claude-sonnet-4-5', 'claude-haiku-4-5');--> statement-breakpoint
CREATE TYPE "task_status" AS ENUM('abyss', 'altar', 'ritual', 'cursed', 'trial', 'vanquished');--> statement-breakpoint
CREATE TYPE "task_type" AS ENUM('bug', 'feature', 'plan', 'other');--> statement-breakpoint
CREATE TABLE "account" (
	"id" text PRIMARY KEY,
	"accountId" text NOT NULL,
	"providerId" text NOT NULL,
	"userId" text NOT NULL,
	"accessToken" text,
	"refreshToken" text,
	"idToken" text,
	"accessTokenExpiresAt" timestamp,
	"refreshTokenExpiresAt" timestamp,
	"scope" text,
	"password" text,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "comments" (
	"id" text PRIMARY KEY,
	"taskId" text NOT NULL,
	"userId" text,
	"isAgentComment" boolean DEFAULT false NOT NULL,
	"agentName" text,
	"content" text NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "opencodeSessions" (
	"id" text PRIMARY KEY,
	"taskId" text NOT NULL,
	"sessionId" text NOT NULL,
	"status" "session_status" DEFAULT 'pending'::"session_status" NOT NULL,
	"executionMode" "execution_mode" NOT NULL,
	"spriteName" text,
	"webhookSecret" text,
	"branchName" text,
	"pullRequestUrl" text,
	"errorMessage" text,
	"logs" text,
	"messageCount" text,
	"inputTokens" text,
	"outputTokens" text,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL,
	"completedAt" timestamp
);
--> statement-breakpoint
CREATE TABLE "projects" (
	"id" text PRIMARY KEY,
	"userId" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"repositoryUrl" text NOT NULL,
	"encryptedGithubToken" text NOT NULL,
	"agentsMdContent" text,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "session" (
	"id" text PRIMARY KEY,
	"expiresAt" timestamp NOT NULL,
	"token" text NOT NULL UNIQUE,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL,
	"ipAddress" text,
	"userAgent" text,
	"userId" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tasks" (
	"id" text PRIMARY KEY,
	"projectId" text NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"type" "task_type" NOT NULL,
	"model" "task_model" NOT NULL,
	"status" "task_status" DEFAULT 'abyss'::"task_status" NOT NULL,
	"executionState" "task_execution_state" DEFAULT 'idle'::"task_execution_state" NOT NULL,
	"branchName" text,
	"completedAt" timestamp,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user" (
	"id" text PRIMARY KEY,
	"name" text NOT NULL,
	"email" text NOT NULL UNIQUE,
	"emailVerified" boolean DEFAULT false NOT NULL,
	"image" text,
	"role" text DEFAULT 'USER' NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "verification" (
	"id" text PRIMARY KEY,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expiresAt" timestamp NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "account" ADD CONSTRAINT "account_userId_user_id_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "comments" ADD CONSTRAINT "comments_taskId_tasks_id_fkey" FOREIGN KEY ("taskId") REFERENCES "tasks"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "comments" ADD CONSTRAINT "comments_userId_user_id_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "opencodeSessions" ADD CONSTRAINT "opencodeSessions_taskId_tasks_id_fkey" FOREIGN KEY ("taskId") REFERENCES "tasks"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_userId_user_id_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_userId_user_id_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_projectId_projects_id_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE;