import { AutoComplete } from "antd";
import type { MachineType } from "../../types/api";

// The catalog grid's Machines cell: still the "A > B + C" text that
// parseSteps reads (and Excel pastes), but it suggests machine types for the
// name being typed, i.e. the part after the last ">" or "+". Picking one
// completes that name; type ">" or "+" to add the next machine.
export default function MachineStepsInput({
  types,
  value,
  onChange,
  disabled,
  ...rest
}: {
  types: MachineType[];
  value?: string;
  onChange?: (value: string) => void;
  disabled?: boolean;
  "aria-label"?: string;
}) {
  const text = value ?? "";
  const cut = Math.max(text.lastIndexOf(">"), text.lastIndexOf("+")) + 1;
  const prefix = cut ? `${text.slice(0, cut).trimEnd()} ` : "";
  const typed = text.slice(cut).trim().toLowerCase();
  const options = types
    .filter((t) => t.name.toLowerCase().includes(typed) && t.name.toLowerCase() !== typed)
    .sort((a, b) => Number(!a.name.toLowerCase().startsWith(typed)) - Number(!b.name.toLowerCase().startsWith(typed)) || a.name.localeCompare(b.name))
    .map((t) => ({ value: `${prefix}${t.name}`, label: t.name }));

  return (
    <AutoComplete
      {...rest}
      value={value}
      onChange={onChange}
      disabled={disabled}
      options={options}
      placeholder={disabled ? undefined : types.length ? "Start typing a machine type" : "No machine types yet"}
      style={{ width: "100%" }}
    />
  );
}
