import { cloneElement, useState, type ReactElement } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { Alert, App, Button, Form, Input, InputNumber, Select, Table, Typography } from "antd";
import type { Rule } from "antd/es/form";
import { api, ApiError } from "../../api";
import { useSession } from "../../auth/session";
import { useAction, useApi } from "../../lib/hooks";
import { KIND_LABELS } from "../../lib/format";
import FormModal from "../../components/FormModal";
import Page, { Section } from "../../components/Page";
import type { CatalogItem, CatalogKind, MachineType } from "../../types/api";
import { parseSteps, stepsText } from "./steps";

// The catalog entry grid (pivot.md §6.1): the column headers are in place,
// rows are filled a few at a time or pasted from Excel, and the whole batch
// is submitted at once — each row becomes a catalog change for the lead to
// approve (the lead's own apply at once). Opened with { edit: [ids] } it
// holds those items, to change them.
interface Row {
  catalogItemId?: string;
  code?: string;
  name?: string;
  kind: CatalogKind;
  department?: string;
  sampleType?: string;
  container?: string;
  price?: number;
  draws?: string[];
  machines?: string;
  tests?: string[]; // test codes
  instructions?: string;
}

// The grid's columns, in the order a pasted Excel row is read.
const PASTE_COLUMNS = ["Code", "Name", "Kind", "Department", "Sample type", "Container", "Price", "Draws", "Machines", "Tests", "Instructions"];

const blank = (): Row => ({ kind: "test" });
// A row counts once something is typed in it; untouched rows are left out.
const filled = (r?: Row) => !!(r && (r.catalogItemId || r.code || r.name || (r.price !== undefined && r.price !== null)));
const list = (cell = "") => cell.split(",").map((v) => v.trim()).filter(Boolean);

function rowOf(item: CatalogItem): Row {
  return {
    catalogItemId: item.id,
    code: item.code,
    name: item.name,
    kind: item.kind,
    department: item.department ?? undefined,
    sampleType: item.sampleType ?? undefined,
    container: item.container ?? undefined,
    price: Number(item.price),
    draws: item.draws.map((d) => d.label),
    machines: stepsText(item.machineSteps),
    tests: item.components.map((c) => c.test.code),
    instructions: item.instructions ?? undefined,
  };
}

// Tab-separated rows as Excel copies them; a header row is skipped.
function parsePaste(text: string): Row[] {
  return text
    .split(/\r?\n/)
    .filter((line) => line.trim())
    .map((line) => line.split("\t").map((cell) => cell.trim()))
    .filter((cells) => cells[0].toLowerCase() !== "code")
    .map(([code, name, kind = "", department, sampleType, container, price, draws, machines, tests, instructions]) => ({
      code: code.toUpperCase(),
      name,
      kind: (["test", "profile", "service"].includes(kind.toLowerCase()) ? kind.toLowerCase() : "test") as CatalogKind,
      department: department || undefined,
      sampleType: sampleType || undefined,
      container: container || undefined,
      price: price === undefined || price === "" ? undefined : Number(price.replace(/[₹,\s]/g, "")),
      draws: list(draws),
      machines: machines || undefined,
      tests: list(tests).map((t) => t.toUpperCase()),
      instructions: instructions || undefined,
    }));
}

export default function CatalogEntryPage() {
  const { user } = useSession();
  const { message } = App.useApp();
  const navigate = useNavigate();
  const editIds: string[] = useLocation().state?.edit ?? [];
  const catalog = useApi<{ items: CatalogItem[] }>("/catalog");
  const types = useApi<{ types: MachineType[] }>("/machines/types");
  if (!catalog.data || !types.data) return null;
  const initial = editIds.length ? catalog.data.items.filter((i) => editIds.includes(i.id)).map(rowOf) : [blank(), blank(), blank()];
  return <Grid key={editIds.join()} items={catalog.data.items} types={types.data.types} initial={initial} isLead={user!.role === "lead_pathologist"} onDone={(text) => { message.success(text); navigate("/catalog"); }} />;
}

function Grid({ items, types, initial, isLead, onDone }: { items: CatalogItem[]; types: MachineType[]; initial: Row[]; isLead: boolean; onDone(text: string): void }) {
  const [form] = Form.useForm<{ rows: Row[] }>();
  const rows = Form.useWatch("rows", form) ?? initial;
  const [errors, setErrors] = useState<string[]>([]);
  const [pasting, setPasting] = useState(false);
  const tests = items.filter((i) => i.kind === "test");
  const editing = initial.some((r) => r.catalogItemId);

  const [submit, busy] = useAction(async ({ rows }: { rows: Row[] }) => {
    setErrors([]);
    const used = rows.filter(filled);
    if (!used.length) throw new Error("Fill in at least one row.");
    const changes = used.map((r) => ({
      action: r.catalogItemId ? "update" : "create",
      catalogItemId: r.catalogItemId,
      values: {
        code: r.code,
        name: r.name,
        kind: r.kind,
        price: r.price,
        department: r.department,
        sampleType: r.sampleType,
        container: r.container,
        instructions: r.instructions,
        draws: r.kind === "test" ? r.draws : [],
        machineSteps: r.kind === "test" ? parseSteps(r.machines, types) : [],
        components: r.kind === "profile" ? (r.tests ?? []).map((code) => tests.find((t) => t.code === code)!.id) : [],
      },
    }));
    try {
      await api("/catalog/changes", { method: "POST", body: { changes } });
    } catch (e) {
      const rowErrors = e instanceof ApiError ? (e.body as { rows?: { row: number | null; error: string }[] })?.rows : undefined;
      if (!rowErrors) throw e;
      setErrors(rowErrors.map((r) => (r.row === null ? r.error : `Row ${rows.indexOf(used[r.row]) + 1}: ${r.error}`)));
      return;
    }
    const n = changes.length;
    onDone(isLead ? `${n} catalog item${n === 1 ? " is" : "s are"} saved.` : `${n} change${n === 1 ? " is" : "s are"} sent to the lead for approval.`);
  });

  const addPasted = async ({ text }: { text: string }) => {
    const pasted = parsePaste(text);
    if (!pasted.length) throw new Error("Nothing to add: paste rows copied from Excel.");
    const kept = form.getFieldValue("rows").filter(filled);
    form.setFieldValue("rows", [...kept, ...pasted]);
  };

  // One grid cell: a field of row `name`, labelled for screen readers.
  const cell = (name: number, field: keyof Row, label: string, input: ReactElement<{ "aria-label"?: string }>, rules: Rule[] = []) => (
    <Form.Item name={[name, field]} rules={rules} style={{ margin: 0 }}>
      {cloneElement(input, { "aria-label": `Row ${name + 1} ${label}` })}
    </Form.Item>
  );

  return (
    <Page
      title={editing ? "Edit catalog items" : "Add catalog items"}
      description={isLead ? "Your changes apply as soon as you save them." : "Each row goes to the lead pathologist for approval before it reaches the catalog."}
      actions={
        <>
          <Button onClick={() => setPasting(true)}>Paste from Excel</Button>
          <Button type="primary" loading={busy} onClick={() => form.submit()}>
            {isLead ? "Save" : "Submit for approval"}
          </Button>
        </>
      }
    >
      {errors.length > 0 && (
        <Alert type="error" showIcon title="Nothing was saved. Fix these rows and submit again:" description={<ul style={{ margin: 0, paddingInlineStart: 20 }}>{errors.map((e) => <li key={e}>{e}</li>)}</ul>} />
      )}
      <Form form={form} initialValues={{ rows: initial }} onFinish={submit} component="div">
        <Form.List name="rows">
          {(fields, { add, remove }) => (
            <Section flush>
              <Table
                rowKey="key"
                size="small"
                pagination={false}
                dataSource={fields}
                scroll={{ x: "max-content" }}
                footer={() => (
                  <Button onClick={() => add(blank())} disabled={editing}>
                    Add row
                  </Button>
                )}
                columns={[
                  {
                    title: "#",
                    width: 40,
                    render: (_, f) => (
                      <>
                        {f.name + 1}
                        <Form.Item name={[f.name, "catalogItemId"]} hidden>
                          <Input />
                        </Form.Item>
                      </>
                    ),
                  },
                  { title: "Code", width: 120, render: (_, f) => cell(f.name, "code", "code", <Input />, [{ required: filled(rows[f.name]), message: "Required" }]) },
                  { title: "Name", width: 220, render: (_, f) => cell(f.name, "name", "name", <Input />, [{ required: filled(rows[f.name]), message: "Required" }]) },
                  {
                    title: "Kind",
                    width: 110,
                    render: (_, f) => cell(f.name, "kind", "kind", <Select disabled={!!rows[f.name]?.catalogItemId} options={Object.entries(KIND_LABELS).map(([value, label]) => ({ value, label }))} />),
                  },
                  { title: "Department", width: 140, render: (_, f) => cell(f.name, "department", "department", <Input />) },
                  { title: "Sample type", width: 120, render: (_, f) => cell(f.name, "sampleType", "sample type", <Input disabled={rows[f.name]?.kind === "service"} />) },
                  { title: "Container", width: 120, render: (_, f) => cell(f.name, "container", "container", <Input disabled={rows[f.name]?.kind === "service"} />) },
                  {
                    title: "Price (₹)",
                    width: 110,
                    render: (_, f) => cell(f.name, "price", "price", <InputNumber min={0} style={{ width: "100%" }} />, [{ required: filled(rows[f.name]), message: "Required" }]),
                  },
                  {
                    title: "Draws",
                    width: 180,
                    render: (_, f) =>
                      cell(f.name, "draws", "draws", <Select mode="tags" tokenSeparators={[","]} open={false} suffixIcon={null} placeholder={rows[f.name]?.kind === "test" ? "Single" : undefined} disabled={rows[f.name]?.kind !== "test"} />),
                  },
                  {
                    title: "Machines",
                    width: 220,
                    render: (_, f) =>
                      cell(f.name, "machines", "machines", <Input disabled={rows[f.name]?.kind !== "test"} />, [
                        {
                          validator: async (_: unknown, value: string) => {
                            parseSteps(value, types);
                          },
                        },
                      ]),
                  },
                  {
                    title: "Tests (profiles)",
                    width: 220,
                    render: (_, f) =>
                      cell(
                        f.name,
                        "tests",
                        "tests",
                        <Select mode="multiple" showSearch={{ optionFilterProp: "label" }} disabled={rows[f.name]?.kind !== "profile"} options={tests.map((t) => ({ value: t.code, label: `${t.code} · ${t.name}` }))} />,
                        [
                          {
                            validator: async (_: unknown, value: string[] = []) => {
                              if (rows[f.name]?.kind !== "profile" || !filled(rows[f.name])) return;
                              if (!value.length) throw new Error("Choose its tests");
                              const unknown = value.find((code) => !tests.some((t) => t.code === code));
                              if (unknown) throw new Error(`${unknown} isn't an active test`);
                            },
                          },
                        ]
                      ),
                  },
                  { title: "Patient instructions", width: 240, render: (_, f) => cell(f.name, "instructions", "patient instructions", <Input />) },
                  {
                    title: "",
                    width: 80,
                    render: (_, f) => (
                      <Button type="link" size="small" danger onClick={() => remove(f.name)} aria-label={`Remove row ${f.name + 1}`}>
                        Remove
                      </Button>
                    ),
                  },
                ]}
              />
            </Section>
          )}
        </Form.List>
      </Form>
      <Typography.Text type="secondary">
        Draws: the sample labels in order, e.g. "Fasting, 1 h, 2 h"; empty means one sample. Machines: the machine types
        a test runs on, in order, separated by "&gt;"; machines that run at the same time are joined with "+".
      </Typography.Text>

      <FormModal title="Paste from Excel" okText="Add rows" open={pasting} onSubmit={addPasted} onClose={() => setPasting(false)}>
        <Typography.Paragraph type="secondary">
          Copy the rows in Excel and paste them here. The columns must be in this order: {PASTE_COLUMNS.join(", ")}. A header row is skipped.
        </Typography.Paragraph>
        <Form.Item label="Rows" name="text" rules={[{ required: true, message: "Paste the rows" }]}>
          <Input.TextArea autoSize={{ minRows: 6, maxRows: 14 }} />
        </Form.Item>
      </FormModal>
    </Page>
  );
}
