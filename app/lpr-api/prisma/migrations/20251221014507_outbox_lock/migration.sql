ALTER TABLE "LprEventOutbox"
  ADD COLUMN IF NOT EXISTS "lockedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "lockedBy" TEXT,
  ADD COLUMN IF NOT EXISTS "lastError" TEXT;

CREATE INDEX IF NOT EXISTS "LprEventOutbox_lockedAt_idx" ON "LprEventOutbox"("lockedAt");
