import type { ReactNode } from "react";
import { Card, Flex, Space, Typography, theme } from "antd";

// The frame of every screen (pivot.md §12.4 "Layout"): the screen's title
// (its one <h1>), an optional one-line description, and the screen's main
// actions on the right; then its sections, 16px apart.
export default function Page({
  title,
  description,
  actions,
  children,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <Flex vertical gap={16}>
      <Flex justify="space-between" align="center" gap={16} wrap>
        <div>
          <Typography.Title level={1} style={{ margin: 0, fontSize: 24 }}>
            {title}
          </Typography.Title>
          {description && <Typography.Text type="secondary">{description}</Typography.Text>}
        </div>
        {actions && <Space>{actions}</Space>}
      </Flex>
      {children}
    </Flex>
  );
}

// A block of a screen. Its title is a real <h2>, so the screen reads as an
// outline; `flush` drops the body padding so a table runs edge to edge.
// `toolbar` (search boxes, filters) sits in a strip above the content.
export function Section({
  title,
  extra,
  flush,
  toolbar,
  children,
}: {
  title?: ReactNode;
  extra?: ReactNode;
  flush?: boolean;
  toolbar?: ReactNode;
  children: ReactNode;
}) {
  const { token } = theme.useToken();
  return (
    <Card
      title={title && <Typography.Title level={2} style={{ margin: 0, fontSize: 16 }}>{title}</Typography.Title>}
      extra={extra}
      className={flush ? "section-flush" : undefined}
      styles={flush || toolbar ? { body: { padding: 0 } } : undefined}
    >
      {toolbar && (
        <Flex wrap gap={8} align="center" style={{ padding: "16px 24px", borderBottom: `1px solid ${token.colorSplit}` }}>
          {toolbar}
        </Flex>
      )}
      {flush || !toolbar ? children : <div style={{ padding: 24 }}>{children}</div>}
    </Card>
  );
}

// A screen's figures in a row (totals, counts), each labelled.
export function Figures({ items }: { items: { label: string; value: ReactNode; strong?: boolean }[] }) {
  return (
    <Flex wrap gap={32}>
      {items.map((item) => (
        <Flex key={item.label} vertical role="group" aria-label={item.label}>
          <Typography.Text type="secondary">{item.label}</Typography.Text>
          <Typography.Text strong={item.strong} style={{ fontSize: 18 }}>
            {item.value}
          </Typography.Text>
        </Flex>
      ))}
    </Flex>
  );
}

// Form field widths (pivot.md §12.4): fields sit in an antd <Row gutter={16}>
// and fill the section's width — side by side on wide screens, stacked on
// narrow ones. Never a fixed pixel width.
export const COL = {
  wide: { xs: 24, lg: 12 }, // names, pickers
  narrow: { xs: 24, sm: 12, lg: 6 }, // phone, email, passwords, amounts
  full: { xs: 24 }, // addresses, notes
};

// For table columns whose values should stay on one line (codes, dates, money, actions).
export const NOWRAP = { onCell: () => ({ style: { whiteSpace: "nowrap" as const } }) };
