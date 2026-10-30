import { useParams } from "react-router-dom";
import { useApi } from "../lib/hooks";
import { formatDateTime } from "../lib/format";
import type { Quotation } from "../types/api";
import Barcode from "./Barcode";
import PrintFrame, { PrintHeader } from "./PrintFrame";
import { instructionsOf, PrintLines, Totals } from "./lines";

// The quotation on the Zebra GT820 (pivot.md §7.1–7.2): 104 mm wide, one
// column, as long as its content, ending with the validity terms and the
// verification barcode.
export default function QuotationPrint() {
  const { id } = useParams();
  const data = useApi<{ quotation: Quotation }>(`/quotations/${id}`);
  const quote = data.data?.quotation;
  return (
    <PrintFrame title={`Quotation ${quote?.quoteNumber ?? ""}`} kind="thermal" ready={!!quote} backTo={`/quotations/${id}`}>
      {(settings) => {
        const q = quote!;
        const instructions = instructionsOf(q.items);
        return (
          <>
            <PrintHeader settings={settings} location={q.location} title="Quotation" />
            <div className="print-meta">
              <p>
                <strong>Quotation no.:</strong> {q.quoteNumber}
              </p>
              <p>
                <strong>Issued:</strong> {formatDateTime(q.issuedAt)} by {q.createdBy.name}
              </p>
              <p>
                <strong>For:</strong> {q.patientName}
                {q.patientPhone && ` · ${q.patientPhone}`}
              </p>
              <p>
                <strong>Referred by:</strong> {q.referralType === "walk_in" ? "Self (walk-in)" : (q.referringDoctor?.name ?? "Doctor")}
              </p>
              <p>
                <strong>Payer:</strong> {q.payerType === "panel" ? `${q.panel?.name}${q.camp ? ` (${q.camp.name})` : ""}` : "Self"}
              </p>
              {q.collectionMode === "home_visit" && (
                <p>
                  <strong>Home visit</strong>
                </p>
              )}
            </div>
            <PrintLines lines={q.items} />
            <Totals
              rows={[
                ["Subtotal", q.originalAmount],
                ["Discount", q.discountAmount],
                ["Net amount", q.netAmount, true],
              ]}
            />
            {instructions.length > 0 && (
              <>
                <h2>Instructions</h2>
                {instructions.map((i) => (
                  <p key={i}>• {i}</p>
                ))}
              </>
            )}
            <footer className="print-foot">
              <p>
                <strong>Valid for 48 hours, until {formatDateTime(q.validUntil)}.</strong>
              </p>
              <p>Prices are held until then. Scan the code to verify this quotation.</p>
              <Barcode code={q.verificationCode} />
            </footer>
          </>
        );
      }}
    </PrintFrame>
  );
}
