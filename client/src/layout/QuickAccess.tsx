import { useEffect, useState, type ReactNode } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { Badge, Button, Flex, Grid, Tooltip } from "antd";
import { AuditOutlined, FileTextOutlined, PlusOutlined, UserAddOutlined } from "@ant-design/icons";
import { useApi } from "../lib/hooks";
import type { ApprovalList, Role } from "../types/api";
import { RegisterPatientModal } from "../features/patients/PatientFields";

const RECEPTION: Role[] = ["technician", "pathologist", "lead_pathologist"];
const APPROVERS: Role[] = ["pathologist", "lead_pathologist"];

// Front-desk shortcuts, for everyone who does reception work (Alt + a
// letter; Chrome uses none of these).
const SHORTCUTS: Record<string, "bill" | "quote" | "patient"> = { KeyB: "bill", KeyQ: "quote", KeyP: "patient" };

// The quick access bar in the header: what each role reaches for all day,
// one click away from any screen. Technicians, at the front desk, get New
// bill, New quotation and Register patient; pathologists and the lead get
// their approval queue, with how much is waiting. On narrow screens the
// buttons show only their icons.
export default function QuickAccess({ role }: { role: Role }) {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const wide = Grid.useBreakpoint().xl;
  const [registering, setRegistering] = useState(false);
  const approver = APPROVERS.includes(role);
  const queue = useApi<ApprovalList>(approver ? "/approvals" : null);
  const reloadQueue = queue.reload;

  // The count follows the queue as the user moves around the app.
  useEffect(() => {
    if (approver) reloadQueue();
  }, [approver, pathname, reloadQueue]);

  useEffect(() => {
    if (!RECEPTION.includes(role)) return;
    const onKey = (e: KeyboardEvent) => {
      const action = e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey ? SHORTCUTS[e.code] : undefined;
      if (!action) return;
      e.preventDefault();
      if (action === "patient") setRegistering(true);
      else navigate(action === "bill" ? "/bills/new" : "/quotations/new");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [role, navigate]);

  // `name` overrides the accessible name (e.g. to include a count).
  const action = (label: string, shortcut: string | null, icon: ReactNode, onClick: () => void, { primary = false, name }: { primary?: boolean; name?: string } = {}) => (
    <Tooltip title={shortcut ? `${label} (${shortcut})` : label}>
      <Button type={primary ? "primary" : "default"} ghost={!primary} icon={icon} onClick={onClick} aria-label={name ?? (wide ? undefined : label)} aria-keyshortcuts={shortcut ?? undefined}>
        {wide && label}
      </Button>
    </Tooltip>
  );

  const waiting = queue.data?.approvals.filter((a) => a.status === "pending").length ?? 0;

  return (
    <nav aria-label="Quick access">
      <Flex gap={8} align="center">
        {role === "technician" && (
          <>
            {action("New bill", "Alt+B", <PlusOutlined aria-hidden />, () => navigate("/bills/new"), { primary: true })}
            {action("New quotation", "Alt+Q", <FileTextOutlined aria-hidden />, () => navigate("/quotations/new"))}
            {action("Register patient", "Alt+P", <UserAddOutlined aria-hidden />, () => setRegistering(true))}
          </>
        )}
        {approver && (
          <Badge count={waiting} size="small" offset={[-4, 4]} title={`${waiting} waiting`}>
            {action("Approval queue", null, <AuditOutlined aria-hidden />, () => navigate("/approvals"), { primary: true, name: `Approval queue, ${waiting} waiting` })}
          </Badge>
        )}
      </Flex>
      {RECEPTION.includes(role) && (
        <RegisterPatientModal
          open={registering}
          onClose={() => setRegistering(false)}
          onDone={(patient) => {
            setRegistering(false);
            navigate(`/patients/${patient.id}`);
          }}
        />
      )}
    </nav>
  );
}
