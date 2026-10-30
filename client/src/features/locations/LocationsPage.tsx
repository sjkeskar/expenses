import { useState } from "react";
import { App, Button, Form, Input, InputNumber, Popconfirm, Radio, Select, Space, Switch, Table, Tag } from "antd";
import { api } from "../../api";
import { useAction, useApi } from "../../lib/hooks";
import { formatMoney } from "../../lib/format";
import FormModal from "../../components/FormModal";
import Page, { NOWRAP, Section } from "../../components/Page";
import type { Location, LocationType } from "../../types/api";

// Branches and collection centres (pivot.md §4.3). A centre's samples are
// processed at one branch; a location without a home-visit charge doesn't
// offer home visits. The 2-digit code prefixes every bill number raised
// there, so it's fixed once created. A branch can become a collection
// centre (the server checks nothing still depends on it being a branch).
interface Values {
  name: string;
  locationCode?: string;
  type: LocationType;
  processingBranchId?: string;
  address: string;
  phone?: string;
  homeVisits: boolean;
  homeVisitCharge?: number;
}

const TYPE_LABELS: Record<LocationType, string> = { branch: "Branch", collection_centre: "Collection centre" };

export default function LocationsPage() {
  const { message } = App.useApp();
  const locations = useApi<{ locations: Location[] }>("/locations");
  const [editing, setEditing] = useState<Location | "new">();
  const [remove] = useAction(async (location: Location) => {
    await api(`/locations/${location.id}`, { method: "DELETE" });
    message.success(`${location.name} is removed.`);
    await locations.reload();
  });

  const branches = (locations.data?.locations ?? []).filter((l) => l.type === "branch");
  const current = editing === "new" ? undefined : editing;

  const save = async ({ homeVisits, homeVisitCharge, ...values }: Values) => {
    const body = { ...values, homeVisitCharge: homeVisits ? homeVisitCharge : null };
    await api(current ? `/locations/${current.id}` : "/locations", { method: current ? "PATCH" : "POST", body });
    message.success(`${values.name} is saved.`);
    await locations.reload();
  };

  return (
    <Page
      title="Branches & collection centres"
      description="Where patients are seen. A collection centre's samples are processed at a branch."
      actions={<Button type="primary" onClick={() => setEditing("new")}>Add location</Button>}
    >
      <Section flush>
        <Table<Location>
          rowKey="id"
          size="middle"
          loading={!locations.data && !locations.error}
          dataSource={locations.data?.locations}
          pagination={false}
          columns={[
            { title: "Name", dataIndex: "name" },
            { title: "Code", dataIndex: "locationCode", ...NOWRAP },
            { title: "Type", dataIndex: "type", render: (type: LocationType) => <Tag>{TYPE_LABELS[type]}</Tag>, ...NOWRAP },
            { title: "Processed at", render: (_, l) => l.processingBranch?.name ?? "—" },
            { title: "Address", dataIndex: "address" },
            { title: "Phone", dataIndex: "phone", render: (phone) => phone ?? "—", ...NOWRAP },
            { title: "Home visits", dataIndex: "homeVisitCharge", render: (charge) => (charge === null ? "Not offered" : `From ${formatMoney(charge)}`), ...NOWRAP },
            {
              title: "Actions",
              ...NOWRAP,
              render: (_, location) => (
                <Space size={0}>
                  <Button type="link" size="small" onClick={() => setEditing(location)}>
                    Edit
                  </Button>
                  <Popconfirm title={`Remove ${location.name}?`} description="Bills keep showing it; it leaves the pickers." okText="Remove" onConfirm={() => remove(location)}>
                    <Button type="link" size="small" danger>
                      Remove
                    </Button>
                  </Popconfirm>
                </Space>
              ),
            },
          ]}
        />
      </Section>

      <FormModal<Values>
        title={current ? `Edit ${current.name}` : "Add location"}
        open={!!editing}
        onSubmit={save}
        onClose={() => setEditing(undefined)}
        initialValues={
          current
            ? { ...current, phone: current.phone ?? undefined, processingBranchId: current.processingBranchId ?? undefined, homeVisits: current.homeVisitCharge !== null, homeVisitCharge: current.homeVisitCharge === null ? undefined : Number(current.homeVisitCharge) }
            : { type: "branch", homeVisits: false }
        }
      >
        <Form.Item label="Name" name="name" rules={[{ required: true, whitespace: true, message: "Enter a name" }]}>
          <Input />
        </Form.Item>
        <Form.Item
          label="Type"
          name="type"
          required
          extra={current?.type === "branch" ? "It can become a collection centre once it has no machines and no centre sends it samples." : undefined}
        >
          <Radio.Group options={Object.entries(TYPE_LABELS).map(([value, label]) => ({ value, label }))} />
        </Form.Item>
        <Form.Item
          label="Location code"
          name="locationCode"
          required
          extra="Two digits; it starts every bill number raised here and can't change later."
          rules={[{ required: !current, pattern: /^\d{2}$/, message: "Exactly two digits, e.g. 04" }]}
        >
          <Input disabled={!!current} maxLength={2} inputMode="numeric" />
        </Form.Item>
        <Form.Item noStyle dependencies={["type"]}>
          {({ getFieldValue }) =>
            getFieldValue("type") === "collection_centre" && (
              <Form.Item label="Samples processed at" name="processingBranchId" rules={[{ required: true, message: "Choose the processing branch" }]}>
                <Select showSearch={{ optionFilterProp: "label" }} options={branches.filter((b) => b.id !== current?.id).map((b) => ({ value: b.id, label: b.name }))} />
              </Form.Item>
            )
          }
        </Form.Item>
        <Form.Item label="Address" name="address" extra="Printed on quotations and bills." rules={[{ required: true, whitespace: true, message: "Enter the address" }]}>
          <Input.TextArea autoSize={{ minRows: 2 }} />
        </Form.Item>
        <Form.Item label="Phone" name="phone">
          <Input inputMode="tel" />
        </Form.Item>
        <Form.Item label="Offers home visits" name="homeVisits" valuePropName="checked" required>
          <Switch />
        </Form.Item>
        <Form.Item noStyle dependencies={["homeVisits"]}>
          {({ getFieldValue }) =>
            getFieldValue("homeVisits") && (
              <Form.Item
                label="Home-visit charge (minimum)"
                name="homeVisitCharge"
                extra="Technicians can charge more, never less."
                rules={[{ required: true, message: "Enter the charge" }]}
              >
                <InputNumber min={0} step={50} prefix="₹" style={{ width: "100%" }} />
              </Form.Item>
            )
          }
        </Form.Item>
      </FormModal>
    </Page>
  );
}
