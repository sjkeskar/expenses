import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { Alert, App, Badge, Button, Descriptions, Table } from "antd";
import { api } from "../../api";
import { useSession } from "../../auth/session";
import { useApi } from "../../lib/hooks";
import { BILL_STATUS, formatDate, formatDateTime, formatMoney, PATIENT_FIELD_LABELS, SEX_LABELS } from "../../lib/format";
import FormModal from "../../components/FormModal";
import Page, { NOWRAP, Section } from "../../components/Page";
import type { Approval, PatientDetail } from "../../types/api";
import { PatientFields, toBody, valuesOf, type PatientValues } from "./PatientFields";
import { QuoteStatusBadge } from "../quotations/QuotationsPage";

const APPROVERS = ["pathologist", "lead_pathologist"];

// One patient (pivot.md §6.11): their details, bills and quotations, and
// corrections to the mandatory fields — a technician's wait for a
// pathologist's approval, one at a time; a pathologist's or the lead's
// apply at once, re-deriving the patient number (the old one still finds them).
export default function PatientDetailPage() {
  const { id } = useParams();
  const { user } = useSession();
  const { message } = App.useApp();
  const navigate = useNavigate();
  const data = useApi<{ patient: PatientDetail; pendingCorrection: Approval | null }>(`/patients/${id}`);
  const [correcting, setCorrecting] = useState(false);
  const approver = APPROVERS.includes(user!.role);
  const canAct = user!.role !== "accountant";

  if (!data.data) return null;
  const { patient, pendingCorrection } = data.data;

  const correct = async (values: PatientValues) => {
    await api(`/patients/${patient.id}/corrections`, { method: "POST", body: toBody(values) });
    message.success(approver ? "The details are corrected." : "The correction is sent for a pathologist's approval.");
    await data.reload();
  };

  return (
    <Page
      title={patient.name}
      description={`Patient no. ${patient.patientNumber}`}
      actions={
        canAct && (
          <>
            <Button disabled={!!pendingCorrection} onClick={() => setCorrecting(true)}>
              {approver ? "Correct details" : "Propose a correction"}
            </Button>
            <Button onClick={() => navigate(`/quotations/new?patient=${patient.id}`)}>New quotation</Button>
            <Button type="primary" onClick={() => navigate(`/bills/new?patient=${patient.id}`)}>
              New bill
            </Button>
          </>
        )
      }
    >
      {pendingCorrection && (
        <Alert
          type="warning"
          showIcon
          title="A correction is waiting for a pathologist's approval"
          description={Object.keys(PATIENT_FIELD_LABELS)
            .filter((f) => pendingCorrection.payload.from[f] !== pendingCorrection.payload.to[f])
            .map((f) => `${PATIENT_FIELD_LABELS[f]}: ${pendingCorrection.payload.to[f]}`)
            .join(" · ")}
        />
      )}
      <Section title="Details">
        <Descriptions
          column={{ xs: 1, md: 2, xl: 3 }}
          items={[
            { label: "Patient no.", children: patient.patientNumber },
            { label: "Name", children: patient.name },
            { label: "Age", children: `${patient.age} years${patient.dobIsApproximate ? " (from the age given)" : ""}` },
            { label: "Date of birth", children: patient.dobIsApproximate ? "Not known" : formatDate(patient.dateOfBirth.slice(0, 10)) },
            { label: "Sex", children: SEX_LABELS[patient.sex] },
            { label: "Phone", children: patient.phone },
            { label: "Registered", children: formatDateTime(patient.createdAt) },
            ...(patient.aliases.length ? [{ label: "Old numbers", children: patient.aliases.map((a) => a.number).join(", ") }] : []),
          ]}
        />
      </Section>
      <Section title="Bills" flush>
        <Table
          rowKey="id"
          size="middle"
          pagination={false}
          dataSource={patient.bills}
          locale={{ emptyText: "No bills yet" }}
          columns={[
            { title: "Bill no.", dataIndex: "billNumber", ...NOWRAP, render: (n, b) => <Link to={`/bills/${b.id}`}>{n}</Link> },
            { title: "Date", dataIndex: "createdAt", render: formatDateTime, ...NOWRAP },
            { title: "Net", dataIndex: "netAmount", align: "right", render: formatMoney, ...NOWRAP },
            { title: "Balance", dataIndex: "balance", align: "right", render: formatMoney, ...NOWRAP },
            { title: "Status", dataIndex: "status", render: (s: keyof typeof BILL_STATUS) => <Badge {...BILL_STATUS[s]} />, ...NOWRAP },
          ]}
        />
      </Section>
      <Section title="Quotations" flush>
        <Table
          rowKey="id"
          size="middle"
          pagination={false}
          dataSource={patient.quotations}
          locale={{ emptyText: "No quotations" }}
          columns={[
            { title: "Quotation no.", dataIndex: "quoteNumber", ...NOWRAP, render: (n, q) => <Link to={`/quotations/${q.id}`}>{n}</Link> },
            { title: "Issued", dataIndex: "issuedAt", render: formatDateTime, ...NOWRAP },
            { title: "Net", dataIndex: "netAmount", align: "right", render: formatMoney, ...NOWRAP },
            { title: "Status", render: (_, q) => <QuoteStatusBadge quote={q} />, ...NOWRAP },
          ]}
        />
      </Section>
      {patient.changes.length > 0 && (
        <Section title="Corrections" flush>
          <Table
            rowKey="id"
            size="middle"
            pagination={false}
            dataSource={patient.changes}
            columns={[
              { title: "Date", dataIndex: "changedAt", render: formatDateTime, ...NOWRAP },
              { title: "Field", dataIndex: "field", render: (f) => PATIENT_FIELD_LABELS[f] ?? f },
              { title: "Was", dataIndex: "oldValue" },
              { title: "Now", dataIndex: "newValue" },
            ]}
          />
        </Section>
      )}

      <FormModal<PatientValues>
        title={approver ? "Correct details" : "Propose a correction"}
        okText={approver ? "Save correction" : "Send for approval"}
        open={correcting}
        initialValues={valuesOf(patient)}
        onSubmit={correct}
        onClose={() => setCorrecting(false)}
      >
        {!approver && <Alert type="info" title="Nothing changes until a pathologist approves the correction." style={{ marginBottom: 16 }} />}
        <PatientFields />
      </FormModal>
    </Page>
  );
}
