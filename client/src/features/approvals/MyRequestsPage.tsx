import { Empty, Table, Tag } from "antd";
import { useApi } from "../../lib/hooks";
import { formatDateTime, SUBJECT_LABELS } from "../../lib/format";
import Page, { NOWRAP, Section } from "../../components/Page";
import type { Approval, ApprovalList } from "../../types/api";
import ApprovalDetails, { ApprovalStatusBadge } from "./ApprovalDetails";

// What the signed-in user asked for and where it stands (pivot.md §6.2):
// discounts, cancellations, corrections, catalog changes, doctors.
export default function MyRequestsPage() {
  const mine = useApi<ApprovalList>("/approvals/mine");
  return (
    <Page title="My requests" description="Requests you made that need, or needed, someone's approval. The latest 100 are shown.">
      <Section flush>
        <Table<Approval>
          rowKey="id"
          size="middle"
          loading={!mine.data && !mine.error}
          dataSource={mine.data?.approvals}
          pagination={{ pageSize: 25, hideOnSinglePage: true, showSizeChanger: false }}
          locale={{ emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="You haven't made any requests." /> }}
          columns={[
            { title: "Requested", dataIndex: "requestedAt", render: formatDateTime, ...NOWRAP },
            { title: "Kind", dataIndex: "subjectType", render: (t: Approval["subjectType"]) => <Tag>{SUBJECT_LABELS[t]}</Tag>, ...NOWRAP },
            { title: "Request", render: (_, a) => <ApprovalDetails approval={a} names={mine.data!.names} /> },
            { title: "Status", render: (_, a) => <ApprovalStatusBadge approval={a} />, ...NOWRAP },
            {
              title: "Decision",
              render: (_, a) =>
                a.reviewedBy && !a.selfApproved
                  ? `${a.reviewedBy.name}, ${formatDateTime(a.reviewedAt)}${a.reviewNote ? `: ${a.reviewNote}` : ""}`
                  : "—",
            },
          ]}
        />
      </Section>
    </Page>
  );
}
