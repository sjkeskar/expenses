// The parts of a quotation and a bill that are the same order (pivot.md
// §6.4–6.5): where and how the patient is seen, who referred them, who pays,
// and the items. Prices always come from the server's pricing function
// (POST /bills/preview), never from the client.
import { useEffect, useRef, useState } from "react";
import { Alert, App, Button, Col, Flex, Form, InputNumber, Radio, Row, Select, Table, Tag, Typography, type FormInstance } from "antd";
import { api } from "../../api";
import { useApi } from "../../lib/hooks";
import { formatMoney, KIND_LABELS } from "../../lib/format";
import { COL, NOWRAP, Section } from "../../components/Page";
import type { Camp, CatalogItem, CollectionMode, Doctor, Location, Panel, PayerType, Preview, ReferralType } from "../../types/api";

export interface OrderValues {
  locationId?: string;
  collectionMode: CollectionMode;
  homeVisitCharge?: number;
  referralType: ReferralType;
  referringDoctorId?: string;
  payerType: PayerType;
  panelId?: string;
  campId?: string;
  itemIds: string[];
  discountAmount?: number;
}

export const ORDER_DEFAULTS: Partial<OrderValues> = { collectionMode: "at_location", referralType: "walk_in", payerType: "self", itemIds: [] };

export interface Lookups {
  locations: Location[];
  doctors: Doctor[];
  panels: Panel[];
  camps: Camp[];
  catalog: CatalogItem[];
}

// Everything the order form picks from; undefined until all have loaded.
export function useLookups(): Lookups | undefined {
  const locations = useApi<{ locations: Location[] }>("/locations");
  const doctors = useApi<{ doctors: Doctor[] }>("/doctors");
  const panels = useApi<{ panels: Panel[] }>("/panels");
  const camps = useApi<{ camps: Camp[] }>("/camps");
  const catalog = useApi<{ items: CatalogItem[] }>("/catalog");
  if (!locations.data || !doctors.data || !panels.data || !camps.data || !catalog.data) return undefined;
  return { locations: locations.data.locations, doctors: doctors.data.doctors, panels: panels.data.panels, camps: camps.data.camps, catalog: catalog.data.items };
}

// The order as the API takes it (POST /quotations, /bills, /bills/preview).
export const orderBody = (v: OrderValues) => ({
  locationId: v.locationId,
  collectionMode: v.collectionMode,
  homeVisitCharge: v.collectionMode === "home_visit" ? v.homeVisitCharge : undefined,
  referralType: v.referralType,
  referringDoctorId: v.referralType === "doctor" ? v.referringDoctorId : undefined,
  payerType: v.payerType,
  panelId: v.payerType === "panel" ? v.panelId : undefined,
  campId: v.payerType === "panel" ? v.campId : undefined,
  itemIds: v.itemIds,
  discountAmount: v.discountAmount ?? 0,
});

// Keeps dependent fields consistent as the form changes: a camp fixes the
// location, a self-pay order has no panel, a walk-in no doctor, and a
// location without a home-visit charge doesn't offer home visits.
export function syncOrder(changed: Partial<OrderValues>, form: FormInstance, lookups: Lookups) {
  if (changed.payerType === "self") form.setFieldsValue({ panelId: undefined, campId: undefined });
  if ("panelId" in changed) form.setFieldsValue({ campId: undefined });
  if (changed.referralType === "walk_in") form.setFieldsValue({ referringDoctorId: undefined });
  if (changed.campId) form.setFieldsValue({ locationId: lookups.camps.find((c) => c.id === changed.campId)?.location.id });
  const location = lookups.locations.find((l) => l.id === form.getFieldValue("locationId"));
  if (("locationId" in changed || "campId" in changed) && location) {
    if (location.homeVisitCharge === null) form.setFieldsValue({ collectionMode: "at_location" });
    form.setFieldsValue({ homeVisitCharge: location.homeVisitCharge === null ? undefined : Number(location.homeVisitCharge) });
  }
}

// The branch or centre this PC last used, so the next order starts there
// (a per-PC convenience; browser storage may be unavailable).
const LAST_LOCATION = "lastLocationId";
export function rememberLocation(id: string | undefined) {
  try {
    if (id) localStorage.setItem(LAST_LOCATION, id);
  } catch {
    // not remembered, that's all
  }
}

// Starts a new order at the last-used location, or the only one there is.
export function useStartingLocation(form: FormInstance, lookups: Lookups, skip?: boolean) {
  useEffect(() => {
    if (skip) return;
    let last: string | null = null;
    try {
      last = localStorage.getItem(LAST_LOCATION);
    } catch {
      // ignore
    }
    const location = lookups.locations.find((l) => l.id === last) ?? (lookups.locations.length === 1 ? lookups.locations[0] : undefined);
    if (location) {
      form.setFieldValue("locationId", location.id);
      syncOrder({ locationId: location.id }, form, lookups);
    }
  }, [form, lookups, skip]);
}

// Prices the order on the server as it changes (debounced). `body` null
// means there's nothing to price yet.
export function usePreview(body: object | null) {
  const [preview, setPreview] = useState<Preview>();
  const [error, setError] = useState<string>();
  const key = body && JSON.stringify(body);
  const latest = useRef<string | null>(null);
  useEffect(() => {
    latest.current = key;
    if (!key) {
      setPreview(undefined);
      setError(undefined);
      return;
    }
    const timer = setTimeout(async () => {
      try {
        const result = await api<Preview>("/bills/preview", { method: "POST", body: JSON.parse(key) });
        if (latest.current === key) {
          setPreview(result);
          setError(undefined);
        }
      } catch (e) {
        if (latest.current === key) {
          setPreview(undefined);
          setError((e as Error).message);
        }
      }
    }, 250);
    return () => clearTimeout(timer);
  }, [key]);
  return { preview, error };
}

// Where and how: the branch or centre, and a home visit with its charge
// (at least the location's; the technician may raise it, pivot.md §4.3).
export function VisitFields({ lookups, locked, children }: { lookups: Lookups; locked?: boolean; children?: React.ReactNode }) {
  return (
    <Form.Item noStyle dependencies={["locationId", "campId", "collectionMode"]}>
      {({ getFieldValue }) => {
        const location = lookups.locations.find((l) => l.id === getFieldValue("locationId"));
        const homeVisit = getFieldValue("collectionMode") === "home_visit";
        return (
          <Row gutter={16}>
            <Col {...COL.wide}>
              <Form.Item
                label="Branch or centre"
                name="locationId"
                extra={getFieldValue("campId") ? "A camp's orders use the camp's location." : undefined}
                rules={[{ required: true, message: "Choose where the patient is seen" }]}
              >
                <Select disabled={locked || !!getFieldValue("campId")} showSearch={{ optionFilterProp: "label" }} options={lookups.locations.map((l) => ({ value: l.id, label: l.name }))} />
              </Form.Item>
            </Col>
            <Col {...COL.narrow}>
              <Form.Item label="Collection" name="collectionMode" required>
                <Radio.Group
                  disabled={locked}
                  options={[
                    { value: "at_location", label: "At the location" },
                    { value: "home_visit", label: "Home visit", disabled: !location || location.homeVisitCharge === null },
                  ]}
                />
              </Form.Item>
            </Col>
            {homeVisit && location?.homeVisitCharge != null && (
              <Col {...COL.narrow}>
                <Form.Item
                  label="Home-visit charge"
                  name="homeVisitCharge"
                  extra={`At least ${formatMoney(location.homeVisitCharge)}. Lower it only through the discount.`}
                  rules={[{ required: true, message: "Enter the charge" }]}
                >
                  <InputNumber disabled={locked} min={Number(location.homeVisitCharge)} step={50} prefix="₹" style={{ width: "100%" }} />
                </Form.Item>
              </Col>
            )}
            {children}
          </Row>
        );
      }}
    </Form.Item>
  );
}

// Who referred the patient, and who pays (pivot.md §4.5).
export function ReferralPayerFields({ lookups, locked }: { lookups: Lookups; locked?: boolean }) {
  return (
    <Form.Item noStyle dependencies={["referralType", "payerType", "panelId"]}>
      {({ getFieldValue }) => {
        const panelId = getFieldValue("panelId");
        const camps = lookups.camps.filter((c) => c.panel.id === panelId && c.running);
        return (
          <Row gutter={16}>
            <Col {...COL.narrow}>
              <Form.Item label="Referral" name="referralType" required>
                <Radio.Group disabled={locked} options={[{ value: "walk_in", label: "Walk-in" }, { value: "doctor", label: "Doctor" }]} />
              </Form.Item>
            </Col>
            <Col {...COL.narrow}>
              <Form.Item label="Payer" name="payerType" required>
                <Radio.Group disabled={locked} options={[{ value: "self", label: "Self" }, { value: "panel", label: "Panel" }]} />
              </Form.Item>
            </Col>
            {getFieldValue("referralType") === "doctor" && (
              <Col {...COL.wide}>
                <Form.Item label="Referring doctor" name="referringDoctorId" extra="A doctor awaiting approval holds the report until the lead approves them.">
                  <Select
                    disabled={locked}
                    allowClear
                    showSearch={{ optionFilterProp: "label" }}
                    options={lookups.doctors.map((d) => ({ value: d.id, label: `${d.name}${d.clinic ? `, ${d.clinic}` : ""}${d.status === "pending" ? " (awaiting approval)" : ""}` }))}
                  />
                </Form.Item>
              </Col>
            )}
            {getFieldValue("payerType") === "panel" && (
              <>
                <Col {...COL.wide}>
                  <Form.Item label="Panel" name="panelId" rules={[{ required: true, message: "Choose the panel" }]}>
                    <Select disabled={locked} showSearch={{ optionFilterProp: "label" }} options={lookups.panels.map((p) => ({ value: p.id, label: p.name }))} />
                  </Form.Item>
                </Col>
                <Col {...COL.wide}>
                  <Form.Item label="Camp" name="campId" extra={panelId && !camps.length ? "This panel has no camp running now." : "Only a camp running now can be chosen."}>
                    <Select disabled={locked || !camps.length} allowClear options={camps.map((c) => ({ value: c.id, label: `${c.name}${c.venue ? `, ${c.venue}` : ""}` }))} />
                  </Form.Item>
                </Col>
              </>
            )}
          </Row>
        );
      }}
    </Form.Item>
  );
}

// The items, priced by the server. A profile lists its tests; the overlap
// warning says when a test would be billed twice (pivot.md §4.6).
export function ItemsSection({ lookups, preview, error, locked, title = "Tests and services" }: { lookups: Lookups; preview?: Preview; error?: string; locked?: boolean; title?: string }) {
  const form = Form.useFormInstance();
  const itemIds: string[] = Form.useWatch("itemIds", form) ?? [];
  const priced = new Map(preview?.lines.map((l) => [l.catalogItemId, l]));
  const homeVisit = preview?.lines.find((l) => l.code === "HOMEVISIT");
  const rows = [
    ...itemIds.map((id) => lookups.catalog.find((i) => i.id === id)).filter((i): i is CatalogItem => !!i).map((item) => ({ key: item.id, item, code: item.code, name: item.name, kind: item.kind })),
    ...(homeVisit ? [{ key: "homevisit", item: undefined, code: homeVisit.code, name: homeVisit.name, kind: homeVisit.kind }] : []),
  ];
  const add = (ids: string[]) => form.setFieldValue("itemIds", [...itemIds, ...ids.filter((id) => !itemIds.includes(id))]);
  const remove = (id: string) => form.setFieldValue("itemIds", itemIds.filter((i) => i !== id));
  const toggle = (id: string) => (itemIds.includes(id) ? remove(id) : add([id]));

  return (
    <Section
      title={title}
      flush
      toolbar={
        !locked && (
          <Flex vertical gap={12} style={{ width: "100%" }}>
            <QuickTiles catalog={lookups.catalog} chosen={itemIds} onToggle={toggle} />
            <Form.Item name="itemIds" rules={[{ type: "array", min: 1, message: "Add at least one test, profile or service" }]} style={{ margin: 0, maxWidth: 560 }}>
              <AddItem catalog={lookups.catalog} chosen={itemIds} onAdd={add} />
            </Form.Item>
          </Flex>
        )
      }
    >
      {(error || preview?.warnings.length || (itemIds.length > 0 && !preview && !form.getFieldValue("locationId"))) && (
        <Flex vertical gap={8} style={{ padding: "16px 24px 0" }}>
          {!form.getFieldValue("locationId") && <Alert type="info" showIcon title="Choose the branch or centre to see the prices." />}
          {error && <Alert type="error" showIcon title={error} />}
          {preview?.warnings.map((w) => <Alert key={w} type="warning" showIcon title={w} />)}
        </Flex>
      )}
      <Table
        rowKey="key"
        size="middle"
        pagination={false}
        dataSource={rows}
        locale={{ emptyText: "No items yet" }}
        columns={[
          { title: "Code", dataIndex: "code", ...NOWRAP },
          {
            title: "Name",
            render: (_, r) => (
              <>
                {r.name}
                {r.item?.kind === "profile" && (
                  <Typography.Text type="secondary" style={{ display: "block", fontSize: 12 }}>
                    {r.item.components.map((c) => c.test.code).sort().join(", ")}
                  </Typography.Text>
                )}
              </>
            ),
          },
          { title: "Kind", dataIndex: "kind", render: (k: keyof typeof KIND_LABELS) => <Tag>{KIND_LABELS[k]}</Tag>, ...NOWRAP },
          {
            title: "Price",
            align: "right",
            ...NOWRAP,
            render: (_, r) => {
              const line = r.item ? priced.get(r.item.id) : homeVisit;
              return line ? formatMoney(line.price) : "—";
            },
          },
          ...(locked
            ? []
            : [
                {
                  title: "",
                  ...NOWRAP,
                  render: (_: unknown, r: (typeof rows)[number]) =>
                    r.item && (
                      <Button type="link" size="small" danger onClick={() => remove(r.item!.id)}>
                        Remove
                      </Button>
                    ),
                },
              ]),
        ]}
      />
    </Section>
  );
}

// The most used items as a grid of tiles (GET /catalog/popular): a click
// adds one, a second click takes it off. A test already covered by a chosen
// profile says so, before it's billed twice.
function QuickTiles({ catalog, chosen, onToggle }: { catalog: CatalogItem[]; chosen: string[]; onToggle(id: string): void }) {
  const popular = useApi<{ items: Pick<CatalogItem, "id" | "code" | "name" | "kind">[]; days: number }>("/catalog/popular");
  if (!popular.data?.items.length) return null;
  const chosenProfiles = catalog.filter((i) => i.kind === "profile" && chosen.includes(i.id));
  const coveredBy = (id: string) => chosenProfiles.find((p) => p.components.some((c) => c.test.id === id))?.code;

  return (
    <div role="group" aria-label="Most used tests and services">
      <Typography.Text type="secondary" style={{ display: "block", marginBottom: 8, fontSize: 12 }}>
        Most used in the last {popular.data.days} days
      </Typography.Text>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))", gap: 8 }}>
        {popular.data.items.map((item) => {
          const on = chosen.includes(item.id);
          const covered = !on && coveredBy(item.id);
          const note = covered ? `in ${covered}` : item.kind === "profile" ? "Profile" : item.kind === "service" ? "Service" : "";
          return (
            <Button
              key={item.id}
              type={on ? "primary" : "default"}
              aria-pressed={on}
              title={item.name}
              onClick={() => onToggle(item.id)}
              style={{ height: "auto", minHeight: 56, padding: "6px 10px", display: "flex", flexDirection: "column", alignItems: "flex-start", justifyContent: "flex-start", gap: 0 }}
            >
              <span style={{ fontWeight: 600 }}>
                {item.code}
                {on && " ✓"}
              </span>
              <span style={{ fontSize: 12, maxWidth: "100%", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{item.name}</span>
              {note && <span style={{ fontSize: 11, fontStyle: covered ? "italic" : undefined }}>{note}</span>}
            </Button>
          );
        })}
      </div>
    </div>
  );
}

// A search box that adds the chosen catalog item and clears itself. Several
// codes typed at once ("CBC TSH LFT") and Enter add them all; codes that
// aren't in the catalog are named.
function AddItem({ catalog, chosen, onAdd }: { catalog: CatalogItem[]; chosen: string[]; onAdd(ids: string[]): void; value?: unknown; onChange?: unknown }) {
  const { message } = App.useApp();
  const [text, setText] = useState("");
  const onKey = (e: React.KeyboardEvent) => {
    const codes = text.toUpperCase().split(/[\s,]+/).filter(Boolean);
    if (e.key !== "Enter" || codes.length < 2) return;
    e.preventDefault();
    e.stopPropagation();
    const found = codes.map((code) => catalog.find((i) => i.code === code));
    const unknown = codes.filter((_, i) => !found[i]);
    onAdd(found.filter((i): i is CatalogItem => !!i).map((i) => i.id));
    if (unknown.length) message.warning(`Not in the catalog: ${unknown.join(", ")}`);
    setText("");
  };
  return (
    <Select
      aria-label="Add a test, profile or service"
      placeholder="Add by code or name; several codes at once: CBC TSH LFT, then Enter"
      showSearch={{ optionFilterProp: "label", searchValue: text, onSearch: setText }}
      value={null}
      onChange={(id: string) => {
        onAdd([id]);
        setText("");
      }}
      onInputKeyDown={onKey}
      style={{ width: "100%" }}
      options={catalog.filter((i) => !chosen.includes(i.id)).map((i) => ({ value: i.id, label: `${i.code} · ${i.name} · ${formatMoney(i.price)}` }))}
    />
  );
}
