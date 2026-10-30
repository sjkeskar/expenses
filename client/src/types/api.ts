// Shapes of the API responses the screens use (hand-written for Phase 1; see
// src/routes/ on the server). Money and Decimal columns arrive as strings.

export type Role = "developer" | "lead_pathologist" | "pathologist" | "technician" | "accountant";

export interface User {
  id: string;
  name: string;
  role: Role;
}

export interface Account extends User {
  isDeleted: boolean;
  deletedAt: string | null;
  lastLoginAt: string | null;
  createdAt: string;
}

export interface LabSettings {
  labName: string;
  phone: string;
  email: string | null;
  address: string;
}

export type LocationType = "branch" | "collection_centre";

export interface Location {
  id: string;
  name: string;
  locationCode: string;
  type: LocationType;
  address: string;
  phone: string | null;
  processingBranchId: string | null;
  processingBranch: { id: string; name: string } | null;
  homeVisitCharge: string | null; // null = no home visits from here
}

export interface LeadStatus {
  lead: { id: string; name: string; lastActivity: string; inactive: boolean } | null;
  inactiveAfterDays: number;
  pathologists: { id: string; name: string; lastLoginAt: string | null }[];
}

export interface Ref {
  id: string;
  name: string;
}

export type Sex = "male" | "female" | "other";

export interface Patient {
  id: string;
  patientNumber: string;
  name: string;
  dateOfBirth: string; // YYYY-MM-DDT00:00:00.000Z
  dobIsApproximate: boolean;
  sex: Sex;
  phone: string;
  createdAt: string;
  age: number;
}

export interface PatientChange {
  id: string;
  field: string;
  oldValue: string;
  newValue: string;
  changedAt: string;
}

export interface PatientDetail extends Patient {
  aliases: { id: string; number: string; retiredAt: string }[];
  changes: PatientChange[];
  bills: { id: string; billNumber: string; createdAt: string; netAmount: string; balance: string; status: BillStatus }[];
  quotations: { id: string; quoteNumber: string; issuedAt: string; netAmount: string; status: QuotationStatus }[];
}

// ---- catalog ----

export type CatalogKind = "test" | "profile" | "service";

export interface MachineType {
  id: string;
  name: string;
}

export interface Machine {
  id: string;
  name: string;
  machineType: MachineType;
  branch: Ref;
}

export interface CatalogItem {
  id: string;
  code: string;
  name: string;
  kind: CatalogKind;
  price: string;
  department: string | null;
  sampleType: string | null;
  container: string | null;
  instructions: string | null;
  draws: { id: string; sequence: number; label: string }[];
  machineSteps: { id: string; sequence: number; machineType: MachineType }[];
  components: { test: { id: string; code: string; name: string } }[];
}

// The values of one catalog row, as proposed (POST /catalog/changes).
export interface CatalogValues {
  code: string;
  name: string;
  kind: CatalogKind;
  price: number | string;
  department?: string | null;
  sampleType?: string | null;
  container?: string | null;
  instructions?: string | null;
  draws?: string[];
  machineSteps?: { sequence: number; machineTypeId: string }[];
  components?: string[]; // test ids
}

export type DoctorStatus = "pending" | "approved" | "rejected";

export interface Doctor {
  id: string;
  name: string;
  phone: string | null;
  clinic: string | null;
  status: DoctorStatus;
  createdBy?: Ref;
  createdAt: string;
}

// ---- panels, camps ----

export type PanelType = "corporate" | "tpa" | "insurer";

export interface PriceList {
  id: string;
  discountPercent: string | null;
  items: { id: string; catalogItemId: string; price: string }[];
}

export interface Panel {
  id: string;
  name: string;
  type: PanelType;
  contact: string | null;
  priceList: PriceList | null;
}

export interface Camp {
  id: string;
  name: string;
  venue: string | null;
  panel: Ref;
  location: Ref;
  startsAt: string;
  endsAt: string;
  priceList: PriceList;
  running: boolean;
}

// ---- approvals ----

export type ApprovalSubject = "catalog_change" | "referring_doctor" | "patient_correction" | "bill_discount" | "bill_cancellation";
export type ApprovalStatus = "pending" | "approved" | "rejected" | "resolved";

export interface Approval {
  id: string;
  subjectType: ApprovalSubject;
  subjectId: string | null;
  billId: string | null;
  // catalog: { action, values? }; discount: { from, to }; cancellation: { items, refund };
  // correction: { from, to } (patient fields)
  payload: any;
  status: ApprovalStatus;
  selfApproved: boolean;
  requestedBy: Ref & { role?: Role };
  requestedAt: string;
  reviewedBy: Ref | null;
  reviewedAt: string | null;
  reviewNote: string | null;
  resolvedBy?: Ref | null;
  resolveNote?: string | null;
  bill?: { id: string; billNumber: string; netAmount: string; balance: string; patient: { id: string; name: string; patientNumber: string } } | null;
  // The doctor, patient, catalog item (as it stands) or cancellation.
  subject?: any;
}

export interface ApprovalList {
  approvals: Approval[];
  names: Record<string, string>; // machine-type and test ids in catalog proposals
}

// ---- bills ----

export type ReferralType = "walk_in" | "doctor";
export type PayerType = "self" | "panel";
export type CollectionMode = "at_location" | "home_visit";
export type BillStatus = "pending" | "fully_paid" | "cancelled";
export type PaymentMode = "cash" | "credit_card" | "upi";

export interface LineCatalog {
  instructions: string | null;
  components: { test: { id: string; code: string; name: string; instructions: string | null } }[];
}

export interface Collection {
  id: string;
  testId: string;
  test: { id: string; code: string; name: string };
  sequence: number;
  label: string;
  status: "pending" | "collected";
  dueAt: string | null;
  collectedAt: string | null;
}

export interface BillItem {
  id: string;
  catalogItemId: string;
  code: string;
  name: string;
  kind: CatalogKind;
  price: string;
  status: "active" | "cancelled";
  processingStatus: "not_started" | "in_progress" | "completed";
  catalogItem: LineCatalog;
  collections: Collection[];
}

export interface Payment {
  id: string;
  kind: "payment" | "settlement";
  amountCollected: string;
  discountAmount: string;
  mode: PaymentMode;
  operator: Ref;
  createdAt: string;
}

export interface Refund {
  id: string;
  cancellationId: string;
  amount: string;
  mode: PaymentMode;
  createdBy: Ref;
  createdAt: string;
}

export interface BillSummary {
  id: string;
  billNumber: string;
  createdAt: string;
  patient: Patient;
  patientAge: number;
  location: Ref;
  createdBy: Ref;
  referralType: ReferralType;
  referringDoctor: Doctor | null;
  payerType: PayerType;
  panel: (Ref & { type?: PanelType }) | null;
  originalAmount: string;
  discountAmount: string;
  netAmount: string;
  balance: string;
  status: BillStatus;
  holds: string[];
}

export interface Bill extends BillSummary {
  location: Location;
  camp: Ref | null;
  collectionMode: CollectionMode;
  homeVisitAddress: string | null;
  expectedReportAt: string | null;
  verificationCode: string;
  quotation: { id: string; quoteNumber: string } | null;
  items: BillItem[];
  transactions: Payment[];
  refunds: Refund[];
  cancellations: { id: string; reason: string; createdAt: string; createdBy: Ref; items: { id: string; code: string }[] }[];
  approvals: Approval[];
  reassignments: { id: string; fromTechnician: Ref; toTechnician: Ref; reassignedBy: Ref; reassignedAt: string }[];
  events: { id: string; kind: string; detail: unknown; createdBy: Ref; createdAt: string }[];
}

export interface PreviewLine {
  catalogItemId: string;
  code: string;
  name: string;
  kind: CatalogKind;
  price: string;
}

export interface Preview {
  lines: PreviewLine[];
  originalAmount: string;
  discountAmount: string;
  netAmount: string;
  warnings: string[];
}

export interface Revisit {
  id: string;
  label: string;
  sequence: number;
  dueAt: string;
  test: { id: string; code: string; name: string };
  billItem: { id: string; code: string; bill: { id: string; billNumber: string; patient: Patient } };
}

export interface DaySheet {
  date: string;
  user: User;
  money: { at: string; kind: "payment" | "settlement" | "refund"; mode: PaymentMode; amount: string; bill: { id: string; billNumber: string; patient: Ref } }[];
  totals: Record<PaymentMode | "total", string>;
  bills: (BillSummary & { items: BillItem[] })[];
}

// ---- quotations ----

export type QuotationStatus = "open" | "converted" | "cancelled";

export interface QuotationSummary {
  id: string;
  quoteNumber: string;
  patientId: string | null;
  patientName: string;
  patientPhone: string | null;
  location: Ref;
  createdBy: Ref;
  netAmount: string;
  issuedAt: string;
  validUntil: string;
  status: QuotationStatus;
  expired: boolean;
  bill: { id: string; billNumber: string } | null;
  convertible?: boolean; // in the list: whether it can become a bill now
}

export interface Quotation extends QuotationSummary {
  verificationCode: string;
  patient: Patient | null;
  location: Location;
  collectionMode: CollectionMode;
  referralType: ReferralType;
  referringDoctor: Doctor | null;
  payerType: PayerType;
  panel: (Ref & { type: PanelType }) | null;
  camp: Ref | null;
  originalAmount: string;
  discountAmount: string;
  items: { id: string; catalogItemId: string; code: string; name: string; kind: CatalogKind; price: string; catalogItem: LineCatalog }[];
  reissuedFrom: { id: string; quoteNumber: string } | null;
  reissuedAs: { id: string; quoteNumber: string } | null;
  conversion: { allowed: boolean; reason?: string; reissue?: boolean };
}

export interface VerifiedDocument {
  type: "bill" | "quotation";
  id: string;
  number: string;
  issuedAt: string;
  location: Ref;
  patient: { id?: string; name: string; patientNumber?: string };
  netAmount: string;
  balance?: string;
  validUntil?: string;
  status: string;
  patientCorrectedAt: string | null;
}
