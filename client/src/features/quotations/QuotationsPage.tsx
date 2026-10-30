import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Badge, Button, Input, Segmented, Table } from "antd";
import { useSession } from "../../auth/session";
import { useApi } from "../../lib/hooks";
import { formatDateTime, formatMoney } from "../../lib/format";
import Page, { NOWRAP, Section } from "../../components/Page";
import type { QuotationStatus, QuotationSummary } from "../../types/api";

type Shown = QuotationStatus | "expired";

const STATUS: Record<Shown, { status: "processing" | "success" | "default" | "warning"; text: string }> = {
  open: { status: "processing", text: "Valid" },
  expired: { status: "warning", text: "Expired" },
  converted: { status: "success", text: "Billed" },
  cancelled: { status: "default", text: "Cancelled" },
};

// "Expired" is an open quote past its 48 h (pivot.md §4.9).
export function QuoteStatusBadge({ quote }: { quote: { status: QuotationStatus; expired?: boolean; validUntil?: string } }) {
  const expired = quote.expired ?? (quote.status === "open" && !!quote.validUntil && new Date(quote.validUntil) < new Date());
  return <Badge {...STATUS[expired ? "expired" : quote.status]} />;
}

// Quotations, newest first: search by number, name or phone; filter by status.
export default function QuotationsPage() {
  const navigate = useNavigate();
  const { user } = useSession();
  const canAct = user!.role !== "accountant";
  const [q, setQ] = useState("");
  const [status, setStatus] = useState<Shown | "">("");
  const quotes = useApi<{ quotations: QuotationSummary[] }>(`/quotations?q=${encodeURIComponent(q)}&status=${status}`);

  return (
    <Page
      title="Quotations"
      description="Price quotes, valid for 48 hours. A quote becomes a bill when the patient goes ahead."
      actions={<Button type="primary" onClick={() => navigate("/quotations/new")}>New quotation</Button>}
    >
      <Section
        flush
        toolbar={
          <>
            <Input.Search aria-label="Search quotations" placeholder="Quotation no., name or phone" allowClear enterButton onSearch={(v) => setQ(v.trim())} style={{ maxWidth: 420 }} />
            <Segmented<Shown | "">
              value={status}
              onChange={setStatus}
              options={[{ value: "", label: "All" }, ...Object.entries(STATUS).map(([value, s]) => ({ value: value as Shown, label: s.text }))]}
            />
          </>
        }
      >
        <Table<QuotationSummary>
          rowKey="id"
          size="middle"
          loading={!quotes.data && !quotes.error}
          dataSource={quotes.data?.quotations}
          pagination={{ pageSize: 25, hideOnSinglePage: true, showSizeChanger: false }}
          columns={[
            { title: "Quotation no.", dataIndex: "quoteNumber", ...NOWRAP, render: (n, quote) => <Link to={`/quotations/${quote.id}`}>{n}</Link> },
            { title: "Issued", dataIndex: "issuedAt", render: formatDateTime, ...NOWRAP },
            { title: "Patient", render: (_, quote) => quote.patientName },
            { title: "Phone", dataIndex: "patientPhone", render: (v) => v ?? "—", ...NOWRAP },
            { title: "Location", render: (_, quote) => quote.location.name },
            { title: "Net", dataIndex: "netAmount", align: "right", render: formatMoney, ...NOWRAP },
            { title: "Valid until", dataIndex: "validUntil", render: formatDateTime, ...NOWRAP },
            {
              title: "Status",
              ...NOWRAP,
              render: (_, quote) => (
                <>
                  <QuoteStatusBadge quote={quote} />
                  {quote.bill && <> · <Link to={`/bills/${quote.bill.id}`}>{quote.bill.billNumber}</Link></>}
                </>
              ),
            },
            ...(canAct
              ? [
                  {
                    title: "Actions",
                    ...NOWRAP,
                    render: (_: unknown, quote: QuotationSummary) =>
                      quote.convertible && (
                        <Button type="link" size="small" onClick={() => navigate(`/bills/new?quotation=${quote.id}`)}>
                          Convert to bill
                        </Button>
                      ),
                  },
                ]
              : []),
          ]}
        />
      </Section>
    </Page>
  );
}
