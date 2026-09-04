-- AlterTable
ALTER TABLE "bills" ADD COLUMN     "createdById" TEXT;

-- AddForeignKey
ALTER TABLE "bills" ADD CONSTRAINT "bills_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
