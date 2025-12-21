-- CreateTable
CREATE TABLE "LprEventOutbox" (
  "id" TEXT NOT NULL,
  "eventId" TEXT NOT NULL,
  "payload" JSONB NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'PENDING',
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "nextRetryAt" TIMESTAMP(3),
  "publishedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "LprEventOutbox_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "LprEventOutbox_eventId_key" ON "LprEventOutbox"("eventId");
CREATE INDEX "LprEventOutbox_status_nextRetryAt_idx" ON "LprEventOutbox"("status", "nextRetryAt");
CREATE INDEX "LprEventOutbox_createdAt_idx" ON "LprEventOutbox"("createdAt");

-- AddForeignKey
ALTER TABLE "LprEventOutbox"
ADD CONSTRAINT "LprEventOutbox_eventId_fkey"
FOREIGN KEY ("eventId") REFERENCES "LprEvent"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;
