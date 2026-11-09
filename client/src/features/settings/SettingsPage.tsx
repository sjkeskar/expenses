import { App, Button, Form } from "antd";
import { api } from "../../api";
import { useShell } from "../../layout/AppShell";
import { useAction, useApi } from "../../lib/hooks";
import Page, { Section } from "../../components/Page";
import LabSettingsFields from "./LabSettingsFields";
import type { LabSettings } from "../../types/api";

// The lead's page for the lab's name and contact details (pivot.md §3.4).
// The settings are this screen's own data, loaded here (a failure shows on
// the screen); saving refreshes the header's copy too.
export default function SettingsPage() {
  const { reloadSettings } = useShell();
  const own = useApi<{ settings: LabSettings | null }>("/settings");
  const { message } = App.useApp();
  const [save, busy] = useAction(async (values: LabSettings) => {
    await api("/settings", { method: "PATCH", body: values });
    await Promise.all([own.reload(), reloadSettings()]);
    message.success("Lab settings saved.");
  });

  const settings = own.data?.settings;
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
