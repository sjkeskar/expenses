import { useState } from "react";
import { Link } from "react-router-dom";
import { Alert, Descriptions, Input, Result } from "antd";
import { api } from "../../api";
import { useAction } from "../../lib/hooks";
import { BILL_STATUS, formatDate, formatDateTime, formatMoney } from "../../lib/format";
import Page, { Section } from "../../components/Page";
import type { BillStatus, VerifiedDocument } from "../../types/api";

const QUOTE_STATUS: Record<string, string> = { open: "Valid", expired: "Expired", converted: "Billed", cancelled: "Cancelled" };

// Verify a document (pivot.md §6.9): scan the barcode on a quotation or bill
// (the scanner types the code and presses Enter) to see the record the lab
// holds. A forged or altered printout won't match it.
export default function VerifyPage() {
  const [document, setDocument] = useState<VerifiedDocument>();
  const [notFound, setNotFound] = useState<string>();
  const [verify, busy] = useAction(async (code: string) => {
    setDocument(undefined);
    setNotFound(undefined);
    if (!code.trim()) return;
    try {
      setDocument((await api<{ document: VerifiedDocument }>(`/verify/${encodeURIComponent(code.trim())}`)).document);
    } catch (e) {
      setNotFound((e as Error).message);
    }
  });

  return (
    <Page title="Verify document" description="Scan the barcode on a quotation or bill, or type the code printed under it.">
      <Section>
        <Input.Search aria-label="Verification code" placeholder="Verification code" enterButton="Verify" size="large" autoFocus loading={busy} onSearch={verify} style={{ maxWidth: 480 }} />
      </Section>
      {notFound && <Result status="warning" title="Not a document from this lab" subTitle={notFound} />}
      {document && (
        <Section title={`${document.type === "bill" ? "Bill" : "Quotation"} ${document.number}`}>
          {document.patientCorrectedAt && (
            <Alert
              type="info"
              showIcon
              style={{ marginBottom: 16 }}
              title={`The patient's details were corrected on ${formatDate(document.patientCorrectedAt)}, after this was printed. An older printout may show the old details.`}
            />
          )}
          <Descriptions
            column={{ xs: 1, md: 2 }}
            items={[
              { label: "Issued", children: formatDateTime(document.issuedAt) },
              { label: "At", children: document.location.name },
              { label: "Patient", children: document.patient.id ? <Link to={`/patients/${document.patient.id}`}>{document.patient.name}</Link> : document.patient.name },
              ...(document.patient.patientNumber ? [{ label: "Patient no.", children: document.patient.patientNumber }] : []),
              { label: "Net amount", children: formatMoney(document.netAmount) },
              ...(document.type === "bill"
                ? [
                    { label: "Balance", children: formatMoney(document.balance!) },
                    { label: "Status", children: BILL_STATUS[document.status as BillStatus].text },
                  ]
                : [
                    { label: "Valid until", children: formatDateTime(document.validUntil) },
                    { label: "Status", children: QUOTE_STATUS[document.status] },
                  ]),
              { label: "Record", children: <Link to={`/${document.type === "bill" ? "bills" : "quotations"}/${document.id}`}>Open</Link> },
            ]}
          />
        </Section>
      )}
    </Page>
  );
}
