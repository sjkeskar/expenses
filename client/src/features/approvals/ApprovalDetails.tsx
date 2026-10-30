import { Badge, Flex, Typography } from "antd";
import { Link } from "react-router-dom";
import { formatDate, formatMoney, KIND_LABELS, PATIENT_FIELD_LABELS, SEX_LABELS } from "../../lib/format";
import type { Approval, ApprovalStatus, CatalogItem, CatalogValues, Sex } from "../../types/api";
import { stepsText } from "../catalog/steps";

export const STATUS_BADGE: Record<ApprovalStatus, { status: "warning" | "success" | "error" | "default"; text: string }> = {
  pending: { status: "warning", text: "Pending" },
  approved: { status: "success", text: "Approved" },
  rejected: { status: "error", text: "Rejected" },
  resolved: { status: "default", text: "Rejected, resolved" },
};

export function ApprovalStatusBadge({ approval }: { approval: Approval }) {
  const { status, text } = STATUS_BADGE[approval.status];
  return <Badge status={status} text={approval.selfApproved ? "Approved (own)" : text} />;
}

// What rejecting each kind of request does (pivot.md §4.2), shown before it's done.
export const REJECT_EFFECT: Record<Approval["subjectType"], string> = {
  bill_discount: "The discount is reverted: the patient owes the full amount, and the report stays on hold until it's paid.",
  bill_cancellation: "The refund has been given, so the report stays on hold until the lead marks the matter resolved.",
  referring_doctor: "The doctor is removed from every bill and open quotation naming them.",
  catalog_change: "Nothing changes in the catalog.",
  patient_correction: "The patient's details stay as they are.",
};

const Change = ({ label, from, to }: { label: string; from?: string; to: string }) => (
  <Typography.Text>
    {label}: {from !== undefined && <><Typography.Text delete type="secondary">{from || "—"}</Typography.Text> → </>}
    {to || "—"}
  </Typography.Text>
);

type Fields = Record<string, string>;

// A catalog item's values as the reviewer reads them, from a proposal…
function proposedFields(v: CatalogValues, names: Record<string, string>): Fields {
  const steps = (v.machineSteps ?? []).map((s) => ({ sequence: s.sequence, machineType: { id: s.machineTypeId, name: names[s.machineTypeId] ?? "?" } }));
  return {
    Name: v.name,
    Kind: KIND_LABELS[v.kind],
    Price: formatMoney(v.price),
    Department: v.department ?? "",
    "Sample type": v.sampleType ?? "",
    Container: v.container ?? "",
    Draws: (v.draws ?? []).join(", "),
    Machines: stepsText(steps.map((s, i) => ({ id: String(i), ...s }))),
    Tests: (v.components ?? []).map((id) => names[id] ?? "?").sort().join(", "),
    Instructions: v.instructions ?? "",
  };
}

// …and from the item as it stands.
function currentFields(item: CatalogItem): Fields {
  return proposedFields(
    {
      ...item,
      draws: item.draws.map((d) => d.label),
      machineSteps: item.machineSteps.map((s) => ({ sequence: s.sequence, machineTypeId: s.machineType.id })),
      components: item.components.map((c) => c.test.id),
    },
    Object.fromEntries([...item.machineSteps.map((s) => [s.machineType.id, s.machineType.name]), ...item.components.map((c) => [c.test.id, c.test.code])])
  );
}

const patientValue = (field: string, value: unknown) =>
  field === "sex" ? SEX_LABELS[value as Sex] : field === "dateOfBirth" ? formatDate(String(value)) : field === "dobIsApproximate" ? (value ? "Yes" : "No") : String(value);

// The request itself, old and new values side by side (pivot.md §6.2).
export default function ApprovalDetails({ approval: a, names }: { approval: Approval; names: Record<string, string> }) {
  const bill = a.bill && (
    <Typography.Text>
      Bill <Link to={`/bills/${a.bill.id}`}>{a.bill.billNumber}</Link> · {a.bill.patient.name}
    </Typography.Text>
  );

  switch (a.subjectType) {
    case "bill_discount":
      return (
        <Flex vertical>
          {bill}
          <Change label="Discount" from={formatMoney(a.payload.from)} to={formatMoney(a.payload.to)} />
        </Flex>
      );
    case "bill_cancellation":
      return (
        <Flex vertical>
          {bill}
          <Typography.Text>
            Cancelled {a.payload.items.join(", ")}
            {Number(a.payload.refund) > 0 && `, refunded ${formatMoney(a.payload.refund)}`}
          </Typography.Text>
          {a.subject?.reason && <Typography.Text type="secondary">Reason: {a.subject.reason}</Typography.Text>}
        </Flex>
      );
    case "referring_doctor":
      return (
        <Flex vertical>
          <Typography.Text>{a.subject?.name}</Typography.Text>
          <Typography.Text type="secondary">{[a.subject?.clinic, a.subject?.phone].filter(Boolean).join(" · ") || "No clinic or phone given"}</Typography.Text>
        </Flex>
      );
    case "patient_correction": {
      const changed = Object.keys(PATIENT_FIELD_LABELS).filter((f) => a.payload.from[f] !== a.payload.to[f]);
      return (
        <Flex vertical>
          {a.subject && (
            <Typography.Text>
              <Link to={`/patients/${a.subject.id}`}>{a.subject.name}</Link> · {a.subject.patientNumber}
            </Typography.Text>
          )}
          {changed.map((f) => (
            <Change key={f} label={PATIENT_FIELD_LABELS[f]} from={patientValue(f, a.payload.from[f])} to={patientValue(f, a.payload.to[f])} />
          ))}
        </Flex>
      );
    }
    case "catalog_change": {
      const { action, values } = a.payload as { action: "create" | "update" | "retire"; values?: CatalogValues };
      const item = a.subject as CatalogItem | null;
      if (action === "retire") return <Typography.Text>Retire {item ? `${item.code} · ${item.name}` : "an item"}</Typography.Text>;
      const next = proposedFields(values!, names);
      const before = action === "update" && item ? currentFields(item) : null;
      const shown = Object.keys(next).filter((k) => (before ? before[k] !== next[k] : next[k] && k !== "Name"));
      return (
        <Flex vertical>
          <Typography.Text>
            {action === "create" ? "Add" : "Edit"} {values!.code} · {values!.name}
          </Typography.Text>
          {shown.map((k) => (
            <Change key={k} label={k} from={before?.[k]} to={next[k]} />
          ))}
          {before && shown.length === 0 && <Typography.Text type="secondary">No changes</Typography.Text>}
        </Flex>
      );
    }
  }
}
