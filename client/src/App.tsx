import type { ReactNode } from "react";
import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import { Spin } from "antd";
import { SessionProvider, useSession } from "./auth/session";
import LoginPage from "./auth/LoginPage";
import AppShell from "./layout/AppShell";
import { PAGES, PRINTS } from "./pages";
import type { Role } from "./types/api";

// Signed out → the login page (remembering where they were going);
// signed in with the wrong role → home.
function RoleRoute({ roles, children }: { roles: Role[]; children: ReactNode }) {
  const { user, loading } = useSession();
  const location = useLocation();
  if (loading) return <Spin fullscreen />;
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  if (!roles.includes(user.role)) return <Navigate to="/" replace />;
  return children;
}

export default function App() {
  return (
    <SessionProvider>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        {PRINTS.map((page) => (
          <Route key={page.path} path={page.path} element={<RoleRoute roles={page.roles}>{page.element}</RoleRoute>} />
        ))}
        <Route element={<AppShell />}>
          {PAGES.map((page) => (
            <Route key={page.path} path={page.path} element={<RoleRoute roles={page.roles}>{page.element}</RoleRoute>} />
          ))}
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </SessionProvider>
  );
}
