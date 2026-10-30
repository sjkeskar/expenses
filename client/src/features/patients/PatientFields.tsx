import { useRef, useState, type ReactNode } from "react";
import { App, Alert, Button, Col, DatePicker, Flex, Form, Input, InputNumber, Radio, Row, Table, type ColProps } from "antd";
import { api, ApiError } from "../../api";
import { ageSex, dayOf, dayPicker, formatDate, SEX_LABELS, type Dayjs } from "../../lib/format";
import { useAction } from "../../lib/hooks";
import FormModal from "../../components/FormModal";
import { COL } from "../../components/Page";
import type { Patient, Sex } from "../../types/api";

// The mandatory patient fields (pivot.md §4.4), as dialog fields. A date of
// birth, or just an age (stored as an approximate date of birth).
export interface PatientValues {
  name: string;
  by: "age" | "dob";
  ageYears?: number;
  dob?: Dayjs;
  sex: Sex;
  phone: string;
}

export const toBody = ({ name, by, ageYears, dob, sex, phone }: PatientValues) =>
  by === "age" ? { name, ageYears, sex, phone } : { name, dateOfBirth: dayOf(dob!), sex, phone };

export const valuesOf = (p: Patient): PatientValues => ({
  name: p.name,
  by: p.dobIsApproximate ? "age" : "dob",
  ageYears: p.age,
  dob: dayPicker(p.dateOfBirth.slice(0, 10)),
  sex: p.sex,
  phone: p.phone,
});

// `prefix` nests the fields in a bigger form (e.g. ["newPatient"] on the
// bill form); `inline` lays them out in the page grid instead of stacking
// them as in a dialog; `autoFocus` puts the cursor in the name.
export function PatientFields({ prefix = [], inline = false, autoFocus = false }: { prefix?: string[]; inline?: boolean; autoFocus?: boolean }) {
  const at = (field: string) => [...prefix, field];
  const col = (size: ColProps, node: ReactNode) => (inline ? <Col {...size}>{node}</Col> : node);
  const fields = (
    <>
      {col(
        COL.wide,
        <Form.Item label="Full name" name={at("name")} rules={[{ required: true, whitespace: true, message: "Enter the patient's name" }]}>
          <Input autoComplete="off" autoFocus={autoFocus} />
        </Form.Item>
      )}
      {col(
        COL.narrow,
        <Form.Item label="Phone" name={at("phone")} rules={[{ required: true, pattern: /^\D*(\d\D*){10,}$/, message: "Enter a 10-digit phone number" }]}>
          <Input inputMode="tel" autoComplete="off" />
        </Form.Item>
      )}
      {col(
        COL.narrow,
        <Form.Item label="Sex" name={at("sex")} rules={[{ required: true, message: "Choose the sex" }]}>
          <Radio.Group options={Object.entries(SEX_LABELS).map(([value, label]) => ({ value, label }))} />
        </Form.Item>
      )}
      {col(
        COL.narrow,
        <Form.Item label="Age given as" name={at("by")} required>
          <Radio.Group options={[{ value: "age", label: "Age in years" }, { value: "dob", label: "Date of birth" }]} />
        </Form.Item>
      )}
      <Form.Item noStyle dependencies={[at("by")]}>
        {({ getFieldValue }) =>
          col(
            COL.narrow,
            getFieldValue(at("by")) === "age" ? (
              <Form.Item label="Age (years)" name={at("ageYears")} rules={[{ required: true, message: "Enter the age" }]}>
                <InputNumber min={0} max={130} precision={0} style={{ width: "100%" }} />
              </Form.Item>
            ) : (
              <Form.Item label="Date of birth" name={at("dob")} rules={[{ required: true, message: "Enter the date of birth" }]}>
                <DatePicker format="DD/MM/YYYY" disabledDate={(d) => d.isAfter(new Date())} style={{ width: "100%" }} />
              </Form.Item>
            )
          )
        }
      </Form.Item>
    </>
  );
  return inline ? <Row gutter={16}>{fields}</Row> : fields;
}

// What a search box's text most likely was: a phone number, or a name.
export function guessFromSearch(text: string): Partial<PatientValues> {
  const t = text.trim();
  if (!t) return {};
  return /^[\d\s+-]+$/.test(t) ? { phone: t.replace(/\D/g, "").slice(-10) } : { name: t };
}

// Registers a patient; someone already registered with the same details
// comes back instead (existed). A probable look-alike throws, carrying them
// (lookalikesIn reads them), unless confirmedDistinct.
export async function registerPatient(values: PatientValues, confirmedDistinct = false) {
  return api<{ patient: Patient; existed: boolean }>("/patients", { method: "POST", body: { ...toBody(values), confirmedDistinct } });
}

export const lookalikesIn = (e: unknown) => (e instanceof ApiError ? (e.body as { lookalikes?: Patient[] })?.lookalikes : undefined);

// The patients a new registration may duplicate: use one of them, or
// confirm it's someone else (e.g. a family member sharing the phone).
// `distinct` is the "Different person" button, which the caller wires up.
// `warn` heads it with the warning (a dialog shows the server's instead).
export function LookalikeChoice({ patients, onUse, distinct, warn = true }: { patients: Patient[]; onUse(patient: Patient): void; distinct: ReactNode; warn?: boolean }) {
  const [use] = useAction(async (p: Patient) => onUse((await api<{ patient: Patient }>(`/patients/${p.id}`)).patient));
  return (
    <Flex vertical gap={8}>
      {warn && <Alert type="warning" showIcon title="This may be a patient who is already registered." />}
      <Table<Patient>
        rowKey="id"
        size="small"
        bordered
        pagination={false}
        showHeader={false}
        dataSource={patients}
        columns={[
          { render: (_, p) => `${p.name} · ${SEX_LABELS[p.sex]} · born ${formatDate(p.dateOfBirth.slice(0, 10))} · ${p.patientNumber}` },
          {
            width: 1,
            render: (_, p) => (
              <Button type="link" size="small" onClick={() => use(p)}>
                Use this patient
              </Button>
            ),
          },
        ]}
      />
      <Alert type="info" title="If this is a different person (e.g. a family member sharing the phone), register them anyway." action={distinct} />
    </Flex>
  );
}

export const patientLabel = (p: Patient) => `${p.name} · ${ageSex(p.age, p.sex)} · ${p.phone}`;

// Registers a patient (pivot.md §4.4). Someone already registered with the
// same details is simply opened. A probable look-alike (same phone, sex and
// birth year ±1) is shown first: pick them, or confirm it's someone else.
export function RegisterPatientModal({ open, initial, onClose, onDone }: { open: boolean; initial?: Partial<PatientValues>; onClose(): void; onDone(patient: Patient): void }) {
  const { message } = App.useApp();
  const [lookalikes, setLookalikes] = useState<Patient[]>();
  const confirmed = useRef(false);
  const close = () => {
    setLookalikes(undefined);
    onClose();
  };

  const register = async (values: PatientValues) => {
    const confirmedDistinct = confirmed.current;
    confirmed.current = false;
    try {
      const { patient, existed } = await registerPatient(values, confirmedDistinct);
      message.success(existed ? `${patient.name} is already registered (${patient.patientNumber}).` : `${patient.name} is registered (${patient.patientNumber}).`);
      setLookalikes(undefined);
      onDone(patient);
    } catch (e) {
      setLookalikes(lookalikesIn(e));
      throw e;
    }
  };

  return (
    <FormModal<PatientValues> title="Register patient" okText="Register" open={open} initialValues={{ by: "age", ...initial }} onSubmit={register} onClose={close}>
      {lookalikes && (
        <div style={{ marginBottom: 16 }}>
          <LookalikeChoice
            warn={false}
            patients={lookalikes}
            onUse={(p) => {
              close();
              onDone(p);
            }}
            distinct={
              <Button size="small" htmlType="submit" onClick={() => (confirmed.current = true)}>
                Different person
              </Button>
            }
          />
        </div>
      )}
      <PatientFields />
    </FormModal>
  );
}
