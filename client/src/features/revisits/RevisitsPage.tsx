import { useState } from "react";
import { Link } from "react-router-dom";
import { App, Badge, Button, Popconfirm, Segmented, Table } from "antd";
import { api } from "../../api";
import { useAction, useApi } from "../../lib/hooks";
import { formatDateTime, istDay, istToday } from "../../lib/format";
import Page, { NOWRAP, Section } from "../../components/Page";
import type { Revisit } from "../../types/api";

// When a pending sample is due: overdue, today, or later.
export function dueBadge(dueAt: string) {
  if (new Date(dueAt) < new Date()) return <Badge status="error" text="Overdue" />;
  return istDay(dueAt) === istToday() ? <Badge status="warning" text="Today" /> : <Badge status="default" text="Later" />;
}

// Patients due back for samples (pivot.md §6.6), soonest first; a confirmed
// click records a collection.
export default function RevisitsPage() {
  const { message } = App.useApp();
  const [scope, setScope] = useState<"today" | "all">("today");
  const until = scope === "today" ? istToday() : "";
  const revisits = useApi<{ collections: Revisit[] }>(`/bills/revisits?until=${until}`);
  const [collect] = useAction(async (r: Revisit) => {
    await api(`/bills/${r.billItem.bill.id}/samples`, { method: "PATCH", body: { collectionIds: [r.id] } });
    message.success(`${r.test.code} (${r.label}) is collected for ${r.billItem.bill.patient.name}.`);
    await revisits.reload();
  });

  return (
    <Page
      title="Sample revisits"
      description="Patients coming back for samples that weren't taken at billing."
      actions={<Button onClick={() => window.open(`/print/revisits?until=${until}`, "_blank")}>Print list</Button>}
    >
      <Section
        flush
        toolbar={
          <Segmented
            value={scope}
            onChange={setScope}
            options={[
              { value: "today", label: "Due by today" },
              { value: "all", label: "All pending" },
            ]}
          />
        }
      >
        <Table<Revisit>
          rowKey="id"
          size="middle"
          pagination={false}
          loading={!revisits.data && !revisits.error}
          dataSource={revisits.data?.collections}
          locale={{ emptyText: "No one is due back." }}
          columns={[
            { title: "Due", dataIndex: "dueAt", render: formatDateTime, ...NOWRAP },
            { title: "", dataIndex: "dueAt", render: dueBadge, ...NOWRAP },
            { title: "Patient", render: (_, r) => r.billItem.bill.patient.name },
            { title: "Phone", render: (_, r) => r.billItem.bill.patient.phone, ...NOWRAP },
            { title: "Bill no.", ...NOWRAP, render: (_, r) => <Link to={`/bills/${r.billItem.bill.id}`}>{r.billItem.bill.billNumber}</Link> },
            { title: "Test", render: (_, r) => `${r.test.code} · ${r.test.name}` },
            { title: "Sample", dataIndex: "label", ...NOWRAP },
            {
              title: "Actions",
              ...NOWRAP,
              render: (_, r) => (
                <Popconfirm
                  title={`Mark ${r.test.code} (${r.label}) collected?`}
                  description={`From ${r.billItem.bill.patient.name}, now.`}
                  okText="Mark collected"
                  onConfirm={() => collect(r)}
                >
                  <Button type="link" size="small">
                    Mark collected
                  </Button>
                </Popconfirm>
              ),
            },
          ]}
        />
      </Section>
    </Page>
  );
}
