import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { App, Badge, Button, Col, Flex, Form, Input, Popconfirm, Row, Select, Space, Table, Typography } from "antd";
import { api } from "../../api";
import { useSession } from "../../auth/session";
import { useAction, useApi } from "../../lib/hooks";
import { formatDateTime, ROLE_LABELS } from "../../lib/format";
import FormModal from "../../components/FormModal";
import Page, { COL, NOWRAP, Section } from "../../components/Page";
import PasswordFields from "../../components/PasswordFields";
import type { Account, LeadStatus, Role } from "../../types/api";

// The roles the lead creates and manages (pivot.md §3.2).
const MANAGED: Role[] = ["pathologist", "technician", "accountant"];

export default function UsersPage() {
  const { message } = App.useApp();
  const users = useApi<{ users: Account[] }>("/users");
  const [adding, setAdding] = useState(false);
  const [resetting, setResetting] = useState<Account>();
  const [deactivate] = useAction(async (user: Account) => {
    await api(`/users/${user.id}`, { method: "DELETE" });
    message.success(`${user.name} is deactivated.`);
    await users.reload();
  });

  const create = async ({ name, role, password }: { name: string; role: Role; password: string }) => {
    await api("/users", { method: "POST", body: { name: name.trim(), role, password } });
    message.success(`${name.trim()} can now sign in.`);
    await users.reload();
  };
  const reset = async ({ password }: { password: string }) => {
    await api(`/users/${resetting!.id}/password`, { method: "PATCH", body: { newPassword: password } });
    message.success(`${resetting!.name}'s password is reset.`);
  };

  return (
    <Page
      title="Users"
      description="Everyone who signs in to the system. Only you create and manage their accounts."
      actions={<Button type="primary" onClick={() => setAdding(true)}>Add user</Button>}
    >
      <Section flush>
        <Table<Account>
          rowKey="id"
          size="middle"
          loading={!users.data && !users.error}
          dataSource={users.data?.users}
          pagination={false}
          columns={[
            { title: "Name", dataIndex: "name" },
            { title: "Role", dataIndex: "role", render: (role: Role) => ROLE_LABELS[role] },
            { title: "Status", dataIndex: "isDeleted", render: (gone: boolean) => <Badge status={gone ? "default" : "success"} text={gone ? "Deactivated" : "Active"} /> },
            { title: "Last sign-in", dataIndex: "lastLoginAt", render: formatDateTime, ...NOWRAP },
            {
              title: "Actions",
              ...NOWRAP,
              render: (_, user) =>
                MANAGED.includes(user.role) &&
                !user.isDeleted && (
                  <Space size={0}>
                    <Button type="link" size="small" onClick={() => setResetting(user)}>
                      Reset password
                    </Button>
                    <Popconfirm title={`Deactivate ${user.name}?`} description="They're signed out and can't sign in again." okText="Deactivate" onConfirm={() => deactivate(user)}>
                      <Button type="link" size="small" danger>
                        Deactivate
                      </Button>
                    </Popconfirm>
                  </Space>
                ),
            },
          ]}
        />
      </Section>
      <LeadHandover />

      <FormModal title="Add user" okText="Add user" open={adding} onSubmit={create} onClose={() => setAdding(false)}>
        <Form.Item label="Login name" name="name" rules={[{ required: true, whitespace: true, message: "Enter a login name" }]}>
          <Input autoComplete="off" />
        </Form.Item>
        <Form.Item label="Role" name="role" rules={[{ required: true, message: "Choose a role" }]}>
          <Select options={MANAGED.map((r) => ({ value: r, label: ROLE_LABELS[r] }))} />
        </Form.Item>
        <PasswordFields />
      </FormModal>
      <FormModal title={`Reset ${resetting?.name}'s password`} okText="Reset password" open={!!resetting} onSubmit={reset} onClose={() => setResetting(undefined)}>
        <PasswordFields label="New password" />
      </FormModal>
    </Page>
  );
}

// Handing over to a pathologist makes the lead a pathologist (pivot.md §3.3);
// the dialog says so plainly before anything happens.
function LeadHandover() {
  const { modal } = App.useApp();
  const { refresh } = useSession();
  const navigate = useNavigate();
  const status = useApi<LeadStatus>("/users/lead");
  const [pathologistId, setPathologistId] = useState<string>();
  const [handOver, busy] = useAction(async () => {
    await api("/users/lead/handover", { method: "POST", body: { pathologistId } });
    await refresh();
    navigate("/");
  });
  const chosen = status.data?.pathologists.find((p) => p.id === pathologistId);

  const confirm = () =>
    modal.confirm({
      title: "Hand over as lead pathologist?",
      content: `You are making ${chosen?.name} the lead pathologist. Your own account will become a pathologist account.`,
      okText: "Hand over",
      okButtonProps: { danger: true },
      onOk: handOver,
    });

  return (
    <Section title="Hand over as lead pathologist">
      <Flex vertical gap={16}>
        <Typography.Text>There is only one lead pathologist. Choose the pathologist who takes over from you.</Typography.Text>
        <Row gutter={[8, 8]}>
          <Col {...COL.wide}>
            <Select
              aria-label="New lead pathologist"
              placeholder="Choose a pathologist"
              showSearch={{ optionFilterProp: "label" }}
              style={{ width: "100%" }}
              value={pathologistId}
              onChange={setPathologistId}
              options={status.data?.pathologists.map((p) => ({ value: p.id, label: p.name }))}
            />
          </Col>
          <Col>
            <Button danger disabled={!pathologistId} loading={busy} onClick={confirm}>
              Hand over
            </Button>
          </Col>
        </Row>
      </Flex>
    </Section>
  );
}
