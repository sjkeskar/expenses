import type { ReactNode } from "react";
import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import { Spin } from "antd";
import { SessionProvider, useSession } from "./auth/session";
import LoginPage from "./auth/LoginPage";
import AppShell from "./layout/AppShell";
import ErrorBoundary from "./components/ErrorBoundary";
import { menuEntryFor, PAGES, PRINTS, type Page } from "./pages";
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

// A screen, inside its own error boundary: a failed load or a crash shows
// there (with the menu still around it), never a blank page. A detail or
// form screen offers the way back to its list.
function Screen({ page }: { page: Page }) {
  const { pathname, search } = useLocation();
  const list = page.menu === false ? menuEntryFor(pathname) : undefined;
  return (
    <ErrorBoundary resetKey={pathname + search} back={list && { path: list.path, label: list.label }}>
      {page.element}
    </ErrorBoundary>
  );
}

export default function App() {
  const { pathname } = useLocation();
  // The last resort, for a crash outside any screen (e.g. in the layout).
  return (
    <ErrorBoundary resetKey={pathname}>
      <SessionProvider>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          {PRINTS.map((page) => (
            <Route key={page.path} path={page.path} element={<RoleRoute roles={page.roles}><Screen page={page} /></RoleRoute>} />
          ))}
          <Route element={<AppShell />}>
            {PAGES.map((page) => (
              <Route key={page.path} path={page.path} element={<RoleRoute roles={page.roles}><Screen page={page} /></RoleRoute>} />
            ))}
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </SessionProvider>
    </ErrorBoundary>
  );
}
