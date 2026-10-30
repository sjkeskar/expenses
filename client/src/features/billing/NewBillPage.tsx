import { useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Alert, App, Button, Col, DatePicker, Flex, Form, Input, InputNumber, Row, Select, Switch, Table, Typography } from "antd";
import { api } from "../../api";
import { useAction, useApi } from "../../lib/hooks";
import { DATE_TIME, dayOf, dayPicker, formatMoney, fromPicker, istNow, istToday, MODE_OPTIONS, paise, type Dayjs } from "../../lib/format";
import Page, { COL, Figures, NOWRAP, Section } from "../../components/Page";
import type { Bill, CatalogItem, Patient, PaymentMode, Quotation } from "../../types/api";
import PatientPicker from "../patients/PatientPicker";
import { guessFromSearch, LookalikeChoice, lookalikesIn, PatientFields, registerPatient, type PatientValues } from "../patients/PatientFields";
import { ItemsSection, ORDER_DEFAULTS, orderBody, ReferralPayerFields, rememberLocation, syncOrder, useLookups, usePreview, useStartingLocation, VisitFields, type Lookups, type OrderValues } from "./order";

// Create bill (pivot.md §6.5): patient, place, referral, payer, items, the
// samples taken now or due on a revisit, discount, report time and a
// payment. Opened with ?quotation=<id> it converts that quotation: the order
// comes from the quote, at its prices. ?patient=<id> preselects the patient.
interface BillValues extends OrderValues {
  newPatient?: PatientValues; // when the patient is new, registered as the bill is created
  billDate: Dayjs;
  homeVisitAddress?: string;
  expectedReportAt?: Dayjs;
  payNow?: number;
  payMode: PaymentMode;
}

export default function NewBillPage() {
  const [params] = useSearchParams();
  const lookups = useLookups();
  const quote = useApi<{ quotation: Quotation }>(params.get("quotation") ? `/quotations/${params.get("quotation")}` : null);
  const patient = useApi<{ patient: Patient }>(params.get("patient") ? `/patients/${params.get("patient")}` : null);
  if (!lookups || (params.get("quotation") && !quote.data) || (params.get("patient") && !patient.data)) return null;
  return <BillForm lookups={lookups} quotation={quote.data?.quotation} initialPatient={patient.data?.patient ?? quote.data?.quotation.patient ?? undefined} />;
}

// One row per sample draw of each test on the bill; a profile's tests are
// listed separately, so part of it can wait for a revisit (pivot.md §4.8).
interface Draw {
  key: string;
  catalogItemId: string;
  itemCode: string;
  test: CatalogItem;
  sequence: number;
  label: string;
}

function drawsOf(itemIds: string[], catalog: CatalogItem[]): Draw[] {
  return itemIds.flatMap((id) => {
    const item = catalog.find((i) => i.id === id);
    if (!item) return [];
    const tests = item.kind === "profile" ? item.components.map((c) => catalog.find((t) => t.id === c.test.id)).filter((t): t is CatalogItem => !!t) : item.kind === "test" ? [item] : [];
    return tests.flatMap((test) =>
      test.draws.map((d) => ({ key: `${id}:${test.id}:${d.sequence}`, catalogItemId: id, itemCode: item.code, test, sequence: d.sequence, label: d.label }))
    );
  });
}

function BillForm({ lookups, quotation, initialPatient }: { lookups: Lookups; quotation?: Quotation; initialPatient?: Patient }) {
  const { message } = App.useApp();
  const navigate = useNavigate();
  const [form] = Form.useForm<BillValues>();
  const values = Form.useWatch((v) => v, form) as BillValues | undefined;
  const [patient, setPatient] = useState<Patient | undefined>(initialPatient);
  // Most walk-ins are new, so a new patient's fields show unless the patient
  // is already known; "Search registered patients" switches to the search.
  const [adding, setAdding] = useState(!initialPatient); // a new patient's fields are showing
  const [lookalikes, setLookalikes] = useState<Patient[]>();
  const distinct = useRef(false); // "Different person" was chosen for the look-alikes
  const [later, setLater] = useState<Record<string, Dayjs | null>>({});

  // A quote's items, as catalog ids (its home-visit line comes back from the preview).
  const quoted: Partial<BillValues> | undefined = quotation && {
    locationId: quotation.location.id,
    collectionMode: quotation.collectionMode,
    referralType: quotation.referralType,
    referringDoctorId: quotation.referringDoctor?.id,
    payerType: quotation.payerType,
    panelId: quotation.panel?.id,
    campId: quotation.camp?.id ?? undefined,
    itemIds: quotation.items.filter((i) => i.code !== "HOMEVISIT").map((i) => i.catalogItemId),
    discountAmount: Number(quotation.discountAmount),
  };
  useStartingLocation(form, lookups, !!quotation);
  const quotedFor = quotation && !quotation.patientId ? { name: quotation.patientName, phone: quotation.patientPhone ?? undefined } : {};

  const ready = values && values.itemIds?.length && values.locationId;
  const { preview, error } = usePreview(
    quotation ? { quotationId: quotation.id } : ready ? { ...orderBody(values), billDate: values.billDate && dayOf(values.billDate) } : null
  );
  const draws = drawsOf(values?.itemIds ?? quoted?.itemIds ?? [], lookups.catalog);
  const netPaise = preview ? paise(preview.netAmount) : 0;

  // A new patient: the search text fills their name or phone (a quotation's
  // name and phone, when converting one for someone not yet registered).
  const addPatient = (typed: string) => {
    form.setFieldValue("newPatient", { by: "age", ...quotedFor, ...guessFromSearch(typed) });
    setPatient(undefined);
    setAdding(true);
  };
  const choosePatient = (p: Patient | undefined) => {
    setPatient(p);
    setAdding(false);
    setLookalikes(undefined);
  };

  // Registers the new patient (or finds them, if already registered with
  // the same details). A probable look-alike stops here and is shown in the
  // Patient section; the rest of the form stays as it is.
  const registerNew = async (values: PatientValues) => {
    try {
      const { patient: registered, existed } = await registerPatient(values, distinct.current);
      if (existed) message.info(`${registered.name} was already registered (${registered.patientNumber}).`);
      choosePatient(registered);
      return registered;
    } catch (e) {
      const similar = lookalikesIn(e);
      if (!similar) throw e;
      setLookalikes(similar);
      message.warning("Check the patient first: they may already be registered.");
      return undefined;
    } finally {
      distinct.current = false;
    }
  };

  const [create, busy] = useAction(async (v: BillValues) => {
    const missing = draws.find((d) => d.key in later && !later[d.key]);
    if (missing) throw new Error(`Enter when the patient comes back for ${missing.test.code} (${missing.label}).`);
    if (!patient && !adding) throw new Error("Choose the patient, or add a new one.");
    const billed = patient ?? (await registerNew(v.newPatient!));
    if (!billed) return;
    const body = {
      ...(quotation ? { quotationId: quotation.id } : { ...orderBody(v), billDate: dayOf(v.billDate) }),
      patientId: billed.id,
      homeVisitAddress: v.homeVisitAddress,
      pendingDraws: draws.filter((d) => d.key in later).map((d) => ({ catalogItemId: d.catalogItemId, testId: d.test.id, sequence: d.sequence, dueAt: fromPicker(later[d.key]) })),
      expectedReportAt: fromPicker(v.expectedReportAt),
      initialPayment: v.payNow ? { amount: v.payNow, mode: v.payMode } : undefined,
    };
    const { bill } = await api<{ bill: Bill }>("/bills", { method: "POST", body });
    rememberLocation(v.locationId);
    message.success(`Bill ${bill.billNumber} is created.`);
    navigate(`/bills/${bill.id}`);
  });

  return (
    <Page
      title={quotation ? `Bill quotation ${quotation.quoteNumber}` : "New bill"}
      description={quotation ? "The quotation's items, payer and prices carry over; add the patient, samples and payment." : "Bill a patient's tests, record the samples taken and take a payment."}
      actions={
        <Button type="primary" loading={busy} onClick={() => form.submit()}>
          Create bill
        </Button>
      }
    >
      <Form
        form={form}
        layout="vertical"
        component={false}
        requiredMark="optional"
        initialValues={{ ...ORDER_DEFAULTS, billDate: dayPicker(istToday()), payMode: "cash", ...quoted, newPatient: { by: "age", ...quotedFor } }}
        onValuesChange={(changed) => syncOrder(changed, form, lookups)}
        onFinish={create}
      >
        {quotation && <Alert type="info" showIcon title={`Converting quotation ${quotation.quoteNumber} for ${quotation.patientName}${quotation.patientPhone ? ` (${quotation.patientPhone})` : ""}. Its items, referral, payer and discount can't change here.`} />}
        <Section title="Patient">
          {adding ? (
            <Flex vertical gap={16}>
              <Flex justify="space-between" align="center" wrap gap={8}>
                <Typography.Text>A new patient, registered when the bill is created.</Typography.Text>
                <Button type="link" style={{ paddingInline: 0 }} onClick={() => choosePatient(undefined)}>
                  Returning patient? Search registered patients
                </Button>
              </Flex>
              {lookalikes && (
                <LookalikeChoice
                  patients={lookalikes}
                  onUse={choosePatient}
                  distinct={
                    <Button
                      size="small"
                      onClick={() => {
                        distinct.current = true;
                        form.submit();
                      }}
                    >
                      Different person
                    </Button>
                  }
                />
              )}
              <PatientFields prefix={["newPatient"]} inline autoFocus />
            </Flex>
          ) : (
            <PatientPicker
              value={patient}
              onChange={choosePatient}
              onNew={addPatient}
              autoFocus
              initialSearch={quotation && !quotation.patientId ? (quotation.patientPhone ?? quotation.patientName) : undefined}
            />
          )}
        </Section>
        <Section title="Visit">
          <VisitFields lookups={lookups} locked={!!quotation}>
            {!quotation && (
              <Col {...COL.narrow}>
                <Form.Item label="Bill date" name="billDate" required extra="Today, unless entering an earlier bill.">
                  <DatePicker format="DD/MM/YYYY" allowClear={false} disabledDate={(d) => d.isAfter(istNow(), "day")} style={{ width: "100%" }} />
                </Form.Item>
              </Col>
            )}
            {values?.collectionMode === "home_visit" && (
              <Col {...COL.full}>
                <Form.Item label="Visit address" name="homeVisitAddress" extra="Leave it empty if the patient prefers not to give it.">
                  <Input.TextArea autoSize={{ minRows: 2 }} />
                </Form.Item>
              </Col>
            )}
          </VisitFields>
        </Section>
        <Section title="Referral and payer">
          <ReferralPayerFields lookups={lookups} locked={!!quotation} />
        </Section>
        <ItemsSection lookups={lookups} preview={preview} error={error} locked={!!quotation} />
        {draws.length > 0 && (
          <Section title="Samples" flush>
            <Table<Draw>
              rowKey="key"
              size="middle"
              pagination={false}
              dataSource={draws}
              columns={[
                { title: "Test", render: (_, d) => `${d.test.code} · ${d.test.name}${d.itemCode !== d.test.code ? ` (in ${d.itemCode})` : ""}` },
                { title: "Sample", dataIndex: "label", ...NOWRAP },
                {
                  title: "Collected now",
                  ...NOWRAP,
                  render: (_, d) => (
                    <Switch
                      aria-label={`${d.test.code} ${d.label} collected now`}
                      checked={!(d.key in later)}
                      onChange={(now) => setLater(({ [d.key]: _, ...rest }) => (now ? rest : { ...rest, [d.key]: null }))}
                    />
                  ),
                },
                {
                  title: "Patient comes back",
                  render: (_, d) =>
                    d.key in later ? (
                      <DatePicker
                        aria-label={`${d.test.code} ${d.label} due back`}
                        {...DATE_TIME}
                        value={later[d.key]}
                        onChange={(v) => setLater((l) => ({ ...l, [d.key]: v }))}
                        status={later[d.key] ? undefined : "warning"}
                      />
                    ) : (
                      "—"
                    ),
                },
              ]}
            />
          </Section>
        )}
        <Section title="Payment and report">
          <Row gutter={16}>
            <Col {...COL.narrow}>
              <Form.Item label="Discount" name="discountAmount" extra={quotation ? undefined : "Any discount needs a pathologist's approval."}>
                <InputNumber disabled={!!quotation} min={0} prefix="₹" style={{ width: "100%" }} />
              </Form.Item>
            </Col>
            <Col {...COL.narrow}>
              <Form.Item label="Report expected by" name="expectedReportAt">
                <DatePicker {...DATE_TIME} style={{ width: "100%" }} />
              </Form.Item>
            </Col>
            <Col {...COL.narrow}>
              <Form.Item
                label="Paid now"
                name="payNow"
                rules={[{ validator: async (_, v) => { if (v && paise(v) > netPaise) throw new Error("More than the net amount"); } }]}
              >
                <InputNumber min={0} prefix="₹" style={{ width: "100%" }} />
              </Form.Item>
            </Col>
            <Col {...COL.narrow}>
              <Form.Item label="Payment mode" name="payMode" required>
                <Select options={MODE_OPTIONS} />
              </Form.Item>
            </Col>
          </Row>
          <Figures
            items={[
              { label: "Subtotal", value: preview ? formatMoney(preview.originalAmount) : "—" },
              { label: "Discount", value: preview ? formatMoney(preview.discountAmount) : "—" },
              { label: "Net amount", value: preview ? formatMoney(preview.netAmount) : "—", strong: true },
              { label: "Balance after payment", value: preview ? formatMoney((netPaise - paise(values?.payNow)) / 100) : "—" },
            ]}
          />
        </Section>
        {/* Again at the end of the form, the next stop for Tab after the payment. */}
        <Flex justify="flex-end">
          <Button type="primary" size="large" loading={busy} onClick={() => form.submit()}>
            Create bill
          </Button>
        </Flex>
      </Form>
    </Page>
  );
}
