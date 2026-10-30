import { useState } from "react";
import { App, Button, Col, Descriptions, Flex, Form, Input, Row, Select, Typography } from "antd";
import { api } from "../../api";
import { useShell } from "../../layout/AppShell";
import { useAction, useApi } from "../../lib/hooks";
import { formatDateTime } from "../../lib/format";
import Page, { COL, Section } from "../../components/Page";
import PasswordFields from "../../components/PasswordFields";
import LabSettingsFields from "../settings/LabSettingsFields";
import type { LabSettings, LeadStatus } from "../../types/api";

// The developer's page (pivot.md §3.3–3.4): first-run setup while the lab
// isn't set up yet; afterwards, re-appointing the lead when they haven't
// signed in for 7 days.
export default function SetupPage() {
  const { settings, reloadSettings } = useShell();
  if (settings === undefined) return null;
  return (
    <Page title="Lab setup" description={settings === null ? "Set up the lab once, before anyone else signs in." : "The lab's details and its lead pathologist."}>
      {settings === null ? <FirstRunSetup onDone={reloadSettings} /> : <LeadReappointment settings={settings} />}
    </Page>
  );
}

function FirstRunSetup({ onDone }: { onDone(): Promise<void> }) {
  const { message } = App.useApp();
  const [save, busy] = useAction(async ({ leadName, leadPassword, ...settings }: LabSettings & { leadName: string; leadPassword: string }) => {
    await api("/settings/setup", { method: "POST", body: { ...settings, lead: { name: leadName.trim(), password: leadPassword } } });
    message.success("The lab is set up. The lead pathologist can now sign in and create everyone else's accounts.");
    await onDone();
  });

  return (
    <Section title="First-run setup">
      <Typography.Paragraph>
        Enter the lab's details and create the lead pathologist's account. This is done once; afterwards only the
        lead pathologist can change the lab's name and contact details.
      </Typography.Paragraph>
      <Form layout="vertical" onFinish={save} requiredMark="optional">
        <LabSettingsFields />
        <Typography.Title level={3} style={{ fontSize: 16 }}>
          Lead pathologist
        </Typography.Title>
        <Row gutter={16}>
          <Col {...COL.wide}>
            <Form.Item label="Login name" name="leadName" rules={[{ required: true, whitespace: true, message: "Enter a login name" }]}>
              <Input autoComplete="off" />
            </Form.Item>
          </Col>
          <PasswordFields name="leadPassword" col={COL.narrow} />
        </Row>
        <Button type="primary" htmlType="submit" loading={busy}>
          Set up the lab
        </Button>
      </Form>
    </Section>
  );
}

function LeadReappointment({ settings }: { settings: LabSettings }) {
  const { modal, message } = App.useApp();
  const status = useApi<LeadStatus>("/users/lead");
  const [pathologistId, setPathologistId] = useState<string>();
  const [appoint, busy] = useAction(async () => {
    await api("/users/lead/appoint", { method: "POST", body: { pathologistId } });
    message.success("The new lead pathologist is appointed.");
    setPathologistId(undefined);
    await status.reload();
  });
  const lead = status.data?.lead;
  const chosen = status.data?.pathologists.find((p) => p.id === pathologistId);

  const confirm = () =>
    modal.confirm({
      title: "Appoint a new lead pathologist?",
      content: `${chosen?.name} becomes the lead pathologist. ${lead?.name ?? "The current lead"} becomes a pathologist.`,
      okText: "Appoint",
      onOk: appoint,
    });

  return (
    <>
      <Section title="Lab">
        <Descriptions column={1}>
          <Descriptions.Item label="Name">{settings.labName}</Descriptions.Item>
          <Descriptions.Item label="Phone">{settings.phone}</Descriptions.Item>
          <Descriptions.Item label="Email">{settings.email ?? "—"}</Descriptions.Item>
          <Descriptions.Item label="Address">{settings.address}</Descriptions.Item>
        </Descriptions>
      </Section>
      <Section title="Lead pathologist">
        <Flex vertical gap={16}>
          {lead ? (
            <Descriptions column={1}>
              <Descriptions.Item label="Current lead">{lead.name}</Descriptions.Item>
              <Descriptions.Item label="Last active">{formatDateTime(lead.lastActivity)}</Descriptions.Item>
            </Descriptions>
          ) : (
            <Typography.Text>There is no lead pathologist.</Typography.Text>
          )}
          {lead && !lead.inactive ? (
            <Typography.Text type="secondary">
              The lead normally hands over themselves. You can appoint a new lead only after the lead hasn't signed in
              for {status.data?.inactiveAfterDays} days.
            </Typography.Text>
          ) : (
            <Row gutter={[8, 8]}>
              <Col {...COL.wide}>
                <Select
                  aria-label="Pathologist to appoint"
                  placeholder="Choose a pathologist"
                  showSearch={{ optionFilterProp: "label" }}
                  style={{ width: "100%" }}
                  value={pathologistId}
                  onChange={setPathologistId}
                  options={status.data?.pathologists.map((p) => ({ value: p.id, label: p.name }))}
                />
              </Col>
              <Col>
                <Button type="primary" disabled={!pathologistId} loading={busy} onClick={confirm}>
                  Appoint as lead
                </Button>
              </Col>
            </Row>
          )}
        </Flex>
      </Section>
    </>
  );
}
