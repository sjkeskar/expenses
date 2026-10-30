import { useSearchParams } from "react-router-dom";
import { useApi } from "../lib/hooks";
import { formatDate, formatDateTime } from "../lib/format";
import type { Revisit } from "../types/api";
import PrintFrame from "./PrintFrame";

// The revisit list on A4 (pivot.md §6.6): who is due back, for which samples.
export default function RevisitsPrint() {
  const [params] = useSearchParams();
  const until = params.get("until") ?? "";
  const data = useApi<{ collections: Revisit[] }>(`/bills/revisits?until=${until}`);
  return (
    <PrintFrame title="Sample revisits" kind="a4" ready={!!data.data}>
      {(settings) => (
        <>
          <header className="print-head">
            <div>
              <h1>{settings.labName}</h1>
              <p>Sample revisits</p>
            </div>
            <div className="right">
              <p>{until ? `Due by ${formatDate(until)}` : "All pending"}</p>
              <p>Printed {formatDateTime(new Date().toISOString())}</p>
            </div>
          </header>
          <table className="print-table">
            <thead>
              <tr>
                <th>Due</th>
                <th>Patient</th>
                <th>Phone</th>
                <th>Bill no.</th>
                <th>Test</th>
                <th>Sample</th>
                <th>Collected</th>
              </tr>
            </thead>
            <tbody>
              {data.data!.collections.map((r) => (
                <tr key={r.id}>
                  <td>{formatDateTime(r.dueAt)}</td>
                  <td>{r.billItem.bill.patient.name}</td>
                  <td>{r.billItem.bill.patient.phone}</td>
                  <td>{r.billItem.bill.billNumber}</td>
                  <td>{r.test.name}</td>
                  <td>{r.label}</td>
                  <td>☐</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </PrintFrame>
  );
}
