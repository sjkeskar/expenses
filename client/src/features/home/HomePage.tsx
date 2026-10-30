import { Link } from "react-router-dom";
import { Alert, Table } from "antd";
import { useSession } from "../../auth/session";
import { useShell } from "../../layout/AppShell";
import { useApi } from "../../lib/hooks";
import { formatDateTime, formatMoney, istToday, ROLE_LABELS } from "../../lib/format";
import { PAGES } from "../../pages";
import Page, { Figures, NOWRAP, Section } from "../../components/Page";
import type { ApprovalList, DaySheet, Revisit, Role } from "../../types/api";
import { dueBadge } from "../revisits/RevisitsPage";

const RECEPTION: Role[] = ["technician", "pathologist", "lead_pathologist"];
const APPROVERS: Role[] = ["pathologist", "lead_pathologist"];

// Home. For reception work it's the front desk's day at a glance: who is
// due back for samples, the money taken, and requests waiting (the quick
// access bar in the header starts bills, quotations and registrations).
// For everyone else, the screens they can open.
export default function HomePage() {
  const { user } = useSession();
  const { settings } = useShell();
  const reception = RECEPTION.includes(user!.role);

  return (
    <Page title={`Welcome, ${user!.name}`} description={`Signed in as ${ROLE_LABELS[user!.role]}${settings ? ` at ${settings.labName}` : ""}.`}>
      {user!.role === "developer" && settings === null && (
        <Alert
          type="warning"
          showIcon
          title={
            <>
              The lab hasn't been set up yet: start with <Link to="/setup">Lab setup</Link>.
            </>
          }
        />
      )}
      {reception ? <FrontDesk role={user!.role} /> : <Screens role={user!.role} />}
    </Page>
  );
}

function FrontDesk({ role }: { role: Role }) {
  const today = istToday();
  const revisits = useApi<{ collections: Revisit[] }>(`/bills/revisits?until=${today}`);
  const sheet = useApi<DaySheet>(`/daysheet?date=${today}`);
  const mine = useApi<ApprovalList>("/approvals/mine");
  const queue = useApi<ApprovalList>(APPROVERS.includes(role) ? "/approvals" : null);
  const due = revisits.data?.collections;
  const count = (n: number | undefined, to: string) => (n === undefined ? "—" : <Link to={to}>{n}</Link>);

  return (
    <>
      <Section title="Today">
        <Figures
          items={[
            { label: "Due back for samples", value: count(due?.length, "/revisits") },
            { label: "You've taken", value: sheet.data ? <Link to="/daysheet">{formatMoney(sheet.data.totals.total)}</Link> : "—" },
            { label: "Your requests waiting", value: count(mine.data?.approvals.filter((a) => a.status === "pending").length, "/requests") },
            ...(APPROVERS.includes(role)
              ? [{ label: "Waiting for your approval", value: count(queue.data?.approvals.filter((a) => a.status === "pending").length, "/approvals"), strong: true }]
              : []),
          ]}
        />
      </Section>
      <Section title="Due back for samples" flush extra={<Link to="/revisits">All revisits</Link>}>
        <Table<Revisit>
          rowKey="id"
          size="middle"
          pagination={false}
          loading={!revisits.data && !revisits.error}
          dataSource={due?.slice(0, 10)}
          locale={{ emptyText: "No one is due back today." }}
          columns={[
            { title: "Due", dataIndex: "dueAt", render: formatDateTime, ...NOWRAP },
            { title: "", dataIndex: "dueAt", render: dueBadge, ...NOWRAP },
            { title: "Patient", render: (_, r) => r.billItem.bill.patient.name },
            { title: "Phone", render: (_, r) => r.billItem.bill.patient.phone, ...NOWRAP },
            { title: "Sample", render: (_, r) => `${r.test.code} · ${r.label}` },
            {
              title: "Bill no.",
              ...NOWRAP,
              render: (_, r) => <Link to={`/bills/${r.billItem.bill.id}`}>{r.billItem.bill.billNumber}</Link>,
            },
          ]}
        />
      </Section>
    </>
  );
}

function Screens({ role }: { role: Role }) {
  const pages = PAGES.filter((p) => p.path !== "/" && p.menu !== false && p.roles.includes(role));
  if (!pages.length) return null;
  return (
    <Section title="Your screens" flush>
      <Table
        rowKey="path"
        size="middle"
        pagination={false}
        dataSource={pages}
        columns={[
          {
            title: "Screen",
            render: (_, p) => (
              <Link to={p.path}>
                {p.icon} {p.label}
              </Link>
            ),
          },
          { title: "Area", dataIndex: "group", render: (g) => g ?? "" },
        ]}
      />
    </Section>
  );
}
