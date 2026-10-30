import { useEffect, useRef, useState } from "react";
import { Button, Descriptions, Flex, Select } from "antd";
import { api } from "../../api";
import { ageSex } from "../../lib/format";
import type { Patient } from "../../types/api";
import { patientLabel } from "./PatientFields";

const NEW = "__new__";

// The patient box of a quotation or bill (pivot.md §4.4): search by name,
// phone or patient number (old numbers too) and pick, or, when they aren't
// there, take the last line, "New patient: …", which hands what was typed
// to onNew so the form can show the new patient's fields in place. The
// "New patient" button does the same without searching first.
export default function PatientPicker({
  value,
  onChange,
  onNew,
  initialSearch,
  autoFocus,
}: {
  value?: Patient;
  onChange(patient: Patient | undefined): void;
  onNew(typed: string): void;
  initialSearch?: string; // e.g. a quotation's phone
  autoFocus?: boolean;
}) {
  const [options, setOptions] = useState<Patient[]>([]);
  const [typed, setTyped] = useState("");
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const latest = useRef("");

  const search = (q: string) => {
    setTyped(q);
    clearTimeout(timer.current);
    latest.current = q;
    timer.current = setTimeout(async () => {
      if (!q.trim()) return setOptions([]);
      const { patients } = await api<{ patients: Patient[] }>(`/patients?q=${encodeURIComponent(q.trim())}`);
      if (latest.current === q) setOptions(patients);
    }, 250);
  };
  useEffect(() => {
    if (initialSearch) search(initialSearch);
    return () => clearTimeout(timer.current);
  }, [initialSearch]);

  const choices = value && !options.some((p) => p.id === value.id) ? [value, ...options] : options;
  const newLine = typed.trim() ? `New patient: ${typed.trim()}` : "New patient";

  return (
    <Flex vertical gap={12}>
      <Flex gap={8}>
        <Select
          aria-label="Patient"
          placeholder="Search by name, phone or patient number"
          style={{ flex: 1, minWidth: 0 }}
          autoFocus={autoFocus}
          showSearch={{ filterOption: false, onSearch: search }}
          allowClear
          value={value?.id}
          onChange={(id) => (id === NEW ? onNew(typed) : onChange(choices.find((p) => p.id === id)))}
          options={[...choices.map((p) => ({ value: p.id, label: patientLabel(p) })), ...(typed.trim() ? [{ value: NEW, label: `+ ${newLine}` }] : [])]}
          notFoundContent={null}
        />
        <Button onClick={() => onNew(typed)}>New patient</Button>
      </Flex>
      {value && (
        <Descriptions
          size="small"
          column={{ xs: 1, sm: 2, lg: 4 }}
          items={[
            { label: "Patient no.", children: value.patientNumber },
            { label: "Name", children: value.name },
            { label: "Age / sex", children: ageSex(value.age, value.sex) },
            { label: "Phone", children: value.phone },
          ]}
        />
      )}
    </Flex>
  );
}
