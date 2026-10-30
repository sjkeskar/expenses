import { App, Button, Form } from "antd";
import { api } from "../../api";
import { useShell } from "../../layout/AppShell";
import { useAction } from "../../lib/hooks";
import Page, { Section } from "../../components/Page";
import LabSettingsFields from "./LabSettingsFields";
import type { LabSettings } from "../../types/api";

// The lead's page for the lab's name and contact details (pivot.md §3.4).
export default function SettingsPage() {
  const { settings, reloadSettings } = useShell();
  const { message } = App.useApp();
  const [save, busy] = useAction(async (values: LabSettings) => {
    await api("/settings", { method: "PATCH", body: values });
    await reloadSettings();
    message.success("Lab settings saved.");
  });

  if (!settings) return null;
  return (
    <Page title="Lab settings" description="The lab's name and contact details head every printed quotation and bill.">
      <Section>
        <Form layout="vertical" initialValues={settings} onFinish={save} requiredMark="optional">
          <LabSettingsFields />
          <Button type="primary" htmlType="submit" loading={busy}>
            Save
          </Button>
        </Form>
      </Section>
    </Page>
  );
}
