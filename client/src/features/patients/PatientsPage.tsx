import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Button, Input, Table, Typography } from "antd";
import { useApi } from "../../lib/hooks";
import { ageSex, formatDateTime } from "../../lib/format";
import Page, { NOWRAP, Section } from "../../components/Page";
import type { Patient } from "../../types/api";
import { RegisterPatientModal } from "./PatientFields";

// Patients (pivot.md §6.11): search by name, phone or patient number (old
// numbers too); register; open one to see their bills and quotations.
export default function PatientsPage() {
  const navigate = useNavigate();
  const [q, setQ] = useState("");
  const patients = useApi<{ patients: Patient[] }>(`/patients?q=${encodeURIComponent(q)}`);
  const [registering, setRegistering] = useState(false);

  return (
    <Page
      title="Patients"
      description="Find a patient by name, phone or patient number."
      actions={<Button type="primary" onClick={() => setRegistering(true)}>Register patient</Button>}
    >
      <Section
        flush
        toolbar={
          <>
            <Input.Search aria-label="Search patients" placeholder="Name, phone or patient number" allowClear enterButton onSearch={(v) => setQ(v.trim())} style={{ maxWidth: 420 }} />
            {!q && <Typography.Text type="secondary">Showing the latest registered.</Typography.Text>}
          </>
        }
      >
        <Table<Patient>
          rowKey="id"
          size="middle"
          loading={!patients.data && !patients.error}
          dataSource={patients.data?.patients}
          pagination={false}
          columns={[
            { title: "Patient no.", dataIndex: "patientNumber", ...NOWRAP, render: (n, p) => <Link to={`/patients/${p.id}`}>{n}</Link> },
            { title: "Name", dataIndex: "name" },
            { title: "Age / sex", render: (_, p) => ageSex(p.age, p.sex), ...NOWRAP },
            { title: "Phone", dataIndex: "phone", ...NOWRAP },
            { title: "Registered", dataIndex: "createdAt", render: formatDateTime, ...NOWRAP },
          ]}
        />
      </Section>
      <RegisterPatientModal open={registering} onClose={() => setRegistering(false)} onDone={(p) => navigate(`/patients/${p.id}`)} />
    </Page>
  );
}
