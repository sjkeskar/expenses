import { useParams } from "react-router-dom";
import { useApi } from "../lib/hooks";
import { ageSex, formatDateTime, MODE_LABELS, MODES, paise } from "../lib/format";
import type { Bill } from "../types/api";
import Barcode from "./Barcode";
import PrintFrame, { PrintHeader } from "./PrintFrame";
import { instructionsOf, PrintLines, Totals } from "./lines";

// The A4 bill (pivot.md §7.2). Patient details are the current ones (a
// correction shows on old bills too). Report holds are internal and never printed.
export default function BillPrint() {
  const { id } = useParams();
  const data = useApi<{ bill: Bill }>(`/bills/${id}`);
  const bill = data.data?.bill;
  return (
    <PrintFrame title={`Bill ${bill?.billNumber ?? ""}`} kind="a4" ready={!!bill} backTo={`/bills/${id}`}>
      {(settings) => {
        const b = bill!;
        const paidBy = MODES.map((mode) => [mode, b.transactions.filter((t) => t.mode === mode).reduce((s, t) => s + paise(t.amountCollected), 0)] as const).filter(([, p]) => p > 0);
        const refunded = b.refunds.reduce((s, r) => s + paise(r.amount), 0);
        const pending = b.items.filter((i) => i.status === "active").flatMap((i) => i.collections.filter((c) => c.status === "pending"));
        const instructions = instructionsOf(b.items);
        return (
          <>
            <PrintHeader settings={settings} location={b.location} title="Bill" />
            <div className="print-meta">
              <p>
                <strong>Bill no.:</strong> {b.billNumber}
              </p>
              <p>
                <strong>Date:</strong> {formatDateTime(b.createdAt)}
              </p>
              <p>
                <strong>Patient:</strong> {b.patient.name} ({ageSex(b.patientAge, b.patient.sex)})
              </p>
              <p>
                <strong>Patient no.:</strong> {b.patient.patientNumber}
              </p>
              <p>
                <strong>Phone:</strong> {b.patient.phone}
              </p>
              <p>
                <strong>Billed by:</strong> {b.createdBy.name}
              </p>
              <p>
                <strong>Referred by:</strong> {b.referralType === "walk_in" ? "Self (walk-in)" : (b.referringDoctor?.name ?? "Doctor")}
              </p>
              <p>
                <strong>Payer:</strong> {b.payerType === "panel" ? `${b.panel?.name}${b.camp ? ` (${b.camp.name})` : ""}` : "Self"}
              </p>
              {b.collectionMode === "home_visit" && (
                <p>
                  <strong>Home visit</strong>
                  {b.homeVisitAddress && `: ${b.homeVisitAddress}`}
                </p>
              )}
              <p>
                <strong>Report expected by:</strong> {formatDateTime(b.expectedReportAt)}
              </p>
            </div>
            <PrintLines lines={b.items} />
            <Totals
              rows={[
                ["Subtotal", b.originalAmount],
                ["Discount", b.discountAmount],
                ["Net amount", b.netAmount, true],
                ...paidBy.map(([mode, p]) => [`Paid (${MODE_LABELS[mode]})`, p / 100] as [string, number]),
                ...(refunded ? [["Refunded", -refunded / 100] as [string, number]] : []),
                ["Balance due", b.balance, true],
              ]}
            />
            {pending.length > 0 && (
              <>
                <h2>Samples still to give</h2>
                <table className="print-table">
                  <tbody>
                    {pending.map((c) => (
                      <tr key={c.id}>
                        <td>
                          {c.test.name} ({c.label})
                        </td>
                        <td className="num">{formatDateTime(c.dueAt)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </>
            )}
            {instructions.length > 0 && (
              <>
                <h2>Instructions</h2>
                {instructions.map((i) => (
                  <p key={i}>• {i}</p>
                ))}
              </>
            )}
            <footer className="print-foot">
              <p>Scan the code to verify this bill with the lab.</p>
              <Barcode code={b.verificationCode} moduleMm={0.3} />
            </footer>
          </>
        );
      }}
    </PrintFrame>
  );
}
