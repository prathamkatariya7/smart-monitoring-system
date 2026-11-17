import { useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { Form, Input, Button, Card, Typography, Alert, App } from 'antd';
import { authApi } from '@/api/auth';
import { useAuthStore } from '@/store/auth.store';

export function LoginPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { message } = App.useApp();
  const [error, setError] = useState<string | null>(null);
  const [needsMfa, setNeedsMfa] = useState(false);
  const [loading, setLoading] = useState(false);

  const onFinish = async (values: { username: string; password: string; mfaCode?: string }) => {
    setLoading(true);
    setError(null);
    try {
      const { accessToken, refreshToken } = await authApi.login(values.username, values.password, values.mfaCode);
      useAuthStore.getState().setTokens(accessToken, refreshToken);
      const user = await authApi.me();
      useAuthStore.getState().setUser(user);
      message.success(`Welcome, ${user.name}`);
      const from = (location.state as { from?: Location })?.from?.pathname ?? '/';
      navigate(from, { replace: true });
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message;
      if (typeof msg === 'string' && msg.toLowerCase().includes('mfa')) {
        setNeedsMfa(true);
        setError(msg);
      } else {
        setError(typeof msg === 'string' ? msg : 'Login failed');
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '100vh', background: '#f0f2f5', padding: 16 }}>
      <Card style={{ width: '100%', maxWidth: 380 }}>
        <Typography.Title level={3} style={{ textAlign: 'center' }}>
          Reactor Monitoring Platform
        </Typography.Title>
        <Typography.Text type="secondary" style={{ display: 'block', textAlign: 'center', marginBottom: 24 }}>
          Sign in to continue
        </Typography.Text>
        {error && <Alert type="error" title={error} style={{ marginBottom: 16 }} showIcon />}
        <Form layout="vertical" onFinish={onFinish} disabled={loading}>
          <Form.Item name="username" label="Username" rules={[{ required: true }]}>
            <Input autoFocus autoComplete="username" />
          </Form.Item>
          <Form.Item name="password" label="Password" rules={[{ required: true }]}>
            <Input.Password autoComplete="current-password" />
          </Form.Item>
          {needsMfa && (
            <Form.Item name="mfaCode" label="MFA Code" rules={[{ required: true }]}>
              <Input placeholder="6-digit code" />
            </Form.Item>
          )}
          <Form.Item>
            <Button type="primary" htmlType="submit" block loading={loading}>
              Sign in
            </Button>
          </Form.Item>
        </Form>
      </Card>
    </div>
  );
}
