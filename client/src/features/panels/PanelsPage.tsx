import { useState } from "react";
import { App, Badge, Button, Col, DatePicker, Flex, Form, Input, InputNumber, Popconfirm, Radio, Row, Select, Space, Table, Tag } from "antd";
import { api } from "../../api";
import { useAction, useApi } from "../../lib/hooks";
import { DATE_TIME, formatDateTime, formatMoney, fromPicker, PANEL_TYPE_LABELS, toPicker, type Dayjs } from "../../lib/format";
import FormModal from "../../components/FormModal";
import Page, { NOWRAP, Section } from "../../components/Page";
import type { Camp, CatalogItem, Location, Panel, PanelType, PriceList } from "../../types/api";

// Panels and camps (pivot.md §4.5), the lead's: a panel (corporate, TPA,
// insurer) may have standing rates; a camp is a company's scheduled event
// with rates for its period only. Rates are custom prices for some items
// and a % off the catalog price for the rest. Edits affect new quotes and
// bills only.
interface RateValues {
  discountPercent?: number | null;
  items?: { catalogItemId: string; price: number }[];
}

interface CampValues extends RateValues {
  panelId: string;
  name: string;
  venue?: string;
  locationId: string;
  period: [Dayjs, Dayjs];
}

const ratesOf = (list: PriceList | null): RateValues => ({
  discountPercent: list?.discountPercent === null || list?.discountPercent === undefined ? undefined : Number(list.discountPercent),
  items: list?.items.map((i) => ({ catalogItemId: i.catalogItemId, price: Number(i.price) })) ?? [],
});

const ratesText = (list: PriceList | null) => {
  const parts = [
    list?.discountPercent && Number(list.discountPercent) ? `${Number(list.discountPercent)}% off` : "",
    list?.items.length ? `${list.items.length} custom price${list.items.length === 1 ? "" : "s"}` : "",
  ].filter(Boolean);
  return parts.length ? parts.join(" · ") : "Catalog prices";
};

const campState = (c: Camp) =>
  c.running ? <Badge status="success" text="Running" /> : new Date(c.startsAt) > new Date() ? <Badge status="processing" text="Scheduled" /> : <Badge status="default" text="Ended" />;

export default function PanelsPage() {
  const { message } = App.useApp();
  const panels = useApi<{ panels: Panel[] }>("/panels");
  const camps = useApi<{ camps: Camp[] }>("/camps");
  const catalog = useApi<{ items: CatalogItem[] }>("/catalog");
  const locations = useApi<{ locations: Location[] }>("/locations");
  const [editingPanel, setEditingPanel] = useState<Panel | "new">();
  const [rates, setRates] = useState<Panel>();
  const [editingCamp, setEditingCamp] = useState<Camp | "new">();
  const reload = () => Promise.all([panels.reload(), camps.reload()]);

  const [remove] = useAction(async (path: string, name: string) => {
    await api(path, { method: "DELETE" });
    message.success(`${name} is removed.`);
    await reload();
  });
  const panel = editingPanel === "new" ? undefined : editingPanel;
  const camp = editingCamp === "new" ? undefined : editingCamp;

  const savePanel = async (values: { name: string; type: PanelType; contact?: string }) => {
    await api(panel ? `/panels/${panel.id}` : "/panels", { method: panel ? "PATCH" : "POST", body: values });
    message.success(`${values.name.trim()} is saved.`);
    await reload();
  };
  const saveRates = async (values: RateValues) => {
    await api(`/panels/${rates!.id}/price-list`, { method: "PUT", body: { discountPercent: values.discountPercent ?? null, items: values.items ?? [] } });
    message.success(`${rates!.name}'s rates are saved.`);
    await reload();
  };
  const saveCamp = async ({ period, ...values }: CampValues) => {
    const body = { ...values, discountPercent: values.discountPercent ?? null, items: values.items ?? [], startsAt: fromPicker(period[0]), endsAt: fromPicker(period[1]) };
    await api(camp ? `/camps/${camp.id}` : "/camps", { method: camp ? "PATCH" : "POST", body });
    message.success(`${values.name.trim()} is saved.`);
    await reload();
  };

  const removeButton = (path: string, name: string) => (
    <Popconfirm title={`Remove ${name}?`} description="Its bills keep showing it; it leaves the pickers." okText="Remove" onConfirm={() => remove(path, name)}>
      <Button type="link" size="small" danger>
        Remove
      </Button>
    </Popconfirm>
  );

  return (
    <Page title="Panels & camps" description="Who pays besides the patient, and the special rates they get.">
      <Section title="Panels" flush extra={<Button onClick={() => setEditingPanel("new")}>Add panel</Button>}>
        <Table<Panel>
          rowKey="id"
          size="middle"
          pagination={false}
          loading={!panels.data && !panels.error}
          dataSource={panels.data?.panels}
          columns={[
            { title: "Name", dataIndex: "name" },
            { title: "Type", dataIndex: "type", render: (t: PanelType) => <Tag>{PANEL_TYPE_LABELS[t]}</Tag>, ...NOWRAP },
            { title: "Contact", dataIndex: "contact", render: (v) => v ?? "—" },
            { title: "Standing rates", render: (_, p) => ratesText(p.priceList) },
            {
              title: "Actions",
              ...NOWRAP,
              render: (_, p) => (
                <Space size={0}>
                  <Button type="link" size="small" onClick={() => setEditingPanel(p)}>
                    Edit
                  </Button>
                  <Button type="link" size="small" onClick={() => setRates(p)}>
                    Rates
                  </Button>
                  {removeButton(`/panels/${p.id}`, p.name)}
                </Space>
              ),
            },
          ]}
        />
      </Section>
      <Section title="Camps" flush extra={<Button onClick={() => setEditingCamp("new")}>Add camp</Button>}>
        <Table<Camp>
          rowKey="id"
          size="middle"
          pagination={false}
          loading={!camps.data && !camps.error}
          dataSource={camps.data?.camps}
          columns={[
            { title: "Name", render: (_, c) => `${c.name}${c.venue ? `, ${c.venue}` : ""}` },
            { title: "Panel", render: (_, c) => c.panel.name },
            { title: "Location", render: (_, c) => c.location.name },
            { title: "Period", ...NOWRAP, render: (_, c) => `${formatDateTime(c.startsAt)} – ${formatDateTime(c.endsAt)}` },
            { title: "Status", render: (_, c) => campState(c), ...NOWRAP },
            { title: "Rates", render: (_, c) => ratesText(c.priceList) },
            {
              title: "Actions",
              ...NOWRAP,
              render: (_, c) => (
                <Space size={0}>
                  <Button type="link" size="small" onClick={() => setEditingCamp(c)}>
                    Edit
                  </Button>
                  {removeButton(`/camps/${c.id}`, c.name)}
                </Space>
              ),
            },
          ]}
        />
      </Section>

      <FormModal title={panel ? `Edit ${panel.name}` : "Add panel"} open={!!editingPanel} initialValues={panel ? { ...panel, contact: panel.contact ?? undefined } : { type: "corporate" }} onSubmit={savePanel} onClose={() => setEditingPanel(undefined)}>
        <Form.Item label="Name" name="name" rules={[{ required: true, whitespace: true, message: "Enter a name" }]}>
          <Input />
        </Form.Item>
        <Form.Item label="Type" name="type" required>
          <Radio.Group options={Object.entries(PANEL_TYPE_LABELS).map(([value, label]) => ({ value, label }))} />
        </Form.Item>
        <Form.Item label="Contact" name="contact">
          <Input />
        </Form.Item>
      </FormModal>
      <FormModal<RateValues> title={`${rates?.name}: standing rates`} open={!!rates} initialValues={ratesOf(rates?.priceList ?? null)} onSubmit={saveRates} onClose={() => setRates(undefined)}>
        <RateFields catalog={catalog.data?.items ?? []} />
      </FormModal>
      <FormModal<CampValues>
        title={camp ? `Edit ${camp.name}` : "Add camp"}
        open={!!editingCamp}
        initialValues={
          camp
            ? { panelId: camp.panel.id, name: camp.name, venue: camp.venue ?? undefined, locationId: camp.location.id, period: [toPicker(camp.startsAt)!, toPicker(camp.endsAt)!], ...ratesOf(camp.priceList) }
            : { items: [] }
        }
        onSubmit={saveCamp}
        onClose={() => setEditingCamp(undefined)}
      >
        <Form.Item label="Panel (the company)" name="panelId" rules={[{ required: true, message: "Choose the panel" }]}>
          <Select showSearch={{ optionFilterProp: "label" }} options={panels.data?.panels.map((p) => ({ value: p.id, label: p.name }))} />
        </Form.Item>
        <Form.Item label="Camp name" name="name" rules={[{ required: true, whitespace: true, message: "Enter a name" }]}>
          <Input />
        </Form.Item>
        <Form.Item label="Venue" name="venue">
          <Input />
        </Form.Item>
        <Form.Item label="Conducted by" name="locationId" extra="The camp's quotes and bills use this branch or centre." rules={[{ required: true, message: "Choose the location" }]}>
          <Select showSearch={{ optionFilterProp: "label" }} options={locations.data?.locations.map((l) => ({ value: l.id, label: l.name }))} />
        </Form.Item>
        <Form.Item label="Period" name="period" extra="Camp rates apply only inside it." rules={[{ required: true, message: "Enter when the camp runs" }]}>
          <DatePicker.RangePicker {...DATE_TIME} style={{ width: "100%" }} />
        </Form.Item>
        <RateFields catalog={catalog.data?.items ?? []} />
      </FormModal>
    </Page>
  );
}

// A price list: % off the catalog for every item not listed, and custom
// prices for the items that are.
function RateFields({ catalog }: { catalog: CatalogItem[] }) {
  return (
    <>
      <Form.Item label="Discount on catalog prices (%)" name="discountPercent" extra="For every item without a custom price below.">
        <InputNumber min={0} max={100} style={{ width: "100%" }} />
      </Form.Item>
      <Form.List name="items">
        {(fields, { add, remove }) => (
          <Form.Item label="Custom prices">
            <Flex vertical gap={8}>
              {fields.map((field) => (
                <Row key={field.key} gutter={8} wrap={false} align="top">
                  <Col flex="auto">
                    <Form.Item name={[field.name, "catalogItemId"]} rules={[{ required: true, message: "Choose an item" }]} style={{ margin: 0 }}>
                      <Select aria-label={`Item ${field.name + 1}`} showSearch={{ optionFilterProp: "label" }} options={catalog.map((i) => ({ value: i.id, label: `${i.code} · ${i.name} (${formatMoney(i.price)})` }))} />
                    </Form.Item>
                  </Col>
                  <Col flex="140px">
                    <Form.Item name={[field.name, "price"]} rules={[{ required: true, message: "Price" }]} style={{ margin: 0 }}>
                      <InputNumber aria-label={`Price ${field.name + 1}`} min={0} prefix="₹" style={{ width: "100%" }} />
                    </Form.Item>
                  </Col>
                  <Col>
                    <Button type="link" danger onClick={() => remove(field.name)}>
                      Remove
                    </Button>
                  </Col>
                </Row>
              ))}
              <Button onClick={() => add()}>Add a custom price</Button>
            </Flex>
          </Form.Item>
        )}
      </Form.List>
    </>
  );
}
