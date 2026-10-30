-- A re-issued quotation points at the expired one it replaces (pivot.md §4.9).
ALTER TABLE "quotations" ADD COLUMN "reissuedFromId" TEXT;

CREATE UNIQUE INDEX "quotations_reissuedFromId_key" ON "quotations"("reissuedFromId");

ALTER TABLE "quotations" ADD CONSTRAINT "quotations_reissuedFromId_fkey" FOREIGN KEY ("reissuedFromId") REFERENCES "quotations"("id") ON DELETE SET NULL ON UPDATE CASCADE;
