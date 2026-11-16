import { useState } from 'react';
import type { ReactNode } from 'react';
import { Navigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Tabs,
  Table,
  Button,
  Space,
  Modal,
  Form,
  Input,
  Select,
  Switch,
  App,
  Typography,
  Descriptions,
  Tag,
  Card,
  Row,
  Col,
  Statistic,
} from 'antd';
import { tenancyApi } from '@/api/tenancy';
import { systemApi } from '@/api/system';
import { authApi } from '@/api/auth';
import type { UserSummary } from '@/api/auth';
import { reactorsApi } from '@/api/reactors';
import { useAuthStore } from '@/store/auth.store';
import type { Site, Laboratory, FeatureSwitch, Role, Equipment } from '@/api/types';

const ASSIGNABLE_ROLES: Role[] = ['ADMIN', 'LAB_INCHARGE', 'ANALYST', 'AUDITOR', 'BOROSIL_ADMIN'];

// Built-in browser/Node API (ECMA-402), always matches the current IANA
// timezone database -- no new dependency needed for the dropdown the Site
// form was missing (was a free-text <Input placeholder="UTC">).
//
// Gotcha found 2026-11-11: this engine's ICU data returns legacy IANA link
// names for some zones instead of their modern canonical name -- e.g.
// "Asia/Calcutta" rather than "Asia/Kolkata" (same zone, same UTC offset,
// just an older alias). Searching "Kolkata" against the raw value/label
// then finds nothing even though the zone IS present. A few well-known
// aliases are added to the searchable text (not the stored value, which
// stays the canonical API-returned string) so the common name still works.
const TIMEZONE_ALIASES: Record<string, string> = {
  'Asia/Calcutta': 'Kolkata',
  'Asia/Katmandu': 'Kathmandu',
  'Asia/Rangoon': 'Yangon',
  'Asia/Saigon': 'Ho Chi Minh City',
  'Europe/Kiev': 'Kyiv',
};
const TIMEZONE_OPTIONS = (
  typeof Intl.supportedValuesOf === 'function' ? Intl.supportedValuesOf('timeZone') : ['UTC']
).map((tz) => ({
  label: tz,
  value: tz,
  searchText: `${tz} ${TIMEZONE_ALIASES[tz] ?? ''}`.toUpperCase(),
}));

function SitesLabsTab() {
  const qc = useQueryClient();
  const { message } = App.useApp();
  const { data: sites } = useQuery({ queryKey: ['sites'], queryFn: tenancyApi.sites });
  const { data: labs } = useQuery({ queryKey: ['laboratories'], queryFn: tenancyApi.laboratories });
  const { data: features } = useQuery({ queryKey: ['features'], queryFn: tenancyApi.features });
  const [siteModal, setSiteModal] = useState(false);
  const [labModal, setLabModal] = useState(false);
  const [siteForm] = Form.useForm();
  const [labForm] = Form.useForm();

  const createSite = useMutation({
    mutationFn: tenancyApi.createSite,
    onSuccess: () => {
      message.success('Site created');
      qc.invalidateQueries({ queryKey: ['sites'] });
      siteForm.resetFields();
      setSiteModal(false);
    },
  });
  const createLab = useMutation({
    mutationFn: tenancyApi.createLaboratory,
    onSuccess: () => {
      message.success('Laboratory created');
      qc.invalidateQueries({ queryKey: ['laboratories'] });
      labForm.resetFields();
      setLabModal(false);
    },
  });
  const toggleFeature = useMutation({
    mutationFn: (f: FeatureSwitch) => tenancyApi.setFeature(f.key, !f.value, 'Toggled via admin UI'),
    onSuccess: () => {
      message.success('Feature switch updated');
      qc.invalidateQueries({ queryKey: ['features'] });
    },
  });

  return (
    <Space orientation="vertical" size="large" style={{ width: '100%' }}>
      <Card
        title="Sites"
        extra={
          <Button size="small" onClick={() => setSiteModal(true)}>
            New site
          </Button>
        }
      >
        <Table
          rowKey="id"
          size="small"
          scroll={{ x: 'max-content' }}
          pagination={false}
          dataSource={sites ?? []}
          columns={[
            { title: 'Name', dataIndex: 'name', key: 'name' },
            { title: 'Time zone', dataIndex: 'timeZone', key: 'timeZone' },
          ]}
        />
      </Card>
      <Card
        title="Laboratories"
        extra={
          <Button size="small" onClick={() => setLabModal(true)}>
            New laboratory
          </Button>
        }
      >
        <Table
          rowKey="id"
          size="small"
          scroll={{ x: 'max-content' }}
          pagination={false}
          dataSource={labs ?? []}
          columns={[
            { title: 'Name', dataIndex: 'name', key: 'name' },
            { title: 'Code', dataIndex: 'code', key: 'code' },
            {
              title: 'Site',
              dataIndex: 'siteId',
              key: 'siteId',
              render: (id: string) => sites?.find((s: Site) => s.id === id)?.name ?? id,
            },
          ]}
        />
      </Card>
      <Card title="Feature switches">
        <Table
          rowKey="key"
          size="small"
          scroll={{ x: 'max-content' }}
          pagination={false}
          dataSource={features ?? []}
          columns={[
            { title: 'Key', dataIndex: 'key', key: 'key' },
            {
              title: 'Enabled',
              dataIndex: 'value',
              key: 'value',
              render: (v: boolean, f: FeatureSwitch) => <Switch checked={v} onChange={() => toggleFeature.mutate(f)} />,
            },
          ]}
        />
      </Card>

      <Modal title="New site" open={siteModal} onCancel={() => setSiteModal(false)} onOk={() => siteForm.submit()}>
        <Form form={siteForm} layout="vertical" onFinish={(v) => createSite.mutate(v)}>
          <Form.Item name="name" label="Name" rules={[{ required: true }]}>
            <Input />
          </Form.Item>
          <Form.Item name="timeZone" label="Time zone" initialValue="UTC">
            <Select
              showSearch
              options={TIMEZONE_OPTIONS}
              filterOption={(input, option) => !!option?.searchText.includes(input.toUpperCase())}
            />
          </Form.Item>
        </Form>
      </Modal>
      <Modal title="New laboratory" open={labModal} onCancel={() => setLabModal(false)} onOk={() => labForm.submit()}>
        <Form form={labForm} layout="vertical" onFinish={(v) => createLab.mutate(v)}>
          <Form.Item name="siteId" label="Site" rules={[{ required: true }]}>
            <Select
              placeholder="Select a site"
              options={(sites ?? []).map((s: Site) => ({ label: s.name, value: s.id }))}
            />
          </Form.Item>
          <Form.Item name="name" label="Name" rules={[{ required: true }]}>
            <Input />
          </Form.Item>
          <Form.Item name="code" label="Code">
            <Input />
          </Form.Item>
        </Form>
      </Modal>
    </Space>
  );
}

function ReactorsTab() {
  const qc = useQueryClient();
  const { message } = App.useApp();
  const { data: reactors, isLoading } = useQuery({ queryKey: ['reactors'], queryFn: reactorsApi.list });
  const { data: labs } = useQuery({ queryKey: ['laboratories'], queryFn: tenancyApi.laboratories });
  const [createOpen, setCreateOpen] = useState(false);
  const [form] = Form.useForm();

  const createReactor = useMutation({
    mutationFn: (body: { laboratoryId: string; reactorNumber: string; displayName?: string }) =>
      reactorsApi.create(body),
    onSuccess: () => {
      message.success('Reactor created');
      qc.invalidateQueries({ queryKey: ['reactors'] });
      form.resetFields();
      setCreateOpen(false);
    },
    onError: (err: unknown) => {
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message;
      message.error(typeof msg === 'string' ? msg : 'Create reactor failed');
    },
  });

  const labNameById = new Map((labs ?? []).map((l: Laboratory) => [l.id, l.name]));

  return (
    <Card title="Reactors" extra={<Button onClick={() => setCreateOpen(true)}>New reactor</Button>}>
      <Table
        rowKey="id"
        loading={isLoading}
        size="small"
        scroll={{ x: 'max-content' }}
        pagination={false}
        dataSource={reactors ?? []}
        columns={[
          { title: 'Reactor #', dataIndex: 'reactorNumber', key: 'reactorNumber' },
          { title: 'Display name', dataIndex: 'displayName', key: 'displayName', render: (v: string | null) => v ?? '-' },
          {
            title: 'Laboratory',
            dataIndex: 'laboratoryId',
            key: 'laboratoryId',
            render: (id: string) => labNameById.get(id) ?? id,
          },
          {
            title: 'Status',
            key: 'status',
            render: (_: unknown, r: Equipment) =>
              r.online ? <Tag color="green">ONLINE</Tag> : <Tag color="default">OFFLINE</Tag>,
          },
          {
            title: 'Maintenance mode',
            dataIndex: 'maintenanceMode',
            key: 'maintenanceMode',
            render: (v: boolean) => (v ? <Tag color="orange">On</Tag> : <Tag>Off</Tag>),
          },
        ]}
      />

      <Modal
        title="New reactor"
        open={createOpen}
        onCancel={() => setCreateOpen(false)}
        onOk={() => form.submit()}
        confirmLoading={createReactor.isPending}
      >
        <Form form={form} layout="vertical" onFinish={(v) => createReactor.mutate(v)}>
          <Form.Item name="laboratoryId" label="Laboratory" rules={[{ required: true }]}>
            <Select
              placeholder="Select a laboratory"
              options={(labs ?? []).map((l: Laboratory) => ({ label: l.name, value: l.id }))}
            />
          </Form.Item>
          <Form.Item name="reactorNumber" label="Reactor number" rules={[{ required: true }]}>
            <Input placeholder="e.g. R-25" />
          </Form.Item>
          <Form.Item name="displayName" label="Display name">
            <Input placeholder="e.g. Reactor 25" />
          </Form.Item>
        </Form>
      </Modal>
    </Card>
  );
}

function LicenceTab() {
  const qc = useQueryClient();
  const { message, modal } = App.useApp();
  const user = useAuthStore((s) => s.user);
  const canManage = !!user?.roles.includes('BOROSIL_ADMIN');
  const { data: licence } = useQuery({ queryKey: ['licence'], queryFn: systemApi.licence });
  const [uploadOpen, setUploadOpen] = useState(false);
  const [form] = Form.useForm();

  const upload = useMutation({
    mutationFn: (body: { payload: Record<string, unknown>; signature: string }) => systemApi.uploadLicence(body),
    onSuccess: () => {
      message.success('Licence updated');
      qc.invalidateQueries({ queryKey: ['licence'] });
      setUploadOpen(false);
    },
    onError: (err: unknown) => {
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message;
      message.error(typeof msg === 'string' ? msg : 'Upload failed');
    },
  });

  const deactivate = useMutation({
    mutationFn: systemApi.deactivateLicence,
    onSuccess: () => {
      message.success('Licence deactivated');
      qc.invalidateQueries({ queryKey: ['licence'] });
    },
    onError: (err: unknown) => {
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message;
      message.error(typeof msg === 'string' ? msg : 'Deactivation failed');
    },
  });

  const confirmDeactivate = () => {
    modal.confirm({
      title: 'Deactivate this licence?',
      content:
        'New device claims will be blocked until a licence is uploaded again. Already-collected data, viewing, and export are never affected.',
      okText: 'Deactivate',
      okButtonProps: { danger: true },
      onOk: () => deactivate.mutate(),
    });
  };

  return (
    <Card
      title="Licence"
      extra={
        canManage ? (
          <Space>
            {licence?.installed && (
              <Button danger onClick={confirmDeactivate} loading={deactivate.isPending}>
                Deactivate licence
              </Button>
            )}
            <Button onClick={() => setUploadOpen(true)}>Upload new licence</Button>
          </Space>
        ) : undefined
      }
    >
      {!canManage && (
        <Typography.Paragraph type="secondary">
          Licence is managed exclusively by Borosil support. Contact Borosil to activate,
          deactivate, or change your licence terms.
        </Typography.Paragraph>
      )}
      {licence && (
        <Descriptions bordered size="small" column={2}>
          <Descriptions.Item label="Installed">{licence.installed ? 'Yes' : 'No'}</Descriptions.Item>
          <Descriptions.Item label="Valid">
            <Tag color={licence.valid ? 'green' : 'red'}>{licence.valid ? 'Valid' : 'Invalid'}</Tag>
          </Descriptions.Item>
          <Descriptions.Item label="Expired">
            <Tag color={licence.expired ? 'red' : 'green'}>{licence.expired ? 'Expired' : 'Current'}</Tag>
          </Descriptions.Item>
          <Descriptions.Item label="Organisation">{licence.payload?.organisation ?? '-'}</Descriptions.Item>
          <Descriptions.Item label="Edition">{licence.payload?.edition ?? '-'}</Descriptions.Item>
          <Descriptions.Item label="Max devices">{licence.payload?.maxDevices ?? '-'}</Descriptions.Item>
          <Descriptions.Item label="Support term end">
            {licence.payload?.supportTermEnd ? new Date(licence.payload.supportTermEnd).toLocaleDateString() : '-'}
          </Descriptions.Item>
          <Descriptions.Item label="Error">{licence.error ?? '-'}</Descriptions.Item>
        </Descriptions>
      )}
      <Modal
        title="Upload signed licence file"
        open={uploadOpen}
        onCancel={() => setUploadOpen(false)}
        onOk={() => form.submit()}
        confirmLoading={upload.isPending}
      >
        <Form
          form={form}
          layout="vertical"
          onFinish={(v) => {
            try {
              const parsed = JSON.parse(v.json);
              upload.mutate(parsed);
            } catch {
              message.error('Invalid JSON');
            }
          }}
        >
          <Form.Item name="json" label="Paste licence.json contents" rules={[{ required: true }]}>
            <Input.TextArea rows={8} placeholder='{"payload": {...}, "signature": "..."}' />
          </Form.Item>
        </Form>
      </Modal>
    </Card>
  );
}

function BackupsTab() {
  const qc = useQueryClient();
  const { message } = App.useApp();
  const { data: backups, isLoading } = useQuery({ queryKey: ['backups'], queryFn: systemApi.backups });
  const trigger = useMutation({
    mutationFn: systemApi.triggerBackup,
    onSuccess: () => {
      message.success('Backup created');
      qc.invalidateQueries({ queryKey: ['backups'] });
    },
    onError: (err: unknown) => {
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message;
      message.error(typeof msg === 'string' ? msg : 'Backup failed');
    },
  });

  return (
    <Card title="Backups" extra={<Button type="primary" loading={trigger.isPending} onClick={() => trigger.mutate()}>Trigger backup now</Button>}>
      <Table
        rowKey="file"
        loading={isLoading}
        dataSource={backups ?? []}
        size="small"
        scroll={{ x: 'max-content' }}
        columns={[
          { title: 'File', dataIndex: 'file', key: 'file' },
          { title: 'Size', dataIndex: 'sizeBytes', key: 'sizeBytes', render: (b: number) => `${(b / 1024).toFixed(1)} KB` },
          { title: 'Created', dataIndex: 'createdAt', key: 'createdAt', render: (t: string) => new Date(t).toLocaleString() },
          {
            title: 'Actions',
            key: 'actions',
            render: (_: unknown, b: { file: string }) => (
              <a href={systemApi.backupDownloadUrl(b.file)} target="_blank" rel="noreferrer">
                Download
              </a>
            ),
          },
        ]}
      />
    </Card>
  );
}

function HealthTab() {
  const { data: health } = useQuery({ queryKey: ['health'], queryFn: systemApi.health, refetchInterval: 10000 });
  if (!health) return null;
  const diskOk = typeof health.checks.disk === 'object';
  return (
    <Card title={<Space>System health <Tag color={health.status === 'ok' ? 'green' : health.status === 'degraded' ? 'orange' : 'red'}>{health.status.toUpperCase()}</Tag></Space>}>
      <Row gutter={[16, 16]}>
        <Col xs={12} sm={12} md={6}>
          <Statistic title="Database" value={health.checks.database} styles={{ content: { color: health.checks.database === 'ok' ? '#3f8600' : '#cf1322' } }} />
        </Col>
        <Col xs={12} sm={12} md={6}>
          <Statistic title="MQTT broker" value={health.checks.mqttBroker} styles={{ content: { color: health.checks.mqttBroker === 'ok' ? '#3f8600' : '#cf1322' } }} />
        </Col>
        <Col xs={12} sm={12} md={6}>
          <Statistic
            title="Disk free"
            value={diskOk ? `${(((health.checks.disk as { freeBytes: number }).freeBytes) / 1e9).toFixed(1)} GB` : 'unknown'}
          />
        </Col>
        <Col xs={12} sm={12} md={6}>
          <Statistic
            title="Last backup"
            value={health.checks.backup.lastBackupAgeMs ? `${Math.round(health.checks.backup.lastBackupAgeMs / 60000)} min ago` : 'never'}
            styles={{ content: { color: health.checks.backup.stale ? '#cf1322' : '#3f8600' } }}
          />
        </Col>
      </Row>
      <Typography.Paragraph type="secondary" style={{ marginTop: 16 }}>
        Last checked: {new Date(health.timestamp).toLocaleString()}
      </Typography.Paragraph>
    </Card>
  );
}

function UsersTab() {
  const qc = useQueryClient();
  const { message } = App.useApp();
  const user = useAuthStore((s) => s.user);
  const isBorosilAdmin = !!user?.roles.includes('BOROSIL_ADMIN');
  const { data: users, isLoading } = useQuery({ queryKey: ['authUsers'], queryFn: authApi.users });
  const { data: labs } = useQuery({ queryKey: ['laboratories'], queryFn: tenancyApi.laboratories });
  const [createOpen, setCreateOpen] = useState(false);
  const [resetTarget, setResetTarget] = useState<{ id: string; name: string } | null>(null);
  const [reassignTarget, setReassignTarget] = useState<UserSummary | null>(null);
  const [createForm] = Form.useForm();
  const [resetForm] = Form.useForm();
  const [reassignForm] = Form.useForm();

  const createRoles: Role[] = Form.useWatch('roles', createForm) ?? [];
  const createLabId: string | undefined = Form.useWatch('laboratoryId', createForm);
  const needsLab = createRoles.includes('LAB_INCHARGE') || createRoles.includes('ANALYST');
  const needsReportsTo = createRoles.includes('ANALYST');
  const labInchargesInLab = (users ?? []).filter(
    (u) => u.roles.includes('LAB_INCHARGE') && u.laboratoryId === createLabId,
  );

  const reassignRoles = reassignTarget?.roles ?? [];
  const reassignLabId: string | undefined = Form.useWatch('laboratoryId', reassignForm);
  const reassignNeedsReportsTo = reassignRoles.includes('ANALYST');
  const reassignLabIncharges = (users ?? []).filter(
    (u) => u.roles.includes('LAB_INCHARGE') && u.laboratoryId === reassignLabId,
  );

  const createUser = useMutation({
    mutationFn: (body: {
      name: string;
      username: string;
      password: string;
      roles: Role[];
      laboratoryId?: string;
      reportsToUserId?: string;
    }) => authApi.createUser(body),
    onSuccess: () => {
      message.success('User created');
      qc.invalidateQueries({ queryKey: ['authUsers'] });
      createForm.resetFields();
      setCreateOpen(false);
    },
    onError: (err: unknown) => {
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message;
      message.error(typeof msg === 'string' ? msg : 'Create user failed');
    },
  });

  const resetPassword = useMutation({
    mutationFn: (body: { userId: string; newPassword: string }) =>
      authApi.resetPassword(body.userId, body.newPassword),
    onSuccess: () => {
      message.success('Password reset');
      resetForm.resetFields();
      setResetTarget(null);
    },
    onError: (err: unknown) => {
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message;
      message.error(typeof msg === 'string' ? msg : 'Reset failed');
    },
  });

  const reassignLab = useMutation({
    mutationFn: (body: { userId: string; laboratoryId: string; reportsToUserId?: string }) =>
      authApi.reassignLab(body.userId, body.laboratoryId, body.reportsToUserId),
    onSuccess: () => {
      message.success('Lab reassigned');
      qc.invalidateQueries({ queryKey: ['authUsers'] });
      reassignForm.resetFields();
      setReassignTarget(null);
    },
    onError: (err: unknown) => {
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message;
      message.error(typeof msg === 'string' ? msg : 'Reassign failed');
    },
  });

  const confirmReset = (target: { id: string; name: string }) => {
    setResetTarget(target);
  };

  const assignableRoles = isBorosilAdmin ? ASSIGNABLE_ROLES : ASSIGNABLE_ROLES.filter((r) => r !== 'BOROSIL_ADMIN');

  return (
    <Card title="Users" extra={<Button onClick={() => setCreateOpen(true)}>Create user</Button>}>
      <Table
        rowKey="id"
        loading={isLoading}
        size="small"
        scroll={{ x: 'max-content' }}
        pagination={false}
        dataSource={users ?? []}
        columns={[
          { title: 'Name', dataIndex: 'name', key: 'name' },
          { title: 'Username', dataIndex: 'username', key: 'username' },
          {
            title: 'Roles',
            dataIndex: 'roles',
            key: 'roles',
            render: (roles: Role[]) => roles.map((r) => <Tag key={r}>{r}</Tag>),
          },
          { title: 'Lab', dataIndex: 'laboratoryName', key: 'laboratoryName', render: (v: string | null) => v ?? '-' },
          { title: 'Reports to', dataIndex: 'reportsToName', key: 'reportsToName', render: (v: string | null) => v ?? '-' },
          {
            title: 'Actions',
            key: 'actions',
            render: (_: unknown, u: UserSummary) => {
              const targetIsBorosilAdmin = u.roles.includes('BOROSIL_ADMIN');
              if (targetIsBorosilAdmin && !isBorosilAdmin) return null;
              const canReassign = u.roles.includes('LAB_INCHARGE') || u.roles.includes('ANALYST');
              return (
                <Space>
                  <Button size="small" onClick={() => confirmReset(u)}>
                    Reset password
                  </Button>
                  {canReassign && (
                    <Button size="small" onClick={() => setReassignTarget(u)}>
                      Reassign lab
                    </Button>
                  )}
                </Space>
              );
            },
          },
        ]}
      />

      <Modal
        title="Create user"
        open={createOpen}
        onCancel={() => {
          setCreateOpen(false);
          createForm.resetFields();
        }}
        onOk={() => createForm.submit()}
        confirmLoading={createUser.isPending}
      >
        <Form form={createForm} layout="vertical" onFinish={(v) => createUser.mutate(v)}>
          <Form.Item name="name" label="Name" rules={[{ required: true }]}>
            <Input />
          </Form.Item>
          <Form.Item name="username" label="Username" rules={[{ required: true }]}>
            <Input />
          </Form.Item>
          <Form.Item name="password" label="Password" rules={[{ required: true, min: 8 }]}>
            <Input.Password />
          </Form.Item>
          <Form.Item name="roles" label="Roles" rules={[{ required: true }]}>
            <Select
              mode="multiple"
              options={assignableRoles.map((r) => ({ label: r, value: r }))}
              onChange={() => {
                // Lab/reports-to only make sense for the roles that need them --
                // clear stale selections if the role selection no longer needs them.
                createForm.setFieldValue('laboratoryId', undefined);
                createForm.setFieldValue('reportsToUserId', undefined);
              }}
            />
          </Form.Item>
          {needsLab && (
            <Form.Item
              name="laboratoryId"
              label="Lab"
              rules={[{ required: true, message: 'Required for Lab In-charge/Analyst' }]}
            >
              <Select
                placeholder="Select a laboratory"
                options={(labs ?? []).map((l: Laboratory) => ({ label: l.name, value: l.id }))}
                onChange={() => createForm.setFieldValue('reportsToUserId', undefined)}
              />
            </Form.Item>
          )}
          {needsReportsTo && (
            <Form.Item
              name="reportsToUserId"
              label="Reports to (Lab In-charge)"
              rules={[{ required: true, message: 'Required for Analyst' }]}
            >
              <Select
                placeholder={createLabId ? 'Select a Lab In-charge' : 'Select a lab first'}
                disabled={!createLabId}
                options={labInchargesInLab.map((u) => ({ label: u.name, value: u.id }))}
                notFoundContent="No Lab In-charge assigned to that lab yet"
              />
            </Form.Item>
          )}
        </Form>
      </Modal>

      <Modal
        title={`Reset password for ${resetTarget?.name ?? ''}`}
        open={!!resetTarget}
        onCancel={() => setResetTarget(null)}
        onOk={() => resetForm.submit()}
        confirmLoading={resetPassword.isPending}
      >
        <Form
          form={resetForm}
          layout="vertical"
          onFinish={(v) => resetTarget && resetPassword.mutate({ userId: resetTarget.id, newPassword: v.newPassword })}
        >
          <Form.Item name="newPassword" label="New password" rules={[{ required: true, min: 8 }]}>
            <Input.Password />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title={`Reassign lab for ${reassignTarget?.name ?? ''}`}
        open={!!reassignTarget}
        onCancel={() => {
          setReassignTarget(null);
          reassignForm.resetFields();
        }}
        onOk={() => reassignForm.submit()}
        confirmLoading={reassignLab.isPending}
      >
        <Form
          form={reassignForm}
          layout="vertical"
          initialValues={{ laboratoryId: reassignTarget?.laboratoryId, reportsToUserId: reassignTarget?.reportsToUserId }}
          onFinish={(v) =>
            reassignTarget &&
            reassignLab.mutate({ userId: reassignTarget.id, laboratoryId: v.laboratoryId, reportsToUserId: v.reportsToUserId })
          }
        >
          <Form.Item name="laboratoryId" label="Lab" rules={[{ required: true }]}>
            <Select
              placeholder="Select a laboratory"
              options={(labs ?? []).map((l: Laboratory) => ({ label: l.name, value: l.id }))}
              onChange={() => reassignForm.setFieldValue('reportsToUserId', undefined)}
            />
          </Form.Item>
          {reassignNeedsReportsTo && (
            <Form.Item
              name="reportsToUserId"
              label="Reports to (Lab In-charge)"
              rules={[{ required: true, message: 'Required for Analyst' }]}
            >
              <Select
                placeholder={reassignLabId ? 'Select a Lab In-charge' : 'Select a lab first'}
                disabled={!reassignLabId}
                options={reassignLabIncharges
                  .filter((u) => u.id !== reassignTarget?.id)
                  .map((u) => ({ label: u.name, value: u.id }))}
                notFoundContent="No Lab In-charge assigned to that lab yet"
              />
            </Form.Item>
          )}
        </Form>
      </Modal>
    </Card>
  );
}

export function AdminPage() {
  const user = useAuthStore((s) => s.user);
  const isAdmin = !!user?.roles.includes('ADMIN');
  const isBorosilAdmin = !!user?.roles.includes('BOROSIL_ADMIN');

  if (!isAdmin && !isBorosilAdmin) {
    return <Navigate to="/" replace />;
  }

  const items = [
    isAdmin && { key: 'tenancy', label: 'Tenancy', children: <SitesLabsTab /> },
    isAdmin && { key: 'reactors', label: 'Reactors', children: <ReactorsTab /> },
    (isAdmin || isBorosilAdmin) && { key: 'licence', label: 'Licence', children: <LicenceTab /> },
    (isAdmin || isBorosilAdmin) && { key: 'users', label: 'Users', children: <UsersTab /> },
    isAdmin && { key: 'backups', label: 'Backups', children: <BackupsTab /> },
    isAdmin && { key: 'health', label: 'Health', children: <HealthTab /> },
  ].filter(Boolean) as { key: string; label: string; children: ReactNode }[];

  return (
    <div>
      <Typography.Title level={4}>Admin</Typography.Title>
      {isBorosilAdmin && !isAdmin && (
        <Typography.Paragraph type="secondary">
          Signed in as Borosil Admin -- licence control and user support only. Tenancy,
          backups, and health are managed by the client's own Admin account.
        </Typography.Paragraph>
      )}
      <Tabs items={items} />
    </div>
  );
}
