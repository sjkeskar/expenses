import { useState } from "react";
import { Outlet, useLocation, useNavigate, useOutletContext } from "react-router-dom";
import { Alert, Avatar, Button, Dropdown, Flex, Layout, Menu, Typography, theme, type MenuProps } from "antd";
import { DownOutlined, KeyOutlined, LogoutOutlined, MenuFoldOutlined, MenuUnfoldOutlined, UserOutlined } from "@ant-design/icons";
import { REMINDER_KEY, useSession } from "../auth/session";
import { useApi } from "../lib/hooks";
import { ROLE_LABELS } from "../lib/format";
import { PAGES, type Page } from "../pages";
import type { LabSettings, Role } from "../types/api";
import ChangePasswordModal from "./ChangePasswordModal";
import QuickAccess from "./QuickAccess";

interface ShellContext {
  settings: LabSettings | null | undefined; // undefined while loading, null before first-run setup
  reloadSettings(): Promise<void>;
}

// What every page can read from the shell: the lab's settings.
export const useShell = () => useOutletContext<ShellContext>();

const ON_DARK = "rgba(255, 255, 255, 0.85)";

// Whether the side menu is collapsed to its icons, remembered on this PC
// (browser storage may be unavailable; it then just starts expanded).
const COLLAPSED_KEY = "menuCollapsed";
function storedCollapsed() {
  try {
    return localStorage.getItem(COLLAPSED_KEY) === "1";
  } catch {
    return false;
  }
}

// A function, not a constant: pages.tsx and this module import each other.
const menuPages = () => PAGES.filter((p) => p.menu !== false);

type MenuItem = NonNullable<MenuProps["items"]>[number];

// The menu entries this role can open, in their groups, each of which
// folds open and shut. Collapsed to its icons, the menu has no room for
// group headings: dividers separate the groups, every entry one click away.
function menuItems(role: Role, collapsed: boolean): MenuProps["items"] {
  const pages = menuPages().filter((p) => p.roles.includes(role));
  const entry = (p: Page) => ({ key: p.path, icon: p.icon, label: p.label });
  const groups = [...new Set(pages.map((p) => p.group))];
  return groups.flatMap<MenuItem>((group) => {
    const entries = pages.filter((p) => p.group === group).map(entry);
    if (!group) return entries;
    return collapsed ? [{ type: "divider" as const, key: `${group}-divider` }, ...entries] : [{ key: group, label: group, children: entries }];
  });
}

const allGroups = () => [...new Set(menuPages().map((p) => p.group).filter((g): g is string => !!g))];

// The groups folded shut on this PC; every other group is open, so a group
// added later starts open.
const CLOSED_KEY = "menuClosedGroups";
function storedClosed(): string[] {
  try {
    return JSON.parse(localStorage.getItem(CLOSED_KEY) ?? "[]");
  } catch {
    return [];
  }
}

// The entry to highlight: the screen itself, or the one whose path a detail
// or form screen extends (/bills/123 → Bills).
const selectedEntry = (pathname: string) =>
  menuPages()
    .map((p) => p.path)
    .filter((path) => pathname === path || (path !== "/" && pathname.startsWith(`${path}/`)))
    .sort((a, b) => b.length - a.length)[0] ?? pathname;

export default function AppShell() {
  const { user, signOut } = useSession();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const { token } = theme.useToken();
  const settings = useApi<{ settings: LabSettings | null }>(user ? "/settings" : null);
  const [reminder, setReminder] = useState(() => sessionStorage.getItem(REMINDER_KEY));
  const [changingPassword, setChangingPassword] = useState(false);
  const [collapsed, setCollapsed] = useState(storedCollapsed);
  const [closed, setClosed] = useState(storedClosed);
  const openGroups = (open: string[]) => {
    const shut = allGroups().filter((g) => !open.includes(g));
    setClosed(shut);
    try {
      localStorage.setItem(CLOSED_KEY, JSON.stringify(shut));
    } catch {
      // not remembered, that's all
    }
  };
  const toggleMenu = () => {
    setCollapsed(!collapsed);
    try {
      localStorage.setItem(COLLAPSED_KEY, collapsed ? "0" : "1");
    } catch {
      // not remembered, that's all
    }
  };

  // Signed out (or the session ended): the route guards send them to login.
  if (!user) return <Outlet context={{ settings: undefined, reloadSettings: async () => {} }} />;

  const dismissReminder = () => {
    sessionStorage.removeItem(REMINDER_KEY);
    setReminder(null);
  };

  return (
    <Layout style={{ minHeight: "100vh" }}>
      <Layout.Header style={{ paddingInline: 12 }}>
        <Flex justify="space-between" align="center" gap={16} style={{ height: "100%" }}>
          <Flex align="center" gap={8} style={{ minWidth: 0 }}>
            <Button
              type="text"
              aria-label={collapsed ? "Expand the menu" : "Collapse the menu"}
              aria-expanded={!collapsed}
              aria-controls="main-menu"
              icon={collapsed ? <MenuUnfoldOutlined aria-hidden /> : <MenuFoldOutlined aria-hidden />}
              onClick={toggleMenu}
              style={{ color: "#fff" }}
            />
            <Typography.Text strong ellipsis style={{ color: "#fff", fontSize: 16 }}>
              {settings.data?.settings?.labName ?? "Laboratory Management System"}
            </Typography.Text>
          </Flex>
          <Flex align="center" gap={16}>
            <QuickAccess role={user.role} />
            {/* Who's signed in is plain text; what they can do is in the menu it opens. */}
            <Dropdown
              trigger={["click"]}
              menu={{
                items: [
                  { key: "password", icon: <KeyOutlined aria-hidden />, label: "Change password" },
                  { type: "divider" },
                  { key: "signout", icon: <LogoutOutlined aria-hidden />, label: "Sign out" },
                ],
                onClick: ({ key }) => (key === "password" ? setChangingPassword(true) : signOut()),
              }}
            >
              <Button type="text" aria-label={`Account: ${user.name}, ${ROLE_LABELS[user.role]}`} style={{ height: 48, color: "#fff" }}>
                <Flex align="center" gap={10}>
                  <Avatar size="small" icon={<UserOutlined aria-hidden />} style={{ backgroundColor: token.colorPrimary }} />
                  <Flex vertical align="start" style={{ lineHeight: 1.3 }}>
                    <span>{user.name}</span>
                    <span style={{ color: ON_DARK, fontSize: 12 }}>{ROLE_LABELS[user.role]}</span>
                  </Flex>
                  <DownOutlined aria-hidden style={{ fontSize: 10, color: ON_DARK }} />
                </Flex>
              </Button>
            </Dropdown>
          </Flex>
        </Flex>
      </Layout.Header>
      <Layout>
        <Layout.Sider theme="light" width={220} collapsedWidth={64} collapsible collapsed={collapsed} trigger={null} style={{ borderInlineEnd: `1px solid ${token.colorSplit}` }}>
          <nav aria-label="Main" id="main-menu">
            <Menu
              mode="inline"
              style={{ borderInlineEnd: 0, paddingBlock: 8 }}
              selectedKeys={[selectedEntry(pathname)]}
              openKeys={collapsed ? [] : allGroups().filter((g) => !closed.includes(g))}
              onOpenChange={(open) => !collapsed && openGroups(open)}
              onClick={({ key }) => navigate(key)}
              items={menuItems(user.role, collapsed)}
            />
          </nav>
        </Layout.Sider>
        {/* antd renders Layout.Content as the page's <main> landmark. */}
        <Layout.Content style={{ padding: 24 }}>
          {reminder && <Alert type="info" title={reminder} closable onClose={dismissReminder} style={{ marginBottom: 16 }} />}
          <Outlet context={{ settings: settings.data?.settings, reloadSettings: settings.reload } satisfies ShellContext} />
        </Layout.Content>
      </Layout>
      <ChangePasswordModal open={changingPassword} onClose={() => setChangingPassword(false)} />
    </Layout>
  );
}
