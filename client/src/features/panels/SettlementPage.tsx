import { useState, type Key } from "react";
import { Link } from "react-router-dom";
import { App, Button, Col, Form, Row, Select, Table, Typography } from "antd";
import { api } from "../../api";
import { useAction, useApi } from "../../lib/hooks";
import { formatDateTime, formatMoney, MODE_OPTIONS, paise } from "../../lib/format";
import Page, { COL, NOWRAP, Section } from "../../components/Page";
import type { Panel, PaymentMode } from "../../types/api";

interface Outstanding {
  totalOutstanding: number;
  pendingBills: { id: string; billNumber: string; balance: string; createdAt: string; patient: { id: string; name: string } }[];
}

// Panel settlement (pivot.md §6.8): pick the panel, tick the bills it has
// paid for (some may be disputed and skipped), and close them in full.
export default function SettlementPage() {
  const { message } = App.useApp();
  const panels = useApi<{ panels: Panel[] }>("/panels");
  const [panelId, setPanelId] = useState<string>();
  const outstanding = useApi<Outstanding>(panelId ? `/panels/${panelId}/outstanding` : null);
  const [selected, setSelected] = useState<Key[]>([]);
  const [mode, setMode] = useState<PaymentMode>("upi");
  const bills = panelId && outstanding.data ? outstanding.data.pendingBills : [];
  const total = bills.filter((b) => selected.includes(b.id)).reduce((sum, b) => sum + paise(b.balance), 0);

  const [settle, busy] = useAction(async () => {
    const result = await api<{ totalSettled: number }>(`/panels/${panelId}/settle`, { method: "POST", body: { billIds: selected, mode } });
    message.success(`${selected.length} bill${selected.length === 1 ? "" : "s"} settled for ${formatMoney(result.totalSettled)}.`);
    setSelected([]);
    await outstanding.reload();
  });

  return (
    <Page title="Panel settlement" description="Close a panel's bills once it has paid for them.">
      <Section
        flush
        toolbar={
          <>
            <Select
              aria-label="Panel"
              placeholder="Choose the panel"
              showSearch={{ optionFilterProp: "label" }}
              value={panelId}
              onChange={(id) => {
                setPanelId(id);
                setSelected([]);
              }}
              style={{ minWidth: 280 }}
              options={panels.data?.panels.map((p) => ({ value: p.id, label: p.name }))}
            />
            {outstanding.data && panelId && (
              <Typography.Text type="secondary">
                {outstanding.data.pendingBills.length} bills outstanding, {formatMoney(outstanding.data.totalOutstanding)} in all
              </Typography.Text>
            )}
          </>
        }
      >
        <Table
          rowKey="id"
          size="middle"
          pagination={false}
          dataSource={bills}
          locale={{ emptyText: panelId ? "Nothing outstanding" : "Choose a panel" }}
          rowSelection={{ selectedRowKeys: selected, onChange: setSelected }}
          columns={[
            { title: "Bill no.", dataIndex: "billNumber", ...NOWRAP, render: (n, b) => <Link to={`/bills/${b.id}`}>{n}</Link> },
            { title: "Date", dataIndex: "createdAt", render: formatDateTime, ...NOWRAP },
            { title: "Patient", render: (_, b) => b.patient.name },
            { title: "Balance", dataIndex: "balance", align: "right", render: formatMoney, ...NOWRAP },
          ]}
          footer={() => (
            <Typography.Text>
              Selected: {selected.length} bill{selected.length === 1 ? "" : "s"}, {formatMoney(total / 100)}
            </Typography.Text>
          )}
        />
      </Section>
      <Section title="Settle">
        <Form layout="vertical" onFinish={settle}>
          <Typography.Paragraph>Each selected bill is closed in full, recorded as a settlement taken by you.</Typography.Paragraph>
          <Row gutter={16} align="bottom">
            <Col {...COL.narrow}>
              <Form.Item label="Received by" required>
                <Select aria-label="Received by" value={mode} onChange={setMode} options={MODE_OPTIONS} />
              </Form.Item>
            </Col>
            <Col>
              <Form.Item>
                <Button type="primary" htmlType="submit" disabled={!selected.length} loading={busy}>
                  Settle {selected.length || ""} bill{selected.length === 1 ? "" : "s"}
                </Button>
              </Form.Item>
            </Col>
          </Row>
        </Form>
      </Section>
    </Page>
  );
}
