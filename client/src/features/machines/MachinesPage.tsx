import { useState } from "react";
import { App, Button, Form, Input, Popconfirm, Select, Table } from "antd";
import { api } from "../../api";
import { useAction, useApi } from "../../lib/hooks";
import FormModal from "../../components/FormModal";
import Page, { NOWRAP, Section } from "../../components/Page";
import type { Location, Machine, MachineType } from "../../types/api";

// Machine types and machines (pivot.md §4.6): a test requires a machine
// type, and any machine of that type at the processing branch can run it.
// Availability and downtime come with the lab calendar (§10).
export default function MachinesPage() {
  const { message } = App.useApp();
  const types = useApi<{ types: MachineType[] }>("/machines/types");
  const machines = useApi<{ machines: Machine[] }>("/machines");
  const locations = useApi<{ locations: Location[] }>("/locations");
  const [adding, setAdding] = useState<"type" | "machine">();
  const reload = () => Promise.all([types.reload(), machines.reload()]);

  const [remove] = useAction(async (path: string, name: string) => {
    await api(path, { method: "DELETE" });
    message.success(`${name} is removed.`);
    await reload();
  });
  const addType = async ({ name }: { name: string }) => {
    await api("/machines/types", { method: "POST", body: { name } });
    message.success(`${name.trim()} is added.`);
    await reload();
  };
  const addMachine = async (values: { name: string; machineTypeId: string; branchId: string }) => {
    await api("/machines", { method: "POST", body: values });
    message.success(`${values.name.trim()} is added.`);
    await reload();
  };

  const removeButton = (path: string, name: string, description: string) => (
    <Popconfirm title={`Remove ${name}?`} description={description} okText="Remove" onConfirm={() => remove(path, name)}>
      <Button type="link" size="small" danger>
        Remove
      </Button>
    </Popconfirm>
  );

  return (
    <Page title="Machines" description="The kinds of machine tests need, and the machines at each branch.">
      <Section title="Machine types" flush extra={<Button onClick={() => setAdding("type")}>Add machine type</Button>}>
        <Table<MachineType>
          rowKey="id"
          size="middle"
          pagination={false}
          loading={!types.data && !types.error}
          dataSource={types.data?.types}
          columns={[
            { title: "Name", dataIndex: "name" },
            { title: "Machines", render: (_, t) => machines.data?.machines.filter((m) => m.machineType.id === t.id).length ?? "—", ...NOWRAP },
            { title: "Actions", ...NOWRAP, render: (_, t) => removeButton(`/machines/types/${t.id}`, t.name, "Tests already using it keep it.") },
          ]}
        />
      </Section>
      <Section title="Machines" flush extra={<Button onClick={() => setAdding("machine")}>Add machine</Button>}>
        <Table<Machine>
          rowKey="id"
          size="middle"
          pagination={false}
          loading={!machines.data && !machines.error}
          dataSource={machines.data?.machines}
          columns={[
            { title: "Name", dataIndex: "name" },
            { title: "Type", render: (_, m) => m.machineType.name },
            { title: "Branch", render: (_, m) => m.branch.name },
            { title: "Actions", ...NOWRAP, render: (_, m) => removeButton(`/machines/${m.id}`, m.name, "It is no longer listed at its branch.") },
          ]}
        />
      </Section>

      <FormModal title="Add machine type" okText="Add" open={adding === "type"} onSubmit={addType} onClose={() => setAdding(undefined)}>
        <Form.Item label="Name" name="name" extra='For example "Haematology analyser".' rules={[{ required: true, whitespace: true, message: "Enter a name" }]}>
          <Input />
        </Form.Item>
      </FormModal>
      <FormModal title="Add machine" okText="Add" open={adding === "machine"} onSubmit={addMachine} onClose={() => setAdding(undefined)}>
        <Form.Item label="Name" name="name" rules={[{ required: true, whitespace: true, message: "Enter a name" }]}>
          <Input />
        </Form.Item>
        <Form.Item label="Type" name="machineTypeId" rules={[{ required: true, message: "Choose its type" }]}>
          <Select showSearch={{ optionFilterProp: "label" }} options={types.data?.types.map((t) => ({ value: t.id, label: t.name }))} />
        </Form.Item>
        <Form.Item label="Branch" name="branchId" extra="Machines belong to a processing branch." rules={[{ required: true, message: "Choose the branch" }]}>
          <Select
            showSearch={{ optionFilterProp: "label" }}
            options={locations.data?.locations.filter((l) => l.type === "branch").map((l) => ({ value: l.id, label: l.name }))}
          />
        </Form.Item>
      </FormModal>
    </Page>
  );
}
