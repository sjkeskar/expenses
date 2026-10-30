import { useSearchParams } from "react-router-dom";
import { useApi } from "../lib/hooks";
import { ageSex, formatDate, formatMoney, formatTime, MODE_LABELS, MODES } from "../lib/format";
import type { DaySheet } from "../types/api";
import PrintFrame from "./PrintFrame";

const KIND_TEXT = { payment: "Payment", settlement: "Settlement", refund: "Refund" };

// The Day Sheet on A4 (pivot.md §6.7): money taken with totals by mode, and
// bills created.
export default function DaySheetPrint() {
  const [params] = useSearchParams();
  const data = useApi<DaySheet>(`/daysheet?${params.toString()}`);
  const sheet = data.data;
  return (
    <PrintFrame title={`Day sheet ${sheet ? `${sheet.user.name} ${formatDate(sheet.date)}` : ""}`} kind="a4" ready={!!sheet}>
      {(settings) => {
        const s = sheet!;
        return (
          <>
            <header className="print-head">
              <div>
                <h1>{settings.labName}</h1>
                <p>Day sheet</p>
              </div>
              <div className="right">
                <p>
                  <strong>{s.user.name}</strong>
                </p>
                <p>{formatDate(s.date)}</p>
              </div>
            </header>
            <h2>Money taken</h2>
            <table className="print-table">
              <thead>
                <tr>
                  <th>Time</th>
                  <th>Bill no.</th>
                  <th>Patient</th>
                  <th>Kind</th>
                  <th>Mode</th>
                  <th className="num">Amount</th>
                </tr>
              </thead>
              <tbody>
                {s.money.map((m, i) => (
                  <tr key={i}>
                    <td>{formatTime(m.at)}</td>
                    <td>{m.bill.billNumber}</td>
                    <td>{m.bill.patient.name}</td>
                    <td>{KIND_TEXT[m.kind]}</td>
                    <td>{MODE_LABELS[m.mode]}</td>
                    <td className="num">{formatMoney(m.amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <table className="print-totals">
              <tbody>
                {MODES.map((mode) => (
                  <tr key={mode}>
                    <td>{MODE_LABELS[mode]}</td>
                    <td className="num" style={{ textAlign: "right" }}>{formatMoney(s.totals[mode])}</td>
                  </tr>
                ))}
                <tr className="strong">
                  <td>Total to hand over</td>
                  <td className="num" style={{ textAlign: "right" }}>{formatMoney(s.totals.total)}</td>
                </tr>
              </tbody>
            </table>
            <h2>Bills created</h2>
            <table className="print-table">
              <thead>
                <tr>
                  <th>Time</th>
                  <th>Bill no.</th>
                  <th>Patient</th>
                  <th>Items</th>
                  <th className="num">Net</th>
                  <th className="num">Paid</th>
                  <th className="num">Balance</th>
                </tr>
              </thead>
              <tbody>
                {s.bills.map((b) => (
                  <tr key={b.id}>
                    <td>{formatTime(b.createdAt)}</td>
                    <td>{b.billNumber}</td>
                    <td>
                      {b.patient.name} ({ageSex(b.patientAge, b.patient.sex)})
                    </td>
                    <td>{b.items.map((i) => i.code).join(", ")}</td>
                    <td className="num">{formatMoney(b.netAmount)}</td>
                    <td className="num">{formatMoney(Number(b.netAmount) - Number(b.balance))}</td>
                    <td className="num">{formatMoney(b.balance)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        );
      }}
    </PrintFrame>
  );
}
