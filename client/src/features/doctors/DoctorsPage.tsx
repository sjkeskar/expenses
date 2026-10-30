import { useState } from "react";
import { App, Badge, Button, Form, Input, Table } from "antd";
import { api } from "../../api";
import { useSession } from "../../auth/session";
import { useApi } from "../../lib/hooks";
import { formatDateTime } from "../../lib/format";
import FormModal from "../../components/FormModal";
import Page, { NOWRAP, Section } from "../../components/Page";
import type { Doctor } from "../../types/api";

// Referring doctors (pivot.md §6.3). A new doctor can be named on bills at
// once, but those bills' reports are held until the lead approves them in
// the approval queue.
export default function DoctorsPage() {
  const { user } = useSession();
  const { message } = App.useApp();
  const doctors = useApi<{ doctors: Doctor[] }>("/doctors");
  const [adding, setAdding] = useState(false);
  const isLead = user!.role === "lead_pathologist";

  const add = async (values: { name: string; phone?: string; clinic?: string }) => {
    await api("/doctors", { method: "POST", body: values });
    message.success(isLead ? `${values.name.trim()} is added.` : `${values.name.trim()} is added and waits for the lead's approval.`);
    await doctors.reload();
  };

  return (
    <Page
      title="Referring doctors"
      description="Doctors who refer patients. New ones can be named on bills straight away; their reports wait for the lead's approval."
      actions={<Button type="primary" onClick={() => setAdding(true)}>Add doctor</Button>}
    >
      <Section flush>
        <Table<Doctor>
          rowKey="id"
          size="middle"
          loading={!doctors.data && !doctors.error}
          dataSource={doctors.data?.doctors}
          pagination={{ pageSize: 50, hideOnSinglePage: true, showSizeChanger: false }}
          columns={[
            { title: "Name", dataIndex: "name" },
            { title: "Clinic / hospital", dataIndex: "clinic", render: (v) => v ?? "—" },
            { title: "Phone", dataIndex: "phone", render: (v) => v ?? "—", ...NOWRAP },
            {
              title: "Status",
              dataIndex: "status",
              ...NOWRAP,
              render: (status) => <Badge status={status === "approved" ? "success" : "warning"} text={status === "approved" ? "Approved" : "Awaiting approval"} />,
            },
            { title: "Added", render: (_, d) => `${formatDateTime(d.createdAt)}${d.createdBy ? ` by ${d.createdBy.name}` : ""}` },
          ]}
        />
      </Section>
      <FormModal title="Add doctor" okText="Add doctor" open={adding} onSubmit={add} onClose={() => setAdding(false)}>
        <Form.Item label="Name" name="name" rules={[{ required: true, whitespace: true, message: "Enter the doctor's name" }]}>
          <Input />
        </Form.Item>
        <Form.Item label="Clinic / hospital" name="clinic">
          <Input />
        </Form.Item>
        <Form.Item label="Phone" name="phone">
          <Input inputMode="tel" />
        </Form.Item>
      </FormModal>
    </Page>
  );
}
