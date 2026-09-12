/*
  Warnings:

  - The primary key for the `bill_counters` table will be changed. If it partially fails, the table could be left without primary key constraint.
  - You are about to drop the column `dateKey` on the `bill_counters` table. All the data in the column will be lost.
  - Added the required column `counterKey` to the `bill_counters` table without a default value. This is not possible if the table is not empty.
  - Added the required column `locationCode` to the `locations` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "bill_counters" DROP CONSTRAINT "bill_counters_pkey",
DROP COLUMN "dateKey",
ADD COLUMN     "counterKey" TEXT NOT NULL,
ADD CONSTRAINT "bill_counters_pkey" PRIMARY KEY ("counterKey");

-- AlterTable
ALTER TABLE "locations" ADD COLUMN     "locationCode" VARCHAR(2) NOT NULL;
