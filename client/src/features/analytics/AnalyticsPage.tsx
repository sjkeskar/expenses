import { useState } from "react";
import { Button, DatePicker, Flex, Segmented, Table, Tabs, Typography } from "antd";
import { DownloadOutlined } from "@ant-design/icons";
import { useApi } from "../../lib/hooks";
import { dayOf, dayPicker, formatDate, formatMoney, istNow, KIND_LABELS, MODE_LABELS, PANEL_TYPE_LABELS, periodOf } from "../../lib/format";
import Page, { Figures, NOWRAP, Section } from "../../components/Page";
import type { CatalogKind, PanelType, PaymentMode } from "../../types/api";
import { downloadPdf, pdfMoney, type PdfTable } from "./pdf";

// Analytics for the lead and the accountant (pivot.md §6.10): the period
// tally for audit (equal to the sum of the period's day sheets), and
// summaries by day, person, location, referral, payer and test. Every
// table downloads as an A4 PDF.
type Preset = "today" | "week" | "month" | "lastMonth" | "custom";
type Row = Record<string, unknown>;

interface Column {
  title: string;
  value(row: Row): string | number;
  money?: boolean;
}

interface Report {
  key: string;
  label: string;
  path: string;
  rows: string; // the response field holding the rows
  dated?: false; // current balances, not for a period
  columns: Column[];
}

const n = (field: string) => (row: Row) => Number(row[field] ?? 0);
const money = (title: string, field: string): Column => ({ title, value: n(field), money: true });
const count = (title: string, field: string): Column => ({ title, value: n(field) });
const BILLED = [count("Bills", "bills"), money("Billed", "total_billed"), money("Discount", "total_discount"), money("Net", "net_billed"), money("Outstanding", "total_pending")];

const REPORTS: Report[] = [
  {
    key: "day",
    label: "Day-wise",
    path: "day-wise",
    rows: "dayWise",
    columns: [
      { title: "Day", value: (r) => formatDate(String(r.day).slice(0, 10)) },
      count("Payments", "payment_count"),
      count("Refunds", "refund_count"),
      money("Refunded", "refund_total"),
      money("Cash", "cash"),
      money("Card", "credit_card"),
      money("UPI", "upi"),
      money("Net collected", "net_collected"),
    ],
  },
  {
    key: "technician",
    label: "Staff-wise",
    path: "technician-wise",
    rows: "technicianWise",
    columns: [
      { title: "Name", value: (r) => String(r.user_name ?? "") },
      count("Bills", "bills_created"),
      money("Billed", "total_billed"),
      money("Discount", "total_discount"),
      money("Outstanding", "total_pending"),
      count("Payments", "payment_count"),
      money("Net collected", "net_collected"),
    ],
  },
  {
    key: "location",
    label: "Location-wise",
    path: "location-wise",
    rows: "locationWise",
    columns: [
      { title: "Location", value: (r) => String(r.location_name) },
      { title: "Type", value: (r) => (r.location_type === "branch" ? "Branch" : "Collection centre") },
      count("Bills", "bills_created"),
      money("Billed", "total_billed"),
      money("Discount", "total_discount"),
      money("Outstanding", "total_pending"),
    ],
  },
  {
    key: "referral",
    label: "Referral-wise",
    path: "referral-wise",
    rows: "referralWise",
    columns: [{ title: "Referred by", value: (r) => (r.referral_type === "walk_in" ? "Walk-in" : String(r.doctor_name ?? "Doctor (not named)")) }, ...BILLED],
  },
  {
    key: "payer",
    label: "Payer-wise",
    path: "payer-wise",
    rows: "payerWise",
    columns: [{ title: "Payer", value: (r) => (r.payer_type === "self" ? "Self" : `${r.panel_name} (${PANEL_TYPE_LABELS[r.panel_type as PanelType]})`) }, ...BILLED],
  },
  {
    key: "test",
    label: "Test-wise",
    path: "test-wise",
    rows: "testWise",
    columns: [
      { title: "Code", value: (r) => String(r.code) },
      { title: "Name", value: (r) => String(r.name) },
      { title: "Kind", value: (r) => KIND_LABELS[r.kind as CatalogKind] },
      count("Billed", "billed_count"),
      money("Amount", "billed_amount"),
      count("Cancelled", "cancelled_count"),
    ],
  },
  {
    key: "patients",
    label: "Patient balances",
    path: "patient-outstanding",
    rows: "patientOutstanding",
    dated: false,
    columns: [
      { title: "Patient", value: (r) => String(r.patient_name) },
      { title: "Patient no.", value: (r) => String(r.patient_number) },
      count("Bills due", "pending_bill_count"),
      money("Outstanding", "outstanding_balance"),
    ],
  },
];

// A report as a PDF table: money as plain numbers, right-aligned.
const pdfTable = (columns: Column[], rows: Row[], heading?: string): PdfTable => ({
  heading,
  head: columns.map((c) => (c.money ? `${c.title} (Rs)` : c.title)),
  body: rows.map((r) => columns.map((c) => (c.money ? pdfMoney(c.value(r)) : c.value(r)))),
  numeric: columns.flatMap((c, i) => (c.money || typeof c.value({}) === "number" ? [i] : [])),
});

export default function AnalyticsPage() {
  const [preset, setPreset] = useState<Preset>("today");
  const [custom, setCustom] = useState<[string, string]>(periodOf("month"));
  const [tab, setTab] = useState("tally");
  const [from, to] = preset === "custom" ? custom : periodOf(preset);
  const period = from === to ? formatDate(from) : `${formatDate(from)} – ${formatDate(to)}`;
  const query = `startDate=${from}&endDate=${to}`;

  return (
    <Page title="Analytics" description="Money and billing for a period, for audit and review.">
      <Section
        toolbar={
          <>
            <Segmented<Preset>
              value={preset}
              onChange={setPreset}
              options={[
                { value: "today", label: "Today" },
                { value: "week", label: "This week" },
                { value: "month", label: "This month" },
                { value: "lastMonth", label: "Last month" },
                { value: "custom", label: "Custom" },
              ]}
            />
            {preset === "custom" && (
              <DatePicker.RangePicker
                aria-label="Period"
                format="DD/MM/YYYY"
                allowClear={false}
                value={[dayPicker(custom[0]), dayPicker(custom[1])]}
                disabledDate={(d) => d.isAfter(istNow(), "day")}
                onChange={(range) => range?.[0] && range[1] && setCustom([dayOf(range[0]), dayOf(range[1])])}
              />
            )}
          </>
        }
      >
        <Typography.Text>Period: {period}</Typography.Text>
      </Section>
      <Tabs
        activeKey={tab}
        onChange={setTab}
        destroyOnHidden
        items={[
          { key: "tally", label: "Tally", children: <Tally query={query} period={period} /> },
          ...REPORTS.map((r) => ({ key: r.key, label: r.label, children: <ReportTable report={r} query={query} period={period} /> })),
        ]}
      />
    </Page>
  );
}

function ReportTable({ report, query, period }: { report: Report; query: string; period: string }) {
  const data = useApi<Record<string, Row[]>>(`/analytics/${report.path}${report.dated === false ? "" : `?${query}`}`);
  const rows = data.data?.[report.rows].map((r, i) => ({ ...r, key: i }));
  const subtitle = report.dated === false ? "Current balances" : `Period: ${period}`;
  return (
    <Section
      title={report.label}
      flush
      extra={
        <Button icon={<DownloadOutlined aria-hidden />} disabled={!rows} onClick={() => downloadPdf(`${report.path}.pdf`, `${report.label} summary`, subtitle, [pdfTable(report.columns, rows!)])}>
          Download PDF
        </Button>
      }
    >
      <Table<Row>
        rowKey="key"
        size="middle"
        loading={!data.data && !data.error}
        dataSource={rows}
        pagination={{ pageSize: 50, hideOnSinglePage: true, showSizeChanger: false }}
        scroll={{ x: "max-content" }}
        locale={{ emptyText: "Nothing in this period" }}
        columns={report.columns.map((c) => ({
          title: c.title,
          render: (_: unknown, r: Row) => (c.money ? formatMoney(c.value(r)) : c.value(r)),
          align: c.money || typeof c.value({}) === "number" ? ("right" as const) : undefined,
          ...(c.money ? NOWRAP : {}),
        }))}
      />
    </Section>
  );
}

interface TallyData {
  tally: {
    byMode: { mode: PaymentMode; payments: number; settlements: number; refunds: number; net: number }[];
    totals: { payments: number; settlements: number; refunds: number; net: number };
    panels: { panel_id: string; panel_name: string; panel_type: PanelType; pending_bills: number; outstanding: number }[];
    discounts: { approved: number; approved_count: number; pending: number; pending_count: number };
  };
}

const MODE_COLUMNS: Column[] = [
  { title: "Mode", value: (r) => (r.mode === "total" ? "Total" : MODE_LABELS[r.mode as PaymentMode]) },
  money("Payments", "payments"),
  money("Panel settlements", "settlements"),
  money("Refunds", "refunds"),
  money("Net collected", "net"),
];
const PANEL_COLUMNS: Column[] = [
  { title: "Panel", value: (r) => String(r.panel_name) },
  { title: "Type", value: (r) => PANEL_TYPE_LABELS[r.panel_type as PanelType] },
  count("Bills due", "pending_bills"),
  money("Outstanding", "outstanding"),
];

// The accountant's tally (pivot.md §6.10): money in and out by mode, the
// discounts given on the period's bills, and what panels owe now.
function Tally({ query, period }: { query: string; period: string }) {
  const data = useApi<TallyData>(`/analytics/tally?${query}`);
  const tally = data.data?.tally;
  const modeRows: Row[] = tally ? [...tally.byMode, { mode: "total", ...tally.totals }].map((r) => ({ ...r, key: r.mode })) : [];
  const discountRows: Row[] = tally
    ? [
        { key: "approved", what: "Approved", bills: tally.discounts.approved_count, amount: tally.discounts.approved },
        { key: "pending", what: "Awaiting approval", bills: tally.discounts.pending_count, amount: tally.discounts.pending },
      ]
    : [];
  const DISCOUNT_COLUMNS: Column[] = [{ title: "Discounts", value: (r) => String(r.what) }, count("Bills", "bills"), money("Amount", "amount")];

  const pdf = () =>
    downloadPdf("tally.pdf", "Tally", `Period: ${period}`, [
      pdfTable(MODE_COLUMNS, modeRows, "Collected by mode (equals the sum of the period's day sheets)"),
      pdfTable(DISCOUNT_COLUMNS, discountRows, "Discounts on bills raised in the period"),
      pdfTable(PANEL_COLUMNS, tally!.panels as unknown as Row[], "Panel balances outstanding now"),
    ]);

  const table = (columns: Column[], rows: Row[], empty: string) => (
    <Table<Row>
      rowKey="key"
      size="middle"
      pagination={false}
      loading={!tally}
      dataSource={rows}
      locale={{ emptyText: empty }}
      columns={columns.map((c) => ({
        title: c.title,
        render: (_: unknown, r: Row) => (c.money ? formatMoney(c.value(r)) : c.value(r)),
        align: c.money || typeof c.value({}) === "number" ? ("right" as const) : undefined,
        onCell: (r: Row) => ({ style: { whiteSpace: "nowrap", fontWeight: r.mode === "total" ? 600 : undefined } }),
      }))}
    />
  );

  return (
    <Flex vertical gap={16}>
      <Section title="Collected" extra={<Button icon={<DownloadOutlined aria-hidden />} disabled={!tally} onClick={pdf}>Download PDF</Button>}>
        <Flex vertical gap={16}>
          <Figures
            items={[
              { label: "Payments", value: tally ? formatMoney(tally.totals.payments) : "—" },
              { label: "Panel settlements", value: tally ? formatMoney(tally.totals.settlements) : "—" },
              { label: "Refunds", value: tally ? formatMoney(tally.totals.refunds) : "—" },
              { label: "Net collected", value: tally ? formatMoney(tally.totals.net) : "—", strong: true },
            ]}
          />
          <Typography.Text type="secondary">These totals equal the sum of every day sheet in the period.</Typography.Text>
        </Flex>
      </Section>
      <Section title="By payment mode" flush>
        {table(MODE_COLUMNS, modeRows, "No money moved in this period")}
      </Section>
      <Section title="Discounts on the period's bills" flush>
        {table(DISCOUNT_COLUMNS, discountRows, "")}
      </Section>
      <Section title="Panel balances outstanding now" flush>
        {table(PANEL_COLUMNS, (tally?.panels ?? []).map((p) => ({ ...p, key: p.panel_id })), "No panel owes anything")}
      </Section>
    </Flex>
  );
}
