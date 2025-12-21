-- Add allowedCidrs to Camera (text[]), default empty array
ALTER TABLE "Camera"
ADD COLUMN IF NOT EXISTS "allowedCidrs" text[] NOT NULL DEFAULT ARRAY[]::text[];
