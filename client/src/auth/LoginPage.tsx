import { useEffect, useState } from "react";
import { Navigate, useLocation, useNavigate } from "react-router-dom";
import { Alert, Button, Card, Flex, Form, Input, Typography, theme } from "antd";
import { ExperimentOutlined, LockOutlined, UserOutlined } from "@ant-design/icons";
import { NOTICE_KEY, useSession } from "./session";
import { useAction } from "../lib/hooks";

export default function LoginPage() {
  const { user, signIn } = useSession();
  const navigate = useNavigate();
  const { token } = theme.useToken();
  const from = (useLocation().state as { from?: string } | null)?.from ?? "/";
  const [error, setError] = useState<string>();
  const [notice] = useState(() => sessionStorage.getItem(NOTICE_KEY));
  useEffect(() => sessionStorage.removeItem(NOTICE_KEY), []);
  const [submit, busy] = useAction(async ({ name, password }: { name: string; password: string }) => {
    setError(undefined);
    try {
      await signIn(name.trim(), password);
      navigate(from, { replace: true });
    } catch (e) {
      setError((e as Error).message);
    }
  });

  if (user) return <Navigate to={from} replace />;

  return (
    <Flex component="main" justify="center" align="center" style={{ minHeight: "100vh", padding: 16, background: token.colorBgLayout }}>
      <Card style={{ width: "100%", maxWidth: 400 }} styles={{ body: { padding: 32 } }}>
        <Flex vertical align="center" gap={4} style={{ marginBottom: 24, textAlign: "center" }}>
          <ExperimentOutlined aria-hidden style={{ fontSize: 32, color: token.colorPrimary, marginBottom: 8 }} />
          <Typography.Title level={1} style={{ margin: 0, fontSize: 20 }}>
            Laboratory Management System
          </Typography.Title>
          <Typography.Text type="secondary">Sign in to continue</Typography.Text>
        </Flex>
        {notice && !error && <Alert type="success" title={notice} showIcon style={{ marginBottom: 16 }} />}
        {error && <Alert type="error" title={error} showIcon style={{ marginBottom: 16 }} />}
        <Form layout="vertical" size="large" onFinish={submit} requiredMark={false}>
          <Form.Item label="Login name" name="name" rules={[{ required: true, whitespace: true, message: "Enter your login name" }]}>
            <Input prefix={<UserOutlined aria-hidden />} autoComplete="username" autoFocus />
          </Form.Item>
          <Form.Item label="Password" name="password" rules={[{ required: true, message: "Enter your password" }]}>
            <Input.Password prefix={<LockOutlined aria-hidden />} autoComplete="current-password" />
          </Form.Item>
          <Button type="primary" htmlType="submit" block loading={busy} style={{ marginTop: 8 }}>
            Sign in
          </Button>
        </Form>
      </Card>
    </Flex>
  );
}
