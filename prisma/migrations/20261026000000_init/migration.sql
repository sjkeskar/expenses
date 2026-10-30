-- CreateEnum
CREATE TYPE "Role" AS ENUM ('developer', 'lead_pathologist', 'pathologist', 'technician', 'accountant');

-- CreateEnum
CREATE TYPE "LeadTermReason" AS ENUM ('first_run', 'handover', 'inactive_lead');

-- CreateEnum
CREATE TYPE "LocationType" AS ENUM ('branch', 'collection_centre');

-- CreateEnum
CREATE TYPE "Sex" AS ENUM ('male', 'female', 'other');

-- CreateEnum
CREATE TYPE "DoctorStatus" AS ENUM ('pending', 'approved', 'rejected');

-- CreateEnum
CREATE TYPE "PanelType" AS ENUM ('corporate', 'tpa', 'insurer');

-- CreateEnum
CREATE TYPE "CatalogKind" AS ENUM ('test', 'profile', 'service');

-- CreateEnum
CREATE TYPE "CatalogStatus" AS ENUM ('active', 'retired');

-- CreateEnum
CREATE TYPE "ApprovalSubject" AS ENUM ('catalog_change', 'referring_doctor', 'patient_correction', 'bill_discount', 'bill_cancellation');

-- CreateEnum
CREATE TYPE "ApprovalStatus" AS ENUM ('pending', 'approved', 'rejected', 'resolved');

-- CreateEnum
CREATE TYPE "ReferralType" AS ENUM ('walk_in', 'doctor');

-- CreateEnum
CREATE TYPE "PayerType" AS ENUM ('self', 'panel');

-- CreateEnum
CREATE TYPE "CollectionMode" AS ENUM ('at_location', 'home_visit');

-- CreateEnum
CREATE TYPE "BillStatus" AS ENUM ('pending', 'fully_paid', 'cancelled');

-- CreateEnum
CREATE TYPE "BillItemStatus" AS ENUM ('active', 'cancelled');

-- CreateEnum
CREATE TYPE "ProcessingStatus" AS ENUM ('not_started', 'in_progress', 'completed');

-- CreateEnum
CREATE TYPE "SampleStatus" AS ENUM ('pending', 'collected');

-- CreateEnum
CREATE TYPE "PaymentMode" AS ENUM ('cash', 'credit_card', 'upi');

-- CreateEnum
CREATE TYPE "TransactionKind" AS ENUM ('payment', 'settlement');

-- CreateEnum
CREATE TYPE "QuotationStatus" AS ENUM ('open', 'converted', 'cancelled');

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "role" "Role" NOT NULL,
    "lastLoginAt" TIMESTAMPTZ(3),
    "isDeleted" BOOLEAN NOT NULL DEFAULT false,
    "deletedAt" TIMESTAMPTZ(3),
    "deletedById" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lead_terms" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "startedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMPTZ(3),
    "reason" "LeadTermReason" NOT NULL,
    "appointedById" TEXT NOT NULL,

    CONSTRAINT "lead_terms_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lab_settings" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "labName" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "email" TEXT,
    "address" TEXT NOT NULL,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "lab_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "locations" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "locationCode" VARCHAR(2) NOT NULL,
    "type" "LocationType" NOT NULL,
    "address" TEXT NOT NULL,
    "phone" TEXT,
    "processingBranchId" TEXT,
    "homeVisitCharge" DECIMAL(12,2),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "locations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "patients" (
    "id" TEXT NOT NULL,
    "patientNumber" VARCHAR(13) NOT NULL,
    "identityKey" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "dateOfBirth" DATE NOT NULL,
    "dobIsApproximate" BOOLEAN NOT NULL DEFAULT false,
    "sex" "Sex" NOT NULL,
    "phone" VARCHAR(10) NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "patients_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "patient_number_aliases" (
    "id" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "number" VARCHAR(13) NOT NULL,
    "retiredAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "patient_number_aliases_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "patient_changes" (
    "id" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "field" TEXT NOT NULL,
    "oldValue" TEXT NOT NULL,
    "newValue" TEXT NOT NULL,
    "changedById" TEXT NOT NULL,
    "approvedById" TEXT NOT NULL,
    "changedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "patient_changes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "referring_doctors" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT,
    "clinic" TEXT,
    "status" "DoctorStatus" NOT NULL DEFAULT 'pending',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "referring_doctors_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "panels" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "PanelType" NOT NULL,
    "contact" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "priceListId" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "panels_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "price_lists" (
    "id" TEXT NOT NULL,
    "discountPercent" DECIMAL(5,2),

    CONSTRAINT "price_lists_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "price_list_items" (
    "id" TEXT NOT NULL,
    "priceListId" TEXT NOT NULL,
    "catalogItemId" TEXT NOT NULL,
    "price" DECIMAL(12,2) NOT NULL,

    CONSTRAINT "price_list_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "camps" (
    "id" TEXT NOT NULL,
    "panelId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "venue" TEXT,
    "locationId" TEXT NOT NULL,
    "startsAt" TIMESTAMPTZ(3) NOT NULL,
    "endsAt" TIMESTAMPTZ(3) NOT NULL,
    "priceListId" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "camps_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "machine_types" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "machine_types_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "machines" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "machineTypeId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "machines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "catalog_items" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" "CatalogKind" NOT NULL,
    "price" DECIMAL(12,2) NOT NULL,
    "department" TEXT,
    "sampleType" TEXT,
    "container" TEXT,
    "instructions" TEXT,
    "status" "CatalogStatus" NOT NULL DEFAULT 'active',
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "catalog_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "catalog_draws" (
    "id" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "label" TEXT NOT NULL,

    CONSTRAINT "catalog_draws_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "catalog_machine_steps" (
    "id" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "machineTypeId" TEXT NOT NULL,

    CONSTRAINT "catalog_machine_steps_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "profile_components" (
    "profileId" TEXT NOT NULL,
    "testId" TEXT NOT NULL,

    CONSTRAINT "profile_components_pkey" PRIMARY KEY ("profileId","testId")
);

-- CreateTable
CREATE TABLE "approvals" (
    "id" TEXT NOT NULL,
    "subjectType" "ApprovalSubject" NOT NULL,
    "subjectId" TEXT,
    "billId" TEXT,
    "payload" JSONB,
    "status" "ApprovalStatus" NOT NULL DEFAULT 'pending',
    "selfApproved" BOOLEAN NOT NULL DEFAULT false,
    "requestedById" TEXT NOT NULL,
    "requestedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewedById" TEXT,
    "reviewedAt" TIMESTAMPTZ(3),
    "reviewNote" TEXT,
    "resolvedById" TEXT,
    "resolvedAt" TIMESTAMPTZ(3),
    "resolveNote" TEXT,

    CONSTRAINT "approvals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bills" (
    "id" TEXT NOT NULL,
    "billNumber" TEXT NOT NULL,
    "verificationCode" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "referralType" "ReferralType" NOT NULL,
    "referringDoctorId" TEXT,
    "payerType" "PayerType" NOT NULL,
    "panelId" TEXT,
    "campId" TEXT,
    "collectionMode" "CollectionMode" NOT NULL DEFAULT 'at_location',
    "homeVisitAddress" TEXT,
    "quotationId" TEXT,
    "expectedReportAt" TIMESTAMPTZ(3),
    "originalAmount" DECIMAL(12,2) NOT NULL,
    "discountAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "netAmount" DECIMAL(12,2) NOT NULL,
    "balance" DECIMAL(12,2) NOT NULL,
    "status" "BillStatus" NOT NULL DEFAULT 'pending',

    CONSTRAINT "bills_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bill_items" (
    "id" TEXT NOT NULL,
    "billId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "catalogItemId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" "CatalogKind" NOT NULL,
    "price" DECIMAL(12,2) NOT NULL,
    "status" "BillItemStatus" NOT NULL DEFAULT 'active',
    "processingStatus" "ProcessingStatus" NOT NULL DEFAULT 'not_started',
    "cancellationId" TEXT,

    CONSTRAINT "bill_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sample_collections" (
    "id" TEXT NOT NULL,
    "billItemId" TEXT NOT NULL,
    "testId" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "label" TEXT NOT NULL,
    "status" "SampleStatus" NOT NULL,
    "dueAt" TIMESTAMPTZ(3),
    "collectedAt" TIMESTAMPTZ(3),
    "collectedById" TEXT,

    CONSTRAINT "sample_collections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bill_reassignments" (
    "id" TEXT NOT NULL,
    "billId" TEXT NOT NULL,
    "fromTechnicianId" TEXT NOT NULL,
    "toTechnicianId" TEXT NOT NULL,
    "reassignedById" TEXT NOT NULL,
    "reassignedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bill_reassignments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bill_events" (
    "id" TEXT NOT NULL,
    "billId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "detail" JSONB,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bill_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bill_counters" (
    "counterKey" TEXT NOT NULL,
    "lastSequence" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "bill_counters_pkey" PRIMARY KEY ("counterKey")
);

-- CreateTable
CREATE TABLE "transactions" (
    "id" TEXT NOT NULL,
    "billId" TEXT NOT NULL,
    "kind" "TransactionKind" NOT NULL DEFAULT 'payment',
    "amountCollected" DECIMAL(12,2) NOT NULL,
    "discountAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "mode" "PaymentMode" NOT NULL,
    "operatorId" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    "updatedById" TEXT,
    "isDeleted" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cancellations" (
    "id" TEXT NOT NULL,
    "billId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cancellations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "refunds" (
    "id" TEXT NOT NULL,
    "billId" TEXT NOT NULL,
    "cancellationId" TEXT NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "mode" "PaymentMode" NOT NULL,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "refunds_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "quotations" (
    "id" TEXT NOT NULL,
    "quoteNumber" TEXT NOT NULL,
    "verificationCode" TEXT NOT NULL,
    "patientId" TEXT,
    "patientName" TEXT NOT NULL,
    "patientPhone" TEXT,
    "locationId" TEXT NOT NULL,
    "collectionMode" "CollectionMode" NOT NULL DEFAULT 'at_location',
    "createdById" TEXT NOT NULL,
    "referralType" "ReferralType" NOT NULL,
    "referringDoctorId" TEXT,
    "payerType" "PayerType" NOT NULL,
    "panelId" TEXT,
    "campId" TEXT,
    "originalAmount" DECIMAL(12,2) NOT NULL,
    "discountAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "netAmount" DECIMAL(12,2) NOT NULL,
    "issuedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "validUntil" TIMESTAMPTZ(3) NOT NULL,
    "status" "QuotationStatus" NOT NULL DEFAULT 'open',

    CONSTRAINT "quotations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "quotation_items" (
    "id" TEXT NOT NULL,
    "quotationId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "catalogItemId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" "CatalogKind" NOT NULL,
    "price" DECIMAL(12,2) NOT NULL,

    CONSTRAINT "quotation_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_name_key" ON "users"("name");

-- CreateIndex
CREATE UNIQUE INDEX "locations_name_key" ON "locations"("name");

-- CreateIndex
CREATE UNIQUE INDEX "locations_locationCode_key" ON "locations"("locationCode");

-- CreateIndex
CREATE UNIQUE INDEX "patients_patientNumber_key" ON "patients"("patientNumber");

-- CreateIndex
CREATE UNIQUE INDEX "patients_identityKey_key" ON "patients"("identityKey");

-- CreateIndex
CREATE INDEX "patients_phone_idx" ON "patients"("phone");

-- CreateIndex
CREATE UNIQUE INDEX "patient_number_aliases_number_key" ON "patient_number_aliases"("number");

-- CreateIndex
CREATE UNIQUE INDEX "panels_name_key" ON "panels"("name");

-- CreateIndex
CREATE UNIQUE INDEX "panels_priceListId_key" ON "panels"("priceListId");

-- CreateIndex
CREATE UNIQUE INDEX "price_list_items_priceListId_catalogItemId_key" ON "price_list_items"("priceListId", "catalogItemId");

-- CreateIndex
CREATE UNIQUE INDEX "camps_priceListId_key" ON "camps"("priceListId");

-- CreateIndex
CREATE UNIQUE INDEX "machine_types_name_key" ON "machine_types"("name");

-- CreateIndex
CREATE UNIQUE INDEX "machines_branchId_name_key" ON "machines"("branchId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "catalog_items_code_key" ON "catalog_items"("code");

-- CreateIndex
CREATE UNIQUE INDEX "catalog_draws_itemId_sequence_key" ON "catalog_draws"("itemId", "sequence");

-- CreateIndex
CREATE UNIQUE INDEX "catalog_machine_steps_itemId_sequence_machineTypeId_key" ON "catalog_machine_steps"("itemId", "sequence", "machineTypeId");

-- CreateIndex
CREATE INDEX "approvals_status_subjectType_idx" ON "approvals"("status", "subjectType");

-- CreateIndex
CREATE INDEX "approvals_billId_idx" ON "approvals"("billId");

-- CreateIndex
CREATE UNIQUE INDEX "bills_billNumber_key" ON "bills"("billNumber");

-- CreateIndex
CREATE UNIQUE INDEX "bills_verificationCode_key" ON "bills"("verificationCode");

-- CreateIndex
CREATE UNIQUE INDEX "bills_quotationId_key" ON "bills"("quotationId");

-- CreateIndex
CREATE INDEX "bills_createdAt_idx" ON "bills"("createdAt");

-- CreateIndex
CREATE INDEX "sample_collections_status_dueAt_idx" ON "sample_collections"("status", "dueAt");

-- CreateIndex
CREATE INDEX "transactions_createdAt_idx" ON "transactions"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "refunds_cancellationId_key" ON "refunds"("cancellationId");

-- CreateIndex
CREATE INDEX "refunds_createdAt_idx" ON "refunds"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "quotations_quoteNumber_key" ON "quotations"("quoteNumber");

-- CreateIndex
CREATE UNIQUE INDEX "quotations_verificationCode_key" ON "quotations"("verificationCode");

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_deletedById_fkey" FOREIGN KEY ("deletedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lead_terms" ADD CONSTRAINT "lead_terms_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lead_terms" ADD CONSTRAINT "lead_terms_appointedById_fkey" FOREIGN KEY ("appointedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "locations" ADD CONSTRAINT "locations_processingBranchId_fkey" FOREIGN KEY ("processingBranchId") REFERENCES "locations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "patient_number_aliases" ADD CONSTRAINT "patient_number_aliases_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "patients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "patient_changes" ADD CONSTRAINT "patient_changes_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "patients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "patient_changes" ADD CONSTRAINT "patient_changes_changedById_fkey" FOREIGN KEY ("changedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "patient_changes" ADD CONSTRAINT "patient_changes_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "referring_doctors" ADD CONSTRAINT "referring_doctors_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "panels" ADD CONSTRAINT "panels_priceListId_fkey" FOREIGN KEY ("priceListId") REFERENCES "price_lists"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "price_list_items" ADD CONSTRAINT "price_list_items_priceListId_fkey" FOREIGN KEY ("priceListId") REFERENCES "price_lists"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "price_list_items" ADD CONSTRAINT "price_list_items_catalogItemId_fkey" FOREIGN KEY ("catalogItemId") REFERENCES "catalog_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "camps" ADD CONSTRAINT "camps_panelId_fkey" FOREIGN KEY ("panelId") REFERENCES "panels"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "camps" ADD CONSTRAINT "camps_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "camps" ADD CONSTRAINT "camps_priceListId_fkey" FOREIGN KEY ("priceListId") REFERENCES "price_lists"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "camps" ADD CONSTRAINT "camps_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "machines" ADD CONSTRAINT "machines_machineTypeId_fkey" FOREIGN KEY ("machineTypeId") REFERENCES "machine_types"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "machines" ADD CONSTRAINT "machines_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "catalog_draws" ADD CONSTRAINT "catalog_draws_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "catalog_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "catalog_machine_steps" ADD CONSTRAINT "catalog_machine_steps_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "catalog_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "catalog_machine_steps" ADD CONSTRAINT "catalog_machine_steps_machineTypeId_fkey" FOREIGN KEY ("machineTypeId") REFERENCES "machine_types"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "profile_components" ADD CONSTRAINT "profile_components_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "catalog_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "profile_components" ADD CONSTRAINT "profile_components_testId_fkey" FOREIGN KEY ("testId") REFERENCES "catalog_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approvals" ADD CONSTRAINT "approvals_billId_fkey" FOREIGN KEY ("billId") REFERENCES "bills"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approvals" ADD CONSTRAINT "approvals_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approvals" ADD CONSTRAINT "approvals_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approvals" ADD CONSTRAINT "approvals_resolvedById_fkey" FOREIGN KEY ("resolvedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bills" ADD CONSTRAINT "bills_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "patients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bills" ADD CONSTRAINT "bills_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bills" ADD CONSTRAINT "bills_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bills" ADD CONSTRAINT "bills_referringDoctorId_fkey" FOREIGN KEY ("referringDoctorId") REFERENCES "referring_doctors"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bills" ADD CONSTRAINT "bills_panelId_fkey" FOREIGN KEY ("panelId") REFERENCES "panels"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bills" ADD CONSTRAINT "bills_campId_fkey" FOREIGN KEY ("campId") REFERENCES "camps"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bills" ADD CONSTRAINT "bills_quotationId_fkey" FOREIGN KEY ("quotationId") REFERENCES "quotations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bill_items" ADD CONSTRAINT "bill_items_billId_fkey" FOREIGN KEY ("billId") REFERENCES "bills"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bill_items" ADD CONSTRAINT "bill_items_catalogItemId_fkey" FOREIGN KEY ("catalogItemId") REFERENCES "catalog_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bill_items" ADD CONSTRAINT "bill_items_cancellationId_fkey" FOREIGN KEY ("cancellationId") REFERENCES "cancellations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sample_collections" ADD CONSTRAINT "sample_collections_billItemId_fkey" FOREIGN KEY ("billItemId") REFERENCES "bill_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sample_collections" ADD CONSTRAINT "sample_collections_testId_fkey" FOREIGN KEY ("testId") REFERENCES "catalog_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sample_collections" ADD CONSTRAINT "sample_collections_collectedById_fkey" FOREIGN KEY ("collectedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bill_reassignments" ADD CONSTRAINT "bill_reassignments_billId_fkey" FOREIGN KEY ("billId") REFERENCES "bills"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bill_reassignments" ADD CONSTRAINT "bill_reassignments_fromTechnicianId_fkey" FOREIGN KEY ("fromTechnicianId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bill_reassignments" ADD CONSTRAINT "bill_reassignments_toTechnicianId_fkey" FOREIGN KEY ("toTechnicianId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bill_reassignments" ADD CONSTRAINT "bill_reassignments_reassignedById_fkey" FOREIGN KEY ("reassignedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bill_events" ADD CONSTRAINT "bill_events_billId_fkey" FOREIGN KEY ("billId") REFERENCES "bills"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bill_events" ADD CONSTRAINT "bill_events_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_billId_fkey" FOREIGN KEY ("billId") REFERENCES "bills"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_operatorId_fkey" FOREIGN KEY ("operatorId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cancellations" ADD CONSTRAINT "cancellations_billId_fkey" FOREIGN KEY ("billId") REFERENCES "bills"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cancellations" ADD CONSTRAINT "cancellations_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_billId_fkey" FOREIGN KEY ("billId") REFERENCES "bills"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_cancellationId_fkey" FOREIGN KEY ("cancellationId") REFERENCES "cancellations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quotations" ADD CONSTRAINT "quotations_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "patients"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quotations" ADD CONSTRAINT "quotations_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quotations" ADD CONSTRAINT "quotations_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quotations" ADD CONSTRAINT "quotations_referringDoctorId_fkey" FOREIGN KEY ("referringDoctorId") REFERENCES "referring_doctors"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quotations" ADD CONSTRAINT "quotations_panelId_fkey" FOREIGN KEY ("panelId") REFERENCES "panels"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quotations" ADD CONSTRAINT "quotations_campId_fkey" FOREIGN KEY ("campId") REFERENCES "camps"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quotation_items" ADD CONSTRAINT "quotation_items_quotationId_fkey" FOREIGN KEY ("quotationId") REFERENCES "quotations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quotation_items" ADD CONSTRAINT "quotation_items_catalogItemId_fkey" FOREIGN KEY ("catalogItemId") REFERENCES "catalog_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

