-- AlterTable
ALTER TABLE "LprEvent" ALTER COLUMN "imageUrl" DROP NOT NULL;

-- CreateIndex
CREATE INDEX "LprEvent_plate_idx" ON "LprEvent"("plate");
