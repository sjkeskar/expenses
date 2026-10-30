import { useLayoutEffect, useRef } from "react";
import JsBarcode from "jsbarcode";

// A verification code as a Code 128 barcode (pivot.md §7.3), with the code in
// readable text underneath so staff can type it if a scan fails. Each bar
// module is a whole number of printer dots (0.25 mm = 2 dots at the GT820's
// 203 dpi), so the printer never resamples the bars; the SVG stays sharp.
export default function Barcode({ code, moduleMm = 0.25, heightMm = 12 }: { code: string; moduleMm?: number; heightMm?: number }) {
  const svg = useRef<SVGSVGElement>(null);
  useLayoutEffect(() => {
    JsBarcode(svg.current!, code, { format: "CODE128", width: 1, height: 40, margin: 0, displayValue: false, background: "#fff", lineColor: "#000" });
    // With 1-unit modules the SVG's width is the module count.
    const modules = Number(svg.current!.getAttribute("width"));
    svg.current!.style.width = `${modules * moduleMm}mm`;
    svg.current!.style.height = `${heightMm}mm`;
    svg.current!.setAttribute("preserveAspectRatio", "none");
  }, [code, moduleMm, heightMm]);
  return (
    <div className="barcode" role="img" aria-label={`Verification code ${code}`}>
      <svg ref={svg} aria-hidden />
      <div className="barcode-text">{code}</div>
    </div>
  );
}
