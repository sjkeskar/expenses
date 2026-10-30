// Display formatting and dates. Dates are always shown in IST, whatever
// timezone the PC is set to (README "Timezone"); components never call dayjs
// themselves, only these helpers.
import dayjs, { type Dayjs } from "dayjs";
import utc from "dayjs/plugin/utc";
import timezone from "dayjs/plugin/timezone";
import type { ApprovalSubject, BillStatus, CatalogKind, PanelType, PaymentMode, Role, Sex } from "../types/api";

dayjs.extend(utc);
dayjs.extend(timezone);

export type { Dayjs };

export const IST = "Asia/Kolkata";

// Times are 12-hour with AM/PM, as reception staff read them, on screens,
// prints and in the pickers alike.
export function formatDateTime(value: string | null | undefined) {
  return value ? dayjs(value).tz(IST).format("DD/MM/YYYY hh:mm A") : "—";
}

export function formatTime(value: string) {
  return dayjs(value).tz(IST).format("hh:mm A");
}

// The props every date-and-time picker shares: 12-hour time with AM/PM.
export const DATE_TIME = { showTime: { format: "hh:mm A", use12Hours: true }, format: "DD/MM/YYYY hh:mm A" };

// An instant, or a calendar day (YYYY-MM-DD, e.g. a date of birth).
export function formatDate(value: string | null | undefined) {
  if (!value) return "—";
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? dayjs(value).format("DD/MM/YYYY") : dayjs(value).tz(IST).format("DD/MM/YYYY");
}

// Today's IST calendar day, YYYY-MM-DD.
export const istToday = () => dayjs().tz(IST).format("YYYY-MM-DD");

// The IST calendar day of an instant, YYYY-MM-DD.
export const istDay = (value: string) => dayjs(value).tz(IST).format("YYYY-MM-DD");

// Now, as an IST date-time for pickers.
export const istNow = () => dayjs().tz(IST);

// A server instant as a picker value (IST wall-clock time).
export const toPicker = (value: string | null | undefined) => (value ? dayjs(value).tz(IST) : undefined);

// A picker's wall-clock time, taken as IST, as the server expects it:
// "2026-10-27T09:30:00+05:30".
export const fromPicker = (value: Dayjs | null | undefined) =>
  value ? dayjs.tz(value.format("YYYY-MM-DDTHH:mm:ss"), IST).format() : null;

// A picker's calendar day, YYYY-MM-DD.
export const dayOf = (value: Dayjs) => value.format("YYYY-MM-DD");

// A YYYY-MM-DD day as a date-picker value.
export const dayPicker = (day: string) => dayjs(day);

// The analytics periods (pivot.md §6.10), each [first day, last day] in IST.
// A week starts on Monday.
export function periodOf(preset: "today" | "week" | "month" | "lastMonth"): [string, string] {
  const today = dayjs().tz(IST);
  const day = (d: Dayjs) => d.format("YYYY-MM-DD");
  if (preset === "today") return [day(today), day(today)];
  if (preset === "week") return [day(today.subtract((today.day() + 6) % 7, "day")), day(today)];
  if (preset === "month") return [day(today.startOf("month")), day(today)];
  const last = today.startOf("month").subtract(1, "day");
  return [day(last.startOf("month")), day(last)];
}

const INR = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR" });

export function formatMoney(value: string | number) {
  return INR.format(Number(value));
}

// Money in integer paise, for the few sums a screen shows before the server
// confirms them (e.g. a refund estimate). Never sent to the server.
export const paise = (value: string | number | null | undefined) => Math.round(Number(value ?? 0) * 100);

export const SEX_LABELS: Record<Sex, string> = { male: "Male", female: "Female", other: "Other" };

// "34 y · F"
export const ageSex = (age: number, sex: Sex) => `${age} y · ${sex[0].toUpperCase()}`;

export const ROLE_LABELS: Record<Role, string> = {
  developer: "Developer",
  lead_pathologist: "Lead pathologist",
  pathologist: "Pathologist",
  technician: "Technician",
  accountant: "Accountant",
};

export const KIND_LABELS: Record<CatalogKind, string> = { test: "Test", profile: "Profile", service: "Service" };

export const PANEL_TYPE_LABELS: Record<PanelType, string> = { corporate: "Corporate", tpa: "TPA", insurer: "Insurer" };

export const MODE_LABELS: Record<PaymentMode, string> = { cash: "Cash", credit_card: "Card", upi: "UPI" };
export const MODES = Object.keys(MODE_LABELS) as PaymentMode[];
export const MODE_OPTIONS = MODES.map((value) => ({ value, label: MODE_LABELS[value] }));

export const BILL_STATUS: Record<BillStatus, { text: string; status: "processing" | "success" | "default" }> = {
  pending: { text: "Balance due", status: "processing" },
  fully_paid: { text: "Paid", status: "success" },
  cancelled: { text: "Cancelled", status: "default" },
};

export const SUBJECT_LABELS: Record<ApprovalSubject, string> = {
  catalog_change: "Catalog change",
  referring_doctor: "New doctor",
  patient_correction: "Patient correction",
  bill_discount: "Discount",
  bill_cancellation: "Cancellation",
};

export const PATIENT_FIELD_LABELS: Record<string, string> = {
  name: "Name",
  dateOfBirth: "Date of birth",
  dobIsApproximate: "Age only",
  sex: "Sex",
  phone: "Phone",
};
