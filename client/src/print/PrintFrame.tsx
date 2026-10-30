import { useEffect, useRef, type ReactNode } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Button } from "antd";
import { useApi } from "../lib/hooks";
import type { LabSettings, Location } from "../types/api";
import "./print.css";

// The frame of every print view (pivot.md §7.1): a toolbar that never
// prints, the sheet, and the print dialog opened once the content is in.
// An A4 sheet prints on A4. A thermal sheet (the Zebra GT820's 104 mm
// continuous media) is as long as its content: the page size is set from
// the rendered height just before printing.
// ?back=1 returns to the record once the dialog closes (the quotation form
// prints in its own tab).
export default function PrintFrame({ title, kind, ready, backTo, children }: { title: string; kind: "a4" | "thermal"; ready: boolean; backTo?: string; children(settings: LabSettings): ReactNode }) {
  const settings = useApi<{ settings: LabSettings }>("/settings");
  const sheet = useRef<HTMLDivElement>(null);
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const loaded = ready && !!settings.data;
  const back = params.get("back") && backTo;

  useEffect(() => {
    if (!loaded) return;
    document.title = title;
    const style = document.createElement("style");
    const heightMm = Math.ceil((sheet.current!.getBoundingClientRect().height * 25.4) / 96) + 2;
    style.textContent = kind === "a4" ? "@page { size: A4; margin: 12mm; }" : `@page { size: 104mm ${heightMm}mm; margin: 0; }`;
    document.head.appendChild(style);
    const afterPrint = () => back && navigate(back, { replace: true });
    window.addEventListener("afterprint", afterPrint);
    const timer = setTimeout(() => window.print(), 100); // after the barcode has drawn
    return () => {
      clearTimeout(timer);
      window.removeEventListener("afterprint", afterPrint);
      style.remove();
    };
  }, [loaded, kind, title, back, navigate]);

  return (
    <div className="print-view">
      <div className="print-toolbar">
        <Button type="primary" disabled={!loaded} onClick={() => window.print()}>
          Print
        </Button>
        {back ? <Button onClick={() => navigate(back, { replace: true })}>Done</Button> : <Button onClick={() => window.close()}>Close</Button>}
      </div>
      {loaded && (
        <main ref={sheet} className={`print-sheet ${kind}`} aria-label={title}>
          {children(settings.data!.settings)}
        </main>
      )}
    </div>
  );
}

// The header of every printed document (pivot.md §7.2): the lab and its
// contact details, and the branch or centre that issued it.
export function PrintHeader({ settings, location, title }: { settings: LabSettings; location: Location; title: string }) {
  return (
    <header className="print-head">
      <div>
        <h1>{settings.labName}</h1>
        <p>{settings.address}</p>
        <p>
          {settings.phone}
          {settings.email && ` · ${settings.email}`}
        </p>
      </div>
      <div className="right">
        <p>
          <strong>{title}</strong>
        </p>
        <p>{location.name}</p>
        <p>{location.address}</p>
        {location.phone && <p>{location.phone}</p>}
      </div>
    </header>
  );
}
