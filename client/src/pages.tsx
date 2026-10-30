import type { ReactNode } from "react";
import {
  ApartmentOutlined,
  AuditOutlined,
  BarChartOutlined,
  CalendarOutlined,
  CheckSquareOutlined,
  ClusterOutlined,
  ExperimentOutlined,
  FileTextOutlined,
  HomeOutlined,
  IdcardOutlined,
  ProfileOutlined,
  ReconciliationOutlined,
  ScanOutlined,
  SettingOutlined,
  ShopOutlined,
  SolutionOutlined,
  TeamOutlined,
  ToolOutlined,
  WalletOutlined,
} from "@ant-design/icons";
import type { Role } from "./types/api";
import HomePage from "./features/home/HomePage";
import SetupPage from "./features/setup/SetupPage";
import UsersPage from "./features/users/UsersPage";
import LocationsPage from "./features/locations/LocationsPage";
import SettingsPage from "./features/settings/SettingsPage";
import CatalogPage from "./features/catalog/CatalogPage";
import CatalogEntryPage from "./features/catalog/CatalogEntryPage";
import MachinesPage from "./features/machines/MachinesPage";
import DoctorsPage from "./features/doctors/DoctorsPage";
import ApprovalsPage from "./features/approvals/ApprovalsPage";
import MyRequestsPage from "./features/approvals/MyRequestsPage";
import PatientsPage from "./features/patients/PatientsPage";
import PatientDetailPage from "./features/patients/PatientDetailPage";
import BillsPage from "./features/billing/BillsPage";
import NewBillPage from "./features/billing/NewBillPage";
import BillDetailPage from "./features/billing/BillDetailPage";
import RevisitsPage from "./features/revisits/RevisitsPage";
import DaySheetPage from "./features/daysheet/DaySheetPage";
import SettlementPage from "./features/panels/SettlementPage";
import PanelsPage from "./features/panels/PanelsPage";
import VerifyPage from "./features/verify/VerifyPage";
import QuotationsPage from "./features/quotations/QuotationsPage";
import NewQuotationPage from "./features/quotations/NewQuotationPage";
import QuotationDetailPage from "./features/quotations/QuotationDetailPage";
import AnalyticsPage from "./features/analytics/AnalyticsPage";
import BillPrint from "./print/BillPrint";
import QuotationPrint from "./print/QuotationPrint";
import DaySheetPrint from "./print/DaySheetPrint";
import RevisitsPrint from "./print/RevisitsPrint";

// Every screen, once: drives both the routes (App.tsx) and the side menu
// (AppShell), where `group` heads a block of entries and `menu: false`
// screens (details, forms) highlight the entry whose path they extend.
// `roles` is what the menu shows and the route allows; the server's own
// role checks remain the real boundary (pivot.md §8). Icons are decorative
// (aria-hidden): the label names the screen.
export interface Page {
  path: string;
  label: string;
  icon?: ReactNode;
  group?: string;
  menu?: false;
  roles: Role[];
  element: ReactNode;
}

const LEAD: Role[] = ["lead_pathologist"];
const RECEPTION: Role[] = ["technician", "pathologist", "lead_pathologist"];
const APPROVERS: Role[] = ["pathologist", "lead_pathologist"];
const OVERSIGHT: Role[] = ["lead_pathologist", "accountant"];
const READERS: Role[] = [...RECEPTION, "accountant"];
const EVERYONE: Role[] = ["developer", ...READERS];

export const PAGES: Page[] = [
  { path: "/", label: "Home", icon: <HomeOutlined aria-hidden />, roles: EVERYONE, element: <HomePage /> },

  { group: "Reception", path: "/patients", label: "Patients", icon: <IdcardOutlined aria-hidden />, roles: RECEPTION, element: <PatientsPage /> },
  { path: "/patients/:id", label: "Patient", menu: false, roles: RECEPTION, element: <PatientDetailPage /> },
  { group: "Reception", path: "/quotations", label: "Quotations", icon: <FileTextOutlined aria-hidden />, roles: RECEPTION, element: <QuotationsPage /> },
  { path: "/quotations/new", label: "New quotation", menu: false, roles: RECEPTION, element: <NewQuotationPage /> },
  { path: "/quotations/:id", label: "Quotation", menu: false, roles: READERS, element: <QuotationDetailPage /> },
  { group: "Reception", path: "/bills", label: "Bills", icon: <ProfileOutlined aria-hidden />, roles: READERS, element: <BillsPage /> },
  { path: "/bills/new", label: "New bill", menu: false, roles: RECEPTION, element: <NewBillPage /> },
  { path: "/bills/:id", label: "Bill", menu: false, roles: READERS, element: <BillDetailPage /> },
  { group: "Reception", path: "/revisits", label: "Sample revisits", icon: <CalendarOutlined aria-hidden />, roles: RECEPTION, element: <RevisitsPage /> },
  { group: "Reception", path: "/daysheet", label: "Day sheet", icon: <ReconciliationOutlined aria-hidden />, roles: READERS, element: <DaySheetPage /> },
  { group: "Reception", path: "/settlement", label: "Panel settlement", icon: <WalletOutlined aria-hidden />, roles: RECEPTION, element: <SettlementPage /> },
  { group: "Reception", path: "/verify", label: "Verify document", icon: <ScanOutlined aria-hidden />, roles: READERS, element: <VerifyPage /> },

  { group: "Catalog", path: "/catalog", label: "Tests & profiles", icon: <ExperimentOutlined aria-hidden />, roles: READERS, element: <CatalogPage /> },
  { path: "/catalog/entry", label: "Catalog entry", menu: false, roles: RECEPTION, element: <CatalogEntryPage /> },
  { group: "Catalog", path: "/doctors", label: "Referring doctors", icon: <SolutionOutlined aria-hidden />, roles: RECEPTION, element: <DoctorsPage /> },
  { group: "Catalog", path: "/machines", label: "Machines", icon: <ClusterOutlined aria-hidden />, roles: LEAD, element: <MachinesPage /> },

  { group: "Approvals", path: "/approvals", label: "Approval queue", icon: <AuditOutlined aria-hidden />, roles: APPROVERS, element: <ApprovalsPage /> },
  { group: "Approvals", path: "/requests", label: "My requests", icon: <CheckSquareOutlined aria-hidden />, roles: RECEPTION, element: <MyRequestsPage /> },

  { group: "Reports", path: "/analytics", label: "Analytics", icon: <BarChartOutlined aria-hidden />, roles: OVERSIGHT, element: <AnalyticsPage /> },

  { group: "Administration", path: "/panels", label: "Panels & camps", icon: <ShopOutlined aria-hidden />, roles: LEAD, element: <PanelsPage /> },
  { group: "Administration", path: "/locations", label: "Branches & centres", icon: <ApartmentOutlined aria-hidden />, roles: LEAD, element: <LocationsPage /> },
  { group: "Administration", path: "/users", label: "Users", icon: <TeamOutlined aria-hidden />, roles: LEAD, element: <UsersPage /> },
  { group: "Administration", path: "/settings", label: "Lab settings", icon: <SettingOutlined aria-hidden />, roles: LEAD, element: <SettingsPage /> },
  { group: "Administration", path: "/setup", label: "Lab setup", icon: <ToolOutlined aria-hidden />, roles: ["developer"], element: <SetupPage /> },
];

// Print views (pivot.md §7): outside the app's frame, each opens its own
// print dialog.
export const PRINTS: Page[] = [
  { path: "/print/bill/:id", label: "Bill", roles: READERS, element: <BillPrint /> },
  { path: "/print/quotation/:id", label: "Quotation", roles: RECEPTION, element: <QuotationPrint /> },
  { path: "/print/day-sheet", label: "Day sheet", roles: READERS, element: <DaySheetPrint /> },
  { path: "/print/revisits", label: "Sample revisits", roles: RECEPTION, element: <RevisitsPrint /> },
];
