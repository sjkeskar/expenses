import { formatMoney, KIND_LABELS } from "../lib/format";
import type { LineCatalog } from "../types/api";

interface Line {
  id: string;
  code: string;
  name: string;
  kind: keyof typeof KIND_LABELS;
  price: string;
  status?: "active" | "cancelled";
  catalogItem: LineCatalog;
}

// The patient instructions of every line, a profile's tests included, once each.
export const instructionsOf = (lines: Line[]) => [
  ...new Set(
    lines
      .filter((l) => l.status !== "cancelled")
      .flatMap((l) => [l.catalogItem.instructions, ...l.catalogItem.components.map((c) => c.test.instructions)])
      .filter((i): i is string => !!i)
  ),
];

// Printed lines: a profile lists its tests under it; a cancelled line is struck through.
export function PrintLines({ lines }: { lines: Line[] }) {
  return (
    <table className="print-table">
      <thead>
        <tr>
          <th>Code</th>
          <th>Test / service</th>
          <th className="num">Price</th>
        </tr>
      </thead>
      <tbody>
        {lines.map((l) => (
          <tr key={l.id} className={l.status === "cancelled" ? "cancelled" : undefined}>
            <td>{l.code}</td>
            <td>
              {l.name}
              {l.status === "cancelled" && " (cancelled)"}
              {l.kind === "profile" && <div className="sub">Includes: {l.catalogItem.components.map((c) => c.test.name).join(", ")}</div>}
            </td>
            <td className="num">{formatMoney(l.price)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function Totals({ rows }: { rows: [string, string | number, boolean?][] }) {
  return (
    <table className="print-totals">
      <tbody>
        {rows.map(([label, value, strong]) => (
          <tr key={label} className={strong ? "strong" : undefined}>
            <td>{label}</td>
            <td className="num" style={{ textAlign: "right" }}>
              {formatMoney(value)}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
