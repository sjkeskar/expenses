// Analytics PDFs on A4 (pivot.md §6.10), built in the browser with jsPDF.
// jsPDF's built-in fonts have no "₹", so amounts print as plain numbers
// under an "(Rs)" column heading.
import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";

export interface PdfTable {
  heading?: string;
  head: string[];
  body: (string | number)[][];
  foot?: (string | number)[];
  numeric?: number[]; // right-aligned column indexes
}

const NUMBER = new Intl.NumberFormat("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const pdfMoney = (value: string | number | null | undefined) => NUMBER.format(Number(value ?? 0));

export function downloadPdf(fileName: string, title: string, subtitle: string, tables: PdfTable[]) {
  const doc = new jsPDF({ format: "a4", unit: "mm" });
  doc.setFontSize(14);
  doc.text(title, 14, 16);
  doc.setFontSize(10);
  doc.text(subtitle, 14, 22);
  let y = 28;
  for (const table of tables) {
    if (table.heading) {
      doc.setFontSize(11);
      doc.text(table.heading, 14, y + 4);
      y += 7;
    }
    const align = Object.fromEntries((table.numeric ?? []).map((i) => [i, { halign: "right" as const }]));
    autoTable(doc, {
      startY: y,
      head: [table.head],
      body: table.body,
      foot: table.foot ? [table.foot] : undefined,
      theme: "grid",
      styles: { fontSize: 8.5, textColor: 0, lineColor: 120, lineWidth: 0.1 },
      headStyles: { fillColor: 235, textColor: 0, fontStyle: "bold" },
      footStyles: { fillColor: 245, textColor: 0, fontStyle: "bold" },
      columnStyles: align,
      margin: { left: 14, right: 14 },
    });
    y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 8;
  }
  doc.save(fileName);
}
