import { Link, useNavigate, useParams } from "react-router-dom";
import { Alert, App, Button, Descriptions, Flex, Popconfirm, Table, Tag, Typography } from "antd";
import { api } from "../../api";
import { useSession } from "../../auth/session";
import { useAction, useApi } from "../../lib/hooks";
import { formatDateTime, formatMoney, KIND_LABELS } from "../../lib/format";
import Page, { Figures, NOWRAP, Section } from "../../components/Page";
import type { Quotation } from "../../types/api";
import { payerText } from "../billing/BillsPage";
import { QuoteStatusBadge } from "./QuotationsPage";

// One quotation (pivot.md §6.4): print it, convert it into a bill, re-issue
// it once expired (new number, today's prices, a fresh 48 h), or cancel it.
export default function QuotationDetailPage() {
  const { id } = useParams();
  const { user } = useSession();
  const { message } = App.useApp();
  const navigate = useNavigate();
  const data = useApi<{ quotation: Quotation }>(`/quotations/${id}`);
  const canAct = user!.role !== "accountant";

  const [reissue, reissuing] = useAction(async () => {
    const { quotation } = await api<{ quotation: Quotation }>(`/quotations/${id}/reissue`, { method: "POST" });
    message.success(`Re-issued as ${quotation.quoteNumber}.`);
    navigate(`/print/quotation/${quotation.id}?back=1`);
  });
  const [cancel] = useAction(async () => {
    await api(`/quotations/${id}/cancel`, { method: "POST" });
    message.success("The quotation is cancelled.");
    await data.reload();
  });

  if (!data.data) return null;
  const { quotation: q } = data.data;
  const open = q.status === "open";
  const canReissue = open && q.expired && !q.reissuedAs;

  return (
    <Page
      title={`Quotation ${q.quoteNumber}`}
      description={`${formatDateTime(q.issuedAt)} · ${q.location.name} · ${q.createdBy.name}`}
      actions={
        <>
          <Button onClick={() => window.open(`/print/quotation/${q.id}`, "_blank")}>Print</Button>
          {canAct && open && (
            <Popconfirm title="Cancel this quotation?" okText="Cancel quotation" cancelText="Keep it" onConfirm={cancel}>
              <Button danger>Cancel quotation</Button>
            </Popconfirm>
          )}
          {canAct && canReissue && (
            <Button loading={reissuing} type={q.conversion.allowed ? "default" : "primary"} onClick={reissue}>
              Re-issue
            </Button>
          )}
          {canAct && q.conversion.allowed && (
            <Button type="primary" onClick={() => navigate(`/bills/new?quotation=${q.id}`)}>
              Convert to bill
            </Button>
          )}
        </>
      }
    >
      {open && !q.conversion.allowed && <Alert type="warning" showIcon title={q.conversion.reason} />}
      {open && q.expired && q.conversion.allowed && <Alert type="info" showIcon title="This quotation has expired, but every price is unchanged, so it can still become a bill." />}
      <Section title="Summary">
        <Flex vertical gap={16}>
          <Descriptions
            column={{ xs: 1, md: 2, xl: 3 }}
            items={[
              { label: "Patient", children: q.patient ? <Link to={`/patients/${q.patient.id}`}>{q.patientName}</Link> : q.patientName },
              { label: "Phone", children: q.patientPhone ?? "—" },
              { label: "Status", children: <QuoteStatusBadge quote={q} /> },
              { label: "Valid until", children: formatDateTime(q.validUntil) },
              { label: "Referral", children: q.referralType === "walk_in" ? "Walk-in" : `Doctor${q.referringDoctor ? `: ${q.referringDoctor.name}` : ""}` },
              { label: "Payer", children: `${payerText(q)}${q.camp ? ` · camp ${q.camp.name}` : ""}` },
              { label: "Collection", children: q.collectionMode === "home_visit" ? "Home visit" : "At the location" },
              ...(q.bill ? [{ label: "Bill", children: <Link to={`/bills/${q.bill.id}`}>{q.bill.billNumber}</Link> }] : []),
              ...(q.reissuedFrom ? [{ label: "Re-issue of", children: <Link to={`/quotations/${q.reissuedFrom.id}`}>{q.reissuedFrom.quoteNumber}</Link> }] : []),
              ...(q.reissuedAs ? [{ label: "Re-issued as", children: <Link to={`/quotations/${q.reissuedAs.id}`}>{q.reissuedAs.quoteNumber}</Link> }] : []),
              { label: "Verification code", children: q.verificationCode },
            ]}
          />
          <Figures
            items={[
              { label: "Subtotal", value: formatMoney(q.originalAmount) },
              { label: "Discount (proposed)", value: formatMoney(q.discountAmount) },
              { label: "Net amount", value: formatMoney(q.netAmount), strong: true },
            ]}
          />
        </Flex>
      </Section>
      <Section title="Items" flush>
        <Table
          rowKey="id"
          size="middle"
          pagination={false}
          dataSource={q.items}
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
            { title: "Kind", dataIndex: "kind", render: (k: keyof typeof KIND_LABELS) => <Tag>{KIND_LABELS[k]}</Tag>, ...NOWRAP },
            { title: "Quoted price", dataIndex: "price", align: "right", render: formatMoney, ...NOWRAP },
          ]}
        />
      </Section>
    </Page>
  );
}
