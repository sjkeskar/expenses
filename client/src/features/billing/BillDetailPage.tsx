import { useState, type Key } from "react";
import { Link, useParams } from "react-router-dom";
import { Alert, App, Badge, Button, Checkbox, Flex, DatePicker, Descriptions, Form, Input, InputNumber, Popconfirm, Select, Table, Tag, Typography } from "antd";
import { api } from "../../api";
import { useSession } from "../../auth/session";
import { useAction, useApi } from "../../lib/hooks";
import { ageSex, BILL_STATUS, DATE_TIME, formatDateTime, formatMoney, fromPicker, KIND_LABELS, MODE_LABELS, MODE_OPTIONS, paise, SUBJECT_LABELS, toPicker, type Dayjs } from "../../lib/format";
import FormModal from "../../components/FormModal";
import Page, { Figures, NOWRAP, Section } from "../../components/Page";
import type { Bill, BillItem, Collection, PaymentMode, User } from "../../types/api";
import { ApprovalStatusBadge } from "../approvals/ApprovalDetails";
import { payerText } from "./BillsPage";

type Dialog = "payment" | "discount" | "cancel" | "report" | "reassign";

const EVENT_TEXT: Record<string, string> = {
  doctor_dropped: "Referring doctor removed (rejected by the lead)",
  discount_reverted: "Discount reverted (rejected)",
};

// One bill (pivot.md §6.5): items with their samples, payments, refunds,
// report holds and history; payments, discounts, cancellations, revisit
// collections, the report time and reassignment happen here.
export default function BillDetailPage() {
  const { id } = useParams();
  const { user } = useSession();
  const { message } = App.useApp();
  const data = useApi<{ bill: Bill }>(`/bills/${id}`);
  const [dialog, setDialog] = useState<Dialog>();
  const [samples, setSamples] = useState<Key[]>([]);
  const canAct = user!.role !== "accountant";
  const isLead = user!.role === "lead_pathologist";

  const [collect, collecting] = useAction(async () => {
    await api(`/bills/${id}/samples`, { method: "PATCH", body: { collectionIds: samples } });
    message.success("The samples are recorded as collected.");
    setSamples([]);
    await data.reload();
  });

  if (!data.data) return null;
  const { bill } = data.data;
  const open = bill.status !== "cancelled";
  const active = bill.items.filter((i) => i.status === "active");
  const collections = bill.items.flatMap((item) => item.collections.map((c) => ({ ...c, item })));

  // Runs a change to this bill, then shows the bill as the server returns it.
  const change = (path: string, method: string, success: string) => async (body: object) => {
    await api(path, { method, body });
    message.success(success);
    await data.reload();
  };

  return (
    <Page
      title={`Bill ${bill.billNumber}`}
      description={`${formatDateTime(bill.createdAt)} · ${bill.location.name} · ${bill.createdBy.name}`}
      actions={
        <>
          <Button onClick={() => window.open(`/print/bill/${bill.id}`, "_blank")}>Print bill</Button>
          {canAct && open && (
            <>
              <Button onClick={() => setDialog("cancel")}>Cancel tests</Button>
              <Button onClick={() => setDialog("discount")}>Change discount</Button>
              {isLead && <Button onClick={() => setDialog("reassign")}>Reassign</Button>}
              {paise(bill.balance) > 0 && (
                <Button type="primary" onClick={() => setDialog("payment")}>
                  Record payment
                </Button>
              )}
            </>
          )}
        </>
      }
    >
      {bill.holds.length > 0 && (
        <Alert type="warning" showIcon title="Report on hold" description={bill.holds.join(" · ")} />
      )}
      <Section title="Summary">
        <Flex vertical gap={16}>
          <Descriptions
            column={{ xs: 1, md: 2, xl: 3 }}
            items={[
              { label: "Patient", children: <Link to={`/patients/${bill.patient.id}`}>{bill.patient.name}</Link> },
              { label: "Patient no.", children: bill.patient.patientNumber },
              { label: "Age / sex", children: ageSex(bill.patientAge, bill.patient.sex) },
              { label: "Phone", children: bill.patient.phone },
              { label: "Referral", children: bill.referralType === "walk_in" ? "Walk-in" : `Doctor${bill.referringDoctor ? `: ${bill.referringDoctor.name}` : " (not named)"}` },
              { label: "Payer", children: `${payerText(bill)}${bill.camp ? ` · camp ${bill.camp.name}` : ""}` },
              { label: "Collection", children: bill.collectionMode === "home_visit" ? `Home visit${bill.homeVisitAddress ? `: ${bill.homeVisitAddress}` : ""}` : "At the location" },
              {
                label: "Report expected by",
                children: (
                  <>
                    {formatDateTime(bill.expectedReportAt)}
                    {canAct && open && (
                      <Button type="link" size="small" onClick={() => setDialog("report")}>
                        Change
                      </Button>
                    )}
                  </>
                ),
              },
              { label: "Status", children: <Badge {...BILL_STATUS[bill.status]} /> },
              ...(bill.quotation ? [{ label: "From quotation", children: <Link to={`/quotations/${bill.quotation.id}`}>{bill.quotation.quoteNumber}</Link> }] : []),
              { label: "Verification code", children: bill.verificationCode },
            ]}
          />
          <Figures
            items={[
              { label: "Subtotal", value: formatMoney(bill.originalAmount) },
              { label: "Discount", value: formatMoney(bill.discountAmount) },
              { label: "Net amount", value: formatMoney(bill.netAmount) },
              { label: "Balance", value: formatMoney(bill.balance), strong: true },
            ]}
          />
        </Flex>
      </Section>
      <Section title="Items" flush>
        <Table<BillItem>
          rowKey="id"
          size="middle"
          pagination={false}
          dataSource={bill.items}
          columns={[
            { title: "Code", dataIndex: "code", ...NOWRAP },
            {
              title: "Name",
              render: (_, i) => (
                <>
                  {i.name}
                  {i.kind === "profile" && (
                    <Typography.Text type="secondary" style={{ display: "block", fontSize: 12 }}>
                      {i.catalogItem.components.map((c) => c.test.code).sort().join(", ")}
                    </Typography.Text>
                  )}
                </>
              ),
            },
            { title: "Kind", dataIndex: "kind", render: (k: BillItem["kind"]) => <Tag>{KIND_LABELS[k]}</Tag>, ...NOWRAP },
            { title: "Price", dataIndex: "price", align: "right", render: formatMoney, ...NOWRAP },
            { title: "Status", dataIndex: "status", ...NOWRAP, render: (s) => <Badge status={s === "active" ? "success" : "default"} text={s === "active" ? "Billed" : "Cancelled"} /> },
          ]}
        />
      </Section>
      {collections.length > 0 && (
        <Section
          title="Samples"
          flush
          extra={
            canAct && (
              <Popconfirm
                title={`Mark ${samples.length} sample${samples.length === 1 ? "" : "s"} collected?`}
                description="Recorded as collected now, by you."
                okText="Mark collected"
                disabled={!samples.length}
                onConfirm={collect}
              >
                <Button disabled={!samples.length} loading={collecting}>
                  Record collection
                </Button>
              </Popconfirm>
            )
          }
        >
          <Table<Collection & { item: BillItem }>
            rowKey="id"
            size="middle"
            pagination={false}
            dataSource={collections}
            rowSelection={
              canAct
                ? { selectedRowKeys: samples, onChange: setSamples, getCheckboxProps: (c) => ({ disabled: c.status === "collected" || c.item.status !== "active", "aria-label": `Select ${c.test.code} ${c.label}` }) }
                : undefined
            }
            columns={[
              { title: "Test", render: (_, c) => `${c.test.code} · ${c.test.name}${c.item.code !== c.test.code ? ` (in ${c.item.code})` : ""}` },
              { title: "Sample", dataIndex: "label", ...NOWRAP },
              {
                title: "Status",
                ...NOWRAP,
                render: (_, c) =>
                  c.item.status !== "active" ? <Badge status="default" text="Cancelled" /> : c.status === "collected" ? <Badge status="success" text="Collected" /> : <Badge status="warning" text="Pending" />,
              },
              { title: "Due back", dataIndex: "dueAt", render: formatDateTime, ...NOWRAP },
              { title: "Collected", dataIndex: "collectedAt", render: formatDateTime, ...NOWRAP },
            ]}
          />
        </Section>
      )}
      <Section title="Payments and refunds" flush>
        <Table
          rowKey="id"
          size="middle"
          pagination={false}
          locale={{ emptyText: "Nothing paid yet" }}
          dataSource={[
            ...bill.transactions.map((t) => ({ id: t.id, at: t.createdAt, what: t.kind === "settlement" ? "Panel settlement" : "Payment", amount: t.amountCollected, extra: paise(t.discountAmount) ? `Discount ${formatMoney(t.discountAmount)}` : "", mode: t.mode, by: t.operator.name })),
            ...bill.refunds.map((r) => ({
              id: r.id,
              at: r.createdAt,
              what: "Refund",
              amount: `-${r.amount}`,
              extra: bill.cancellations.find((c) => c.id === r.cancellationId)?.reason ?? "",
              mode: r.mode,
              by: r.createdBy.name,
            })),
          ].sort((a, b) => a.at.localeCompare(b.at))}
          columns={[
            { title: "Date", dataIndex: "at", render: formatDateTime, ...NOWRAP },
            { title: "Kind", dataIndex: "what", ...NOWRAP },
            { title: "Amount", dataIndex: "amount", align: "right", render: formatMoney, ...NOWRAP },
            { title: "Mode", dataIndex: "mode", render: (m: PaymentMode) => MODE_LABELS[m], ...NOWRAP },
            { title: "Note", dataIndex: "extra" },
            { title: "By", dataIndex: "by" },
          ]}
        />
      </Section>
      <Section title="History" flush>
        <Table
          rowKey="id"
          size="middle"
          pagination={false}
          locale={{ emptyText: "No approvals or changes" }}
          dataSource={[
            ...bill.approvals.map((a) => ({
              id: a.id,
              at: a.requestedAt,
              what: `${SUBJECT_LABELS[a.subjectType]}: ${a.subjectType === "bill_discount" ? `${formatMoney(a.payload.from)} → ${formatMoney(a.payload.to)}` : `${a.payload.items.join(", ")}${Number(a.payload.refund) ? `, refund ${formatMoney(a.payload.refund)}` : ""}`}`,
              by: a.requestedBy.name,
              status: <ApprovalStatusBadge approval={a} />,
              note: [a.reviewNote, a.resolveNote].filter(Boolean).join(" · "),
            })),
            ...bill.events.map((e) => ({ id: e.id, at: e.createdAt, what: EVENT_TEXT[e.kind] ?? e.kind, by: e.createdBy.name, status: null, note: "" })),
            ...bill.reassignments.map((r) => ({ id: r.id, at: r.reassignedAt, what: `Reassigned from ${r.fromTechnician.name} to ${r.toTechnician.name}`, by: r.reassignedBy.name, status: null, note: "" })),
          ].sort((a, b) => a.at.localeCompare(b.at))}
          columns={[
            { title: "Date", dataIndex: "at", render: formatDateTime, ...NOWRAP },
            { title: "What", dataIndex: "what" },
            { title: "By", dataIndex: "by" },
            { title: "Approval", dataIndex: "status", ...NOWRAP },
            { title: "Note", dataIndex: "note" },
          ]}
        />
      </Section>

      <FormModal<{ amountCollected: number; mode: PaymentMode; discountAmount?: number }>
        title="Record payment"
        okText="Record payment"
        open={dialog === "payment"}
        initialValues={{ amountCollected: Number(bill.balance), mode: "cash" }}
        onSubmit={(v) => change("/transactions", "POST", "The payment is recorded.")({ billId: bill.id, ...v })}
        onClose={() => setDialog(undefined)}
      >
        <Typography.Paragraph>Balance due: {formatMoney(bill.balance)}</Typography.Paragraph>
        <Form.Item label="Amount" name="amountCollected" rules={[{ required: true, message: "Enter the amount" }]}>
          <InputNumber min={0.01} max={Number(bill.balance)} prefix="₹" style={{ width: "100%" }} />
        </Form.Item>
        <Form.Item label="Mode" name="mode" required>
          <Select options={MODE_OPTIONS} />
        </Form.Item>
        <Form.Item label="Extra discount" name="discountAmount" extra="Reduces the balance; needs a pathologist's approval.">
          <InputNumber min={0} prefix="₹" style={{ width: "100%" }} />
        </Form.Item>
      </FormModal>
      <FormModal<{ discountAmount: number }>
        title="Change discount"
        open={dialog === "discount"}
        initialValues={{ discountAmount: Number(bill.discountAmount) }}
        onSubmit={change(`/bills/${bill.id}/discount`, "PATCH", "The discount is changed.")}
        onClose={() => setDialog(undefined)}
      >
        <Typography.Paragraph>The bill-level discount, up to the subtotal of {formatMoney(bill.originalAmount)}. Any change needs a pathologist's approval.</Typography.Paragraph>
        <Form.Item label="Discount" name="discountAmount" rules={[{ required: true, message: "Enter the discount" }]}>
          <InputNumber min={0} max={Number(bill.originalAmount)} prefix="₹" style={{ width: "100%" }} />
        </Form.Item>
      </FormModal>
      <FormModal<CancelValues>
        title="Cancel tests"
        okText="Cancel tests"
        open={dialog === "cancel"}
        initialValues={{ itemIds: [] }}
        onSubmit={change(`/bills/${bill.id}/cancel-items`, "PATCH", "The cancellation is recorded.")}
        onClose={() => setDialog(undefined)}
      >
        <CancelFields bill={bill} items={active} />
      </FormModal>
      <FormModal<{ expectedReportAt?: Dayjs }>
        title="Report expected by"
        open={dialog === "report"}
        initialValues={{ expectedReportAt: toPicker(bill.expectedReportAt) }}
        onSubmit={(v) => change(`/bills/${bill.id}/expected-report`, "PATCH", "The report time is saved.")({ expectedReportAt: fromPicker(v.expectedReportAt) })}
        onClose={() => setDialog(undefined)}
      >
        <Form.Item label="Report expected by" name="expectedReportAt">
          <DatePicker {...DATE_TIME} style={{ width: "100%" }} />
        </Form.Item>
      </FormModal>
      {isLead && (
        <ReassignModal
          open={dialog === "reassign"}
          current={bill.createdBy.id}
          onSubmit={change(`/bills/${bill.id}/reassign-technician`, "PATCH", "The bill is reassigned.")}
          onClose={() => setDialog(undefined)}
        />
      )}
    </Page>
  );
}

interface CancelValues {
  itemIds: string[];
  reason: string;
  discountAmount?: number;
  refundMode?: PaymentMode;
}

// Which lines to cancel (a profile only whole), why, and the discount that
// remains. If more was collected than the new net amount, the difference is
// refunded (pivot.md §4.10); the server works out the exact figure.
function CancelFields({ bill, items }: { bill: Bill; items: BillItem[] }) {
  const form = Form.useFormInstance<CancelValues>();
  const itemIds = Form.useWatch("itemIds", form) ?? [];
  const discount = Form.useWatch("discountAmount", form);
  const remaining = items.filter((i) => !itemIds.includes(i.id)).reduce((sum, i) => sum + paise(i.price), 0);
  const defaultDiscount = Math.min(paise(bill.discountAmount), remaining);
  const collected = paise(bill.netAmount) - paise(bill.balance);
  const refund = Math.max(0, collected - (remaining - (discount === undefined || discount === null ? defaultDiscount : paise(discount))));

  return (
    <>
      <Form.Item label="Items to cancel" name="itemIds" rules={[{ required: true, message: "Choose the items to cancel" }]}>
        <ItemChecks items={items} />
      </Form.Item>
      <Form.Item label="Reason" name="reason" rules={[{ required: true, whitespace: true, message: "Give the reason" }]}>
        <Input.TextArea autoSize={{ minRows: 2 }} />
      </Form.Item>
      <Form.Item label="Discount after cancelling" name="discountAmount" extra={`Leave empty to keep ${formatMoney(defaultDiscount / 100)}. A change needs approval.`}>
        <InputNumber min={0} max={remaining / 100} prefix="₹" style={{ width: "100%" }} />
      </Form.Item>
      {refund > 0 && (
        <>
          <Alert type="info" showIcon title={`About ${formatMoney(refund / 100)} is refunded to the patient.`} style={{ marginBottom: 16 }} />
          <Form.Item label="Refund mode" name="refundMode" rules={[{ required: true, message: "Choose how it's refunded" }]}>
            <Select options={MODE_OPTIONS} />
          </Form.Item>
        </>
      )}
      <Typography.Text type="secondary">The bill's report is held until a pathologist approves the cancellation.</Typography.Text>
    </>
  );
}

// The bill's active lines as checkboxes. Form.Item's aria-required isn't
// passed on: it isn't valid on a group of checkboxes.
function ItemChecks({ items, value, onChange }: { items: BillItem[]; value?: string[]; onChange?(value: string[]): void }) {
  return (
    <Checkbox.Group value={value} onChange={onChange} style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      {items.map((i) => (
        <Checkbox key={i.id} value={i.id} disabled={i.processingStatus !== "not_started"}>
          {i.code} · {i.name} · {formatMoney(i.price)}
          {i.processingStatus !== "not_started" && " (processing has started)"}
        </Checkbox>
      ))}
    </Checkbox.Group>
  );
}

function ReassignModal({ open, current, onSubmit, onClose }: { open: boolean; current: string; onSubmit(body: object): Promise<void>; onClose(): void }) {
  const users = useApi<{ users: User[] }>(open ? "/users/reception" : null);
  return (
    <FormModal<{ technicianId: string }> title="Reassign bill" okText="Reassign" open={open} onSubmit={onSubmit} onClose={onClose}>
      <Typography.Paragraph>Moves the bill to another person's day sheet and analytics. Payments stay with whoever took them.</Typography.Paragraph>
      <Form.Item label="Assign to" name="technicianId" rules={[{ required: true, message: "Choose who" }]}>
        <Select showSearch={{ optionFilterProp: "label" }} options={users.data?.users.filter((u) => u.id !== current).map((u) => ({ value: u.id, label: u.name }))} />
      </Form.Item>
    </FormModal>
  );
}

