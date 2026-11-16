import { useState } from 'react';
import { Layout, Menu, Avatar, Dropdown, Badge, Typography, Button, Grid } from 'antd';
import {
  DashboardOutlined,
  ApiOutlined,
  ExperimentOutlined,
  AlertOutlined,
  BellOutlined,
  SettingOutlined,
  LogoutOutlined,
  UserOutlined,
  MenuOutlined,
  ToolOutlined,
  DeploymentUnitOutlined,
} from '@ant-design/icons';
import { Outlet, useNavigate, useLocation, Link } from 'react-router-dom';
import { useAuthStore } from '@/store/auth.store';
import { useNotificationsStore } from '@/store/notifications.store';
import { disconnectRealtime } from '@/realtime/socket';
import { authApi } from '@/api/auth';
import type { Role } from '@/api/types';

const { Header, Sider, Content } = Layout;
const { useBreakpoint } = Grid;

const NAV_ITEMS: Array<{ key: string; icon: React.ReactNode; label: string; roles?: Role[] }> = [
  { key: '/', icon: <DashboardOutlined />, label: 'Dashboard' },
  { key: '/reactors', icon: <DeploymentUnitOutlined />, label: 'Reactors' },
  { key: '/devices', icon: <ApiOutlined />, label: 'Devices', roles: ['ADMIN'] },
  { key: '/processes', icon: <ExperimentOutlined />, label: 'Processes' },
  { key: '/alarms', icon: <AlertOutlined />, label: 'Alarms & Overrides' },
  { key: '/notifications', icon: <BellOutlined />, label: 'Notifications' },
  { key: '/calibrations', icon: <ToolOutlined />, label: 'Calibration', roles: ['ADMIN', 'BOROSIL_ADMIN'] },
  { key: '/admin', icon: <SettingOutlined />, label: 'Admin', roles: ['ADMIN', 'BOROSIL_ADMIN'] },
];

export function AppLayout() {
  const navigate = useNavigate();
  const location = useLocation();
  const screens = useBreakpoint();
  const isMobile = !screens.lg;
  // null = no manual override yet -- default collapse state tracks the
  // breakpoint; once the user toggles it manually, that choice sticks.
  const [manualCollapse, setManualCollapse] = useState<boolean | null>(null);
  const collapsed = manualCollapse ?? isMobile;
  const user = useAuthStore((s) => s.user);
  const unseenCount = useNotificationsStore((s) => s.unseenCount);

  const visibleItems = NAV_ITEMS.filter((item) => {
    if (!item.roles) return true;
    if (!user) return false;
    return user.isAdmin || item.roles.some((r) => user.roles.includes(r));
  });

  const handleLogout = async () => {
    try {
      await authApi.logout();
    } catch {
      // ignore -- stateless tokens, logging out client-side is what matters
    }
    disconnectRealtime();
    useAuthStore.getState().logout();
    navigate('/login');
  };

  const selectedKey =
    visibleItems.find((i) => (i.key === '/' ? location.pathname === '/' : location.pathname.startsWith(i.key)))
      ?.key ?? '/';

  return (
    <Layout style={{ minHeight: '100vh' }}>
      <Sider
        collapsible
        collapsed={collapsed}
        onCollapse={setManualCollapse}
        breakpoint="lg"
        collapsedWidth={isMobile ? 0 : 80}
        zeroWidthTriggerStyle={isMobile ? { top: 12 } : undefined}
        style={{
          // Pinned to the viewport so it never scrolls with the page content --
          // without this, Sider is just a normal flex child and scrolls away
          // with everything else on any page taller than the viewport (e.g.
          // Reactor Detail's chart/table). overflowY lets the nav itself
          // scroll internally only if it's ever taller than the viewport,
          // which it isn't today, but this keeps it safe if more items are
          // added later.
          position: 'fixed',
          insetInlineStart: 0,
          top: 0,
          bottom: 0,
          height: '100vh',
          overflowY: 'auto',
          zIndex: 10,
        }}
      >
        <div style={{ height: 48, margin: 16, color: '#fff', fontWeight: 600, overflow: 'hidden', whiteSpace: 'nowrap' }}>
          {collapsed ? 'RMP' : 'Reactor Monitoring'}
        </div>
        <Menu
          theme="dark"
          mode="inline"
          selectedKeys={[selectedKey]}
          onClick={() => isMobile && setManualCollapse(true)}
          items={visibleItems.map((i) => ({ key: i.key, icon: i.icon, label: <Link to={i.key}>{i.label}</Link> }))}
        />
      </Sider>
      <Layout
        style={{
          minWidth: 0,
          // Matches the Sider's current width so fixed positioning doesn't
          // hide content underneath it. 0 on mobile since the collapsed
          // Sider is zero-width there (acts like a drawer via its trigger).
          marginInlineStart: isMobile ? 0 : collapsed ? 80 : 200,
          transition: 'margin-inline-start 0.2s',
        }}
      >
        <Header
          style={{
            background: '#fff',
            padding: '0 12px 0 16px',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            gap: 12,
            position: 'sticky',
            top: 0,
            zIndex: 9,
            width: '100%',
          }}
        >
          {isMobile ? (
            <Button type="text" icon={<MenuOutlined />} onClick={() => setManualCollapse(!collapsed)} />
          ) : (
            <span />
          )}
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <Link to="/notifications">
              <Badge count={unseenCount} size="small">
                <Button type="text" icon={<BellOutlined style={{ fontSize: 18 }} />} />
              </Badge>
            </Link>
            <Dropdown
              menu={{
                items: [{ key: 'logout', icon: <LogoutOutlined />, label: 'Sign out', onClick: handleLogout }],
              }}
            >
              <span style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8 }}>
                <Avatar icon={<UserOutlined />} size="small" />
                {!isMobile && <Typography.Text>{user?.name ?? ''}</Typography.Text>}
              </span>
            </Dropdown>
          </div>
        </Header>
        <Content
          style={{
            margin: isMobile ? 8 : 16,
            background: '#fff',
            padding: isMobile ? 12 : 16,
            borderRadius: 4,
            minWidth: 0,
            overflowX: 'auto',
          }}
        >
          <Outlet />
        </Content>
      </Layout>
    </Layout>
  );
}
