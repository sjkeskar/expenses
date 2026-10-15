-- CreateTable
CREATE TABLE "bill_reassignments" (
    "id" TEXT NOT NULL,
    "billId" TEXT NOT NULL,
    "fromOperatorId" TEXT,
    "toOperatorId" TEXT NOT NULL,
    "reassignedById" TEXT NOT NULL,
    "reassignedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bill_reassignments_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "bill_reassignments" ADD CONSTRAINT "bill_reassignments_billId_fkey" FOREIGN KEY ("billId") REFERENCES "bills"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bill_reassignments" ADD CONSTRAINT "bill_reassignments_fromOperatorId_fkey" FOREIGN KEY ("fromOperatorId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bill_reassignments" ADD CONSTRAINT "bill_reassignments_toOperatorId_fkey" FOREIGN KEY ("toOperatorId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bill_reassignments" ADD CONSTRAINT "bill_reassignments_reassignedById_fkey" FOREIGN KEY ("reassignedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
