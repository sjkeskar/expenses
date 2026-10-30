import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Badge, Button, Flex, Input, Segmented, Table, Tooltip } from "antd";
import { useSession } from "../../auth/session";
import { useApi } from "../../lib/hooks";
import { ageSex, BILL_STATUS, formatDateTime, formatMoney } from "../../lib/format";
import Page, { NOWRAP, Section } from "../../components/Page";
import type { BillStatus, BillSummary } from "../../types/api";

// "Report on hold", with the reasons on hover (pivot.md §4.2).
export function HoldBadge({ holds }: { holds: string[] }) {
  return holds.length ? (
    <Tooltip title={holds.join("; ")}>
      <Badge status="warning" text="Report on hold" />
    </Tooltip>
  ) : null;
}

export const payerText = (b: Pick<BillSummary, "payerType" | "panel">) => (b.payerType === "panel" ? (b.panel?.name ?? "Panel") : "Self");

// Bills, newest first: search by bill number or the patient's name, phone
// or patient number; filter by status.
export default function BillsPage() {
  const { user } = useSession();
  const navigate = useNavigate();
  const [q, setQ] = useState("");
  const [status, setStatus] = useState<BillStatus | "">("");
  const bills = useApi<{ bills: BillSummary[] }>(`/bills?q=${encodeURIComponent(q)}&status=${status}`);

  return (
    <Page
      title="Bills"
      description="The latest 100 bills; search to find older ones."
      actions={user!.role !== "accountant" && <Button type="primary" onClick={() => navigate("/bills/new")}>New bill</Button>}
    >
      <Section
        flush
        toolbar={
          <>
            <Input.Search aria-label="Search bills" placeholder="Bill no., patient name, phone or number" allowClear enterButton onSearch={(v) => setQ(v.trim())} style={{ maxWidth: 420 }} />
            <Segmented<BillStatus | "">
              value={status}
              onChange={setStatus}
              options={[{ value: "", label: "All" }, ...Object.entries(BILL_STATUS).map(([value, s]) => ({ value: value as BillStatus, label: s.text }))]}
            />
          </>
        }
      >
        <Table<BillSummary>
          rowKey="id"
          size="middle"
          loading={!bills.data && !bills.error}
          dataSource={bills.data?.bills}
          pagination={{ pageSize: 25, hideOnSinglePage: true, showSizeChanger: false }}
          columns={[
            { title: "Bill no.", dataIndex: "billNumber", ...NOWRAP, render: (n, b) => <Link to={`/bills/${b.id}`}>{n}</Link> },
            { title: "Date", dataIndex: "createdAt", render: formatDateTime, ...NOWRAP },
            { title: "Patient", render: (_, b) => `${b.patient.name} · ${ageSex(b.patientAge, b.patient.sex)}` },
            { title: "Location", render: (_, b) => b.location.name },
            { title: "Payer", render: (_, b) => payerText(b) },
            { title: "Net", dataIndex: "netAmount", align: "right", render: formatMoney, ...NOWRAP },
            { title: "Balance", dataIndex: "balance", align: "right", render: formatMoney, ...NOWRAP },
            {
              title: "Status",
              ...NOWRAP,
              render: (_, b) => (
                <Flex vertical>
                  <Badge {...BILL_STATUS[b.status]} />
                  <HoldBadge holds={b.holds} />
                </Flex>
              ),
            },
          ]}
        />
      </Section>
    </Page>
  );
}
