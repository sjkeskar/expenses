import { useState, type Key } from "react";
import { App, Button, Empty, Form, Input, Popconfirm, Space, Table, Tag, Typography } from "antd";
import { api } from "../../api";
import { useSession } from "../../auth/session";
import { useAction, useApi } from "../../lib/hooks";
import { formatDateTime, ROLE_LABELS, SUBJECT_LABELS } from "../../lib/format";
import FormModal from "../../components/FormModal";
import Page, { NOWRAP, Section } from "../../components/Page";
import type { Approval, ApprovalList } from "../../types/api";
import ApprovalDetails, { REJECT_EFFECT } from "./ApprovalDetails";

// The approval queue (pivot.md §6.2): what the signed-in pathologist or lead
// may approve — discounts, cancellations and patient corrections; for the
// lead also catalog changes and doctors — oldest first, one at a time or in
// bulk. Rejected cancellations wait here until the lead marks them resolved.
export default function ApprovalsPage() {
  const { user } = useSession();
  const { message } = App.useApp();
  const queue = useApi<ApprovalList>("/approvals");
  const [selected, setSelected] = useState<Key[]>([]);
  const [rejecting, setRejecting] = useState<Approval[]>();
  const [resolving, setResolving] = useState<Approval>();
  const isLead = user!.role === "lead_pathologist";

  const pending = queue.data?.approvals.filter((a) => a.status === "pending") ?? [];
  const unresolved = queue.data?.approvals.filter((a) => a.status === "rejected") ?? [];

  // Decides each request in turn; reports how many went through.
  const decideAll = async (approvals: Approval[], decision: "approve" | "reject", note?: string) => {
    const failures: string[] = [];
    for (const a of approvals) {
      try {
        await api(`/approvals/${a.id}/${decision}`, { method: "POST", body: { note } });
      } catch (e) {
        failures.push((e as Error).message);
      }
    }
    setSelected([]);
    await queue.reload();
    const done = approvals.length - failures.length;
    if (done) message.success(`${done} request${done === 1 ? "" : "s"} ${decision === "approve" ? "approved" : "rejected"}.`);
    if (failures.length) throw new Error(failures.join(" "));
  };
  const [approve, approving] = useAction((approvals: Approval[]) => decideAll(approvals, "approve"));
  const chosen = () => pending.filter((a) => selected.includes(a.id));

  const resolve = async ({ note }: { note: string }) => {
    await api(`/approvals/${resolving!.id}/resolve`, { method: "POST", body: { note } });
    message.success("Marked resolved: the bill's report is no longer held for it.");
    await queue.reload();
  };

  const common = [
    { title: "Requested", dataIndex: "requestedAt", render: formatDateTime, ...NOWRAP },
    { title: "Kind", dataIndex: "subjectType", render: (t: Approval["subjectType"]) => <Tag>{SUBJECT_LABELS[t]}</Tag>, ...NOWRAP },
    { title: "Request", render: (_: unknown, a: Approval) => <ApprovalDetails approval={a} names={queue.data!.names} /> },
    {
      title: "Requested by",
      render: (_: unknown, a: Approval) => `${a.requestedBy.name}${a.requestedBy.role ? ` (${ROLE_LABELS[a.requestedBy.role]})` : ""}`,
    },
  ];

  return (
    <Page
      title="Approval queue"
      description={isLead ? "Discounts, cancellations, patient corrections, catalog changes and new doctors." : "Discounts, cancellations and patient corrections."}
    >
      <Section
        title="Waiting for a decision"
        flush
        extra={
          <Space>
            <Button disabled={!selected.length} loading={approving} onClick={() => approve(chosen())}>
              Approve selected
            </Button>
            <Button danger disabled={!selected.length} onClick={() => setRejecting(chosen())}>
              Reject selected
            </Button>
          </Space>
        }
      >
        <Table<Approval>
          rowKey="id"
          size="middle"
          pagination={false}
          loading={!queue.data && !queue.error}
          dataSource={pending}
          locale={{ emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="Nothing is waiting for you." /> }}
          rowSelection={{ selectedRowKeys: selected, onChange: setSelected }}
          columns={[
            ...common,
            {
              title: "Actions",
              ...NOWRAP,
              render: (_, a) => (
                <Space size={0}>
                  <Popconfirm title="Approve this request?" okText="Approve" onConfirm={() => approve([a])}>
                    <Button type="link" size="small">
                      Approve
                    </Button>
                  </Popconfirm>
                  <Button type="link" size="small" danger onClick={() => setRejecting([a])}>
                    Reject
                  </Button>
                </Space>
              ),
            },
          ]}
        />
      </Section>
      {isLead && unresolved.length > 0 && (
        <Section title="Rejected cancellations to resolve" flush>
          <Table<Approval>
            rowKey="id"
            size="middle"
            pagination={false}
            dataSource={unresolved}
            columns={[
              ...common,
              { title: "Rejected", render: (_, a) => `${formatDateTime(a.reviewedAt)} by ${a.reviewedBy?.name}${a.reviewNote ? `: ${a.reviewNote}` : ""}` },
              {
                title: "Actions",
                ...NOWRAP,
                render: (_, a) => (
                  <Button type="link" size="small" onClick={() => setResolving(a)}>
                    Mark resolved
                  </Button>
                ),
              },
            ]}
          />
        </Section>
      )}

      <FormModal
        title={rejecting?.length === 1 ? "Reject request" : `Reject ${rejecting?.length} requests`}
        okText="Reject"
        open={!!rejecting}
        onSubmit={({ note }: { note?: string }) => decideAll(rejecting!, "reject", note)}
        onClose={() => setRejecting(undefined)}
      >
        {[...new Set(rejecting?.map((a) => a.subjectType))].map((t) => (
          <Typography.Paragraph key={t}>
            {SUBJECT_LABELS[t]}: {REJECT_EFFECT[t]}
          </Typography.Paragraph>
        ))}
        <Form.Item label="Note" name="note">
          <Input.TextArea autoSize={{ minRows: 2 }} />
        </Form.Item>
      </FormModal>
      <FormModal title="Mark resolved" okText="Mark resolved" open={!!resolving} onSubmit={resolve} onClose={() => setResolving(undefined)}>
        <Typography.Paragraph>Say how the rejected cancellation was dealt with, e.g. the test was billed again.</Typography.Paragraph>
        <Form.Item label="How it was resolved" name="note" rules={[{ required: true, whitespace: true, message: "Say how it was resolved" }]}>
          <Input.TextArea autoSize={{ minRows: 2 }} />
        </Form.Item>
      </FormModal>
    </Page>
  );
}
