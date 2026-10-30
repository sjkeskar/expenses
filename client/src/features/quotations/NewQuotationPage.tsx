import { useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { App, Button, Col, Flex, Form, Input, InputNumber, Row, Typography } from "antd";
import { api } from "../../api";
import { useAction, useApi } from "../../lib/hooks";
import { formatMoney } from "../../lib/format";
import Page, { COL, Figures, Section } from "../../components/Page";
import type { Patient, Quotation } from "../../types/api";
import PatientPicker from "../patients/PatientPicker";
import { guessFromSearch } from "../patients/PatientFields";
import { ItemsSection, ORDER_DEFAULTS, orderBody, ReferralPayerFields, rememberLocation, syncOrder, useLookups, usePreview, useStartingLocation, VisitFields, type Lookups, type OrderValues } from "../billing/order";

// A new quotation (pivot.md §6.4): for a registered patient, or just a name
// and phone; priced like a bill, valid for 48 hours. Saving opens the
// thermal print (Zebra GT820).
interface QuoteValues extends OrderValues {
  patientName?: string;
  patientPhone?: string;
}

export default function NewQuotationPage() {
  const [params] = useSearchParams();
  const lookups = useLookups();
  const patient = useApi<{ patient: Patient }>(params.get("patient") ? `/patients/${params.get("patient")}` : null);
  if (!lookups || (params.get("patient") && !patient.data)) return null;
  return <QuoteForm lookups={lookups} initialPatient={patient.data?.patient} />;
}

function QuoteForm({ lookups, initialPatient }: { lookups: Lookups; initialPatient?: Patient }) {
  const { message } = App.useApp();
  const navigate = useNavigate();
  const [form] = Form.useForm<QuoteValues>();
  const values = Form.useWatch((v) => v, form) as QuoteValues | undefined;
  const [patient, setPatient] = useState<Patient | undefined>(initialPatient);
  // A name and phone by default; "Search registered patients" switches to the search.
  const [adding, setAdding] = useState(!initialPatient); // quoting for a name and phone
  useStartingLocation(form, lookups);

  // Not registered: the search text fills the name or phone.
  const addPatient = (typed: string) => {
    const { name, phone } = guessFromSearch(typed);
    form.setFieldsValue({ patientName: name, patientPhone: phone });
    setPatient(undefined);
    setAdding(true);
  };

  const { preview, error } = usePreview(values?.itemIds?.length && values.locationId ? orderBody(values) : null);

  const [save, busy] = useAction(async (v: QuoteValues) => {
    if (!patient && !adding) throw new Error("Choose the patient, or add a new one by name.");
    const who = patient ? { patientId: patient.id } : { patientName: v.patientName, patientPhone: v.patientPhone || undefined };
    const { quotation } = await api<{ quotation: Quotation }>("/quotations", { method: "POST", body: { ...orderBody(v), ...who } });
    rememberLocation(v.locationId);
    message.success(`Quotation ${quotation.quoteNumber} is saved.`);
    navigate(`/print/quotation/${quotation.id}?back=1`);
  });

  return (
    <Page
      title="New quotation"
      description="Quote today's prices; they're held for 48 hours."
      actions={
        <Button type="primary" loading={busy} onClick={() => form.submit()}>
          Save & print
        </Button>
      }
    >
      <Form
        form={form}
        layout="vertical"
        component={false}
        requiredMark="optional"
        initialValues={ORDER_DEFAULTS}
        onValuesChange={(changed) => syncOrder(changed, form, lookups)}
        onFinish={save}
      >
        <Section title="Patient">
          {!adding ? (
            <PatientPicker value={patient} onChange={setPatient} onNew={addPatient} autoFocus />
          ) : (
            <Flex vertical gap={16}>
              <Flex justify="space-between" align="center" wrap gap={8}>
                <Typography.Text>Not registered yet: a name and phone are enough for a quotation.</Typography.Text>
                <Button type="link" style={{ paddingInline: 0 }} onClick={() => setAdding(false)}>
                  Returning patient? Search registered patients
                </Button>
              </Flex>
              <Row gutter={16}>
                <Col {...COL.wide}>
                  <Form.Item label="Name" name="patientName" rules={[{ required: true, whitespace: true, message: "Enter the patient's name" }]}>
                    <Input autoComplete="off" autoFocus />
                  </Form.Item>
                </Col>
                <Col {...COL.narrow}>
                  <Form.Item label="Phone" name="patientPhone" rules={[{ pattern: /^\D*(\d\D*){10,}$/, message: "Enter a 10-digit phone number" }]}>
                    <Input inputMode="tel" autoComplete="off" />
                  </Form.Item>
                </Col>
              </Row>
            </Flex>
          )}
        </Section>
        <Section title="Visit">
          <VisitFields lookups={lookups} />
        </Section>
        <Section title="Referral and payer">
          <ReferralPayerFields lookups={lookups} />
        </Section>
        <ItemsSection lookups={lookups} preview={preview} error={error} />
        <Section title="Discount">
          <Row gutter={16}>
            <Col {...COL.narrow}>
              <Form.Item label="Discount" name="discountAmount" extra="A proposal: it's approved when the quote becomes a bill.">
                <InputNumber min={0} prefix="₹" style={{ width: "100%" }} />
              </Form.Item>
            </Col>
          </Row>
          <Figures
            items={[
              { label: "Subtotal", value: preview ? formatMoney(preview.originalAmount) : "—" },
              { label: "Discount", value: preview ? formatMoney(preview.discountAmount) : "—" },
              { label: "Net amount", value: preview ? formatMoney(preview.netAmount) : "—", strong: true },
              { label: "Valid for", value: "48 hours" },
            ]}
          />
        </Section>
        {/* Again at the end of the form, the next stop for Tab after the discount. */}
        <Flex justify="flex-end">
          <Button type="primary" size="large" loading={busy} onClick={() => form.submit()}>
            Save & print
          </Button>
        </Flex>
      </Form>
    </Page>
  );
}
