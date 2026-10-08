-- AlterEnum
ALTER TYPE "BillStatus" ADD VALUE 'refunded';

-- AlterTable
ALTER TABLE "bills" ADD COLUMN     "refundedAmount" DECIMAL(12,2),
ADD COLUMN     "refundedAt" TIMESTAMPTZ(3),
ADD COLUMN     "refundedById" TEXT;

-- AddForeignKey
ALTER TABLE "bills" ADD CONSTRAINT "bills_refundedById_fkey" FOREIGN KEY ("refundedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
