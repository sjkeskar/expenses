import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Alert, App, Button, Input, Popconfirm, Segmented, Space, Table, Tag, Typography } from "antd";
import { api } from "../../api";
import { useSession } from "../../auth/session";
import { useAction, useApi } from "../../lib/hooks";
import { formatDateTime, formatMoney, KIND_LABELS } from "../../lib/format";
import Page, { NOWRAP, Section } from "../../components/Page";
import type { ApprovalList, CatalogItem, CatalogKind } from "../../types/api";
import { stepsText } from "./steps";

const RECEPTION = ["technician", "pathologist", "lead_pathologist"];

// The active catalog (pivot.md §6.1): ~150 items, loaded once and searched
// here. Technicians and pathologists propose changes, which the lead
// approves; the lead's own apply at once.
export default function CatalogPage() {
  const { user } = useSession();
  const { message } = App.useApp();
  const navigate = useNavigate();
  const catalog = useApi<{ items: CatalogItem[] }>("/catalog");
  const canEdit = RECEPTION.includes(user!.role);
  const isLead = user!.role === "lead_pathologist";
  const mine = useApi<ApprovalList>(canEdit && !isLead ? "/approvals/mine" : null);
  const queue = useApi<ApprovalList>(isLead ? "/approvals" : null);
  const [kind, setKind] = useState<CatalogKind | "all">("all");
  const [search, setSearch] = useState("");

  const [retire] = useAction(async (item: CatalogItem) => {
    await api("/catalog/changes", { method: "POST", body: { changes: [{ action: "retire", catalogItemId: item.id }] } });
    message.success(isLead ? `${item.code} is retired.` : `Retiring ${item.code} is sent to the lead for approval.`);
    await Promise.all([catalog.reload(), mine.reload()]);
  });

  const q = search.trim().toLowerCase();
  const items = (catalog.data?.items ?? []).filter(
    (i) => (kind === "all" || i.kind === kind) && (!q || i.code.toLowerCase().includes(q) || i.name.toLowerCase().includes(q))
  );
  const waiting = mine.data?.approvals.filter((a) => a.subjectType === "catalog_change" && a.status === "pending") ?? [];
  const toReview = queue.data?.approvals.filter((a) => a.subjectType === "catalog_change").length ?? 0;

  return (
    <Page
      title="Tests & profiles"
      description="The lab's catalog: tests, profiles (with their tests) and services, at their standard prices."
      actions={canEdit && <Button type="primary" onClick={() => navigate("/catalog/entry")}>Add items</Button>}
    >
      {toReview > 0 && (
        <Alert type="info" showIcon title={<>{toReview} catalog change{toReview === 1 ? " is" : "s are"} waiting for your approval in the <Link to="/approvals">approval queue</Link>.</>} />
      )}
      <Section
        flush
        toolbar={
          <>
            <Input.Search aria-label="Search the catalog" placeholder="Code or name" allowClear onChange={(e) => setSearch(e.target.value)} style={{ maxWidth: 320 }} />
            <Segmented<CatalogKind | "all">
              value={kind}
              onChange={setKind}
              options={[{ value: "all", label: "All" }, ...Object.entries(KIND_LABELS).map(([value, label]) => ({ value: value as CatalogKind, label: `${label}s` }))]}
            />
          </>
        }
      >
        <Table<CatalogItem>
          rowKey="id"
          size="middle"
          loading={!catalog.data && !catalog.error}
          dataSource={items}
          pagination={{ pageSize: 50, hideOnSinglePage: true, showSizeChanger: false }}
          columns={[
            { title: "Code", dataIndex: "code", ...NOWRAP },
            {
              title: "Name",
              render: (_, item) => (
                <>
                  {item.name}
                  {item.instructions && (
                    <Typography.Text type="secondary" style={{ display: "block", fontSize: 12 }}>
                      {item.instructions}
                    </Typography.Text>
                  )}
                </>
              ),
            },
            { title: "Kind", dataIndex: "kind", render: (k: CatalogKind) => <Tag>{KIND_LABELS[k]}</Tag>, ...NOWRAP },
            { title: "Department", dataIndex: "department", render: (v) => v ?? "—" },
            { title: "Sample", render: (_, i) => [i.sampleType, i.container].filter(Boolean).join(", ") || "—" },
            {
              title: "Draws · machines · tests",
              render: (_, i) =>
                i.kind === "profile"
                  ? i.components.map((c) => c.test.code).sort().join(", ")
                  : i.kind === "test"
                    ? [i.draws.map((d) => d.label).join(", "), stepsText(i.machineSteps)].filter(Boolean).join(" · ")
                    : "—",
            },
            { title: "Price", dataIndex: "price", align: "right", render: formatMoney, ...NOWRAP },
            ...(canEdit
              ? [
                  {
                    title: "Actions",
                    ...NOWRAP,
                    render: (_: unknown, item: CatalogItem) => (
                      <Space size={0}>
                        <Button type="link" size="small" onClick={() => navigate("/catalog/entry", { state: { edit: [item.id] } })}>
                          Edit
                        </Button>
                        <Popconfirm
                          title={`Retire ${item.code}?`}
                          description={isLead ? "It leaves the catalog; old bills keep it." : "The lead approves it before it leaves the catalog."}
                          okText="Retire"
                          onConfirm={() => retire(item)}
                        >
                          <Button type="link" size="small" danger>
                            Retire
                          </Button>
                        </Popconfirm>
                      </Space>
                    ),
                  },
                ]
              : []),
          ]}
        />
      </Section>
      {waiting.length > 0 && (
        <Section title="Your changes waiting for approval" flush>
          <Table
            rowKey="id"
            size="middle"
            pagination={false}
            dataSource={waiting}
            columns={[
              { title: "Requested", dataIndex: "requestedAt", render: formatDateTime, ...NOWRAP },
              { title: "Change", render: (_, a) => ({ create: "Add", update: "Edit", retire: "Retire" })[a.payload.action as string] },
              { title: "Item", render: (_, a) => a.payload.values?.code ?? a.subject?.code },
              { title: "Name", render: (_, a) => a.payload.values?.name ?? a.subject?.name },
            ]}
          />
        </Section>
      )}
    </Page>
  );
}
