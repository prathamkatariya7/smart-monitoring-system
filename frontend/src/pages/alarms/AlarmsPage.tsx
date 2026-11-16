import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Table, Tag, Button, Space, Modal, Form, Input, InputNumber, App, Typography, Tabs } from 'antd';
import { alarmsApi } from '@/api/alarms';
import { RoleGate } from '@/auth/RoleGate';
import type { Alarm, AlertOverride, AlertCatalog } from '@/api/types';

function OverrideModal({ alarm, onClose }: { alarm: Alarm | null; onClose: () => void }) {
  const [form] = Form.useForm();
  const qc = useQueryClient();
  const { message } = App.useApp();
  const mutation = useMutation({
    mutationFn: (v: { reasonCode: string; reasonText?: string; durationMin: number }) => alarmsApi.override(alarm!.id, v),
    onSuccess: () => {
      message.success('Override requested');
      qc.invalidateQueries({ queryKey: ['overrides'] });
      qc.invalidateQueries({ queryKey: ['alarms'] });
      form.resetFields();
      onClose();
    },
    onError: (err: unknown) => {
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message;
      message.error(typeof msg === 'string' ? msg : 'Override failed');
    },
  });
  return (
    <Modal title="Request alarm override" open={!!alarm} onCancel={onClose} onOk={() => form.submit()} confirmLoading={mutation.isPending}>
      <Form form={form} layout="vertical" onFinish={(v) => mutation.mutate(v)}>
        <Form.Item name="reasonCode" label="Reason code" rules={[{ required: true }]}>
          <Input placeholder="e.g. KNOWN_SENSOR_DRIFT" />
        </Form.Item>
        <Form.Item name="reasonText" label="Details">
          <Input.TextArea rows={2} />
        </Form.Item>
        <Form.Item name="durationMin" label="Duration (minutes)" rules={[{ required: true }]} initialValue={60}>
          <InputNumber min={1} max={1440} style={{ width: '100%' }} />
        </Form.Item>
      </Form>
    </Modal>
  );
}

function AlarmsTab() {
  const { data: alarms, isLoading } = useQuery({ queryKey: ['alarms'], queryFn: alarmsApi.listAll, refetchInterval: 10000 });
  const qc = useQueryClient();
  const { message } = App.useApp();
  const [overrideAlarm, setOverrideAlarm] = useState<Alarm | null>(null);

  const ackMutation = useMutation({
    mutationFn: (id: string) => alarmsApi.ack(id),
    onSuccess: () => {
      message.success('Acknowledged');
      qc.invalidateQueries({ queryKey: ['alarms'] });
    },
  });

  const columns = [
    { title: 'Parameter', dataIndex: 'parameter', key: 'parameter' },
    { title: 'Kind', dataIndex: 'kind', key: 'kind' },
    {
      title: 'Severity',
      dataIndex: 'severity',
      key: 'severity',
      render: (s: string) => <Tag color={s === 'CRITICAL' ? 'red' : s === 'WARNING' ? 'orange' : 'blue'}>{s}</Tag>,
    },
    { title: 'State', dataIndex: 'state', key: 'state', render: (s: string) => <Tag>{s}</Tag> },
    { title: 'Onset', dataIndex: 'onsetTs', key: 'onsetTs', render: (t: string) => new Date(t).toLocaleString() },
    { title: 'Origin', dataIndex: 'origin', key: 'origin' },
    {
      title: 'Actions',
      key: 'actions',
      render: (_: unknown, a: Alarm) => (
        <Space>
          {a.state === 'ACTIVE_UNACK' && (
            <Button size="small" onClick={() => ackMutation.mutate(a.id)}>
              Acknowledge
            </Button>
          )}
          {(a.state === 'ACTIVE_UNACK' || a.state === 'ACTIVE_ACK') && (
            <Button size="small" onClick={() => setOverrideAlarm(a)}>
              Override
            </Button>
          )}
        </Space>
      ),
    },
  ];

  return (
    <>
      <Table rowKey="id" columns={columns} dataSource={alarms ?? []} loading={isLoading} size="small" scroll={{ x: 'max-content' }} />
      <OverrideModal alarm={overrideAlarm} onClose={() => setOverrideAlarm(null)} />
    </>
  );
}

function OverridesTab() {
  const { data: overrides, isLoading } = useQuery({ queryKey: ['overrides'], queryFn: () => alarmsApi.listOverrides() });
  const qc = useQueryClient();
  const { message, modal } = App.useApp();

  const revokeMutation = useMutation({
    mutationFn: (id: string) => alarmsApi.revokeOverride(id, 'Revoked via web UI'),
    onSuccess: () => {
      message.success('Revoked');
      qc.invalidateQueries({ queryKey: ['overrides'] });
    },
  });
  const seenMutation = useMutation({
    mutationFn: (id: string) => alarmsApi.markOverrideSeen(id),
    onSuccess: () => {
      message.success('Marked seen');
      qc.invalidateQueries({ queryKey: ['overrides'] });
    },
  });

  const columns = [
    { title: 'Alert type', dataIndex: 'alertType', key: 'alertType' },
    { title: 'Reason', dataIndex: 'reasonCode', key: 'reasonCode' },
    { title: 'Severity', dataIndex: 'severity', key: 'severity', render: (s: string) => <Tag>{s}</Tag> },
    { title: 'Planned expiry', dataIndex: 'plannedExpiry', key: 'plannedExpiry', render: (t: string) => new Date(t).toLocaleString() },
    {
      title: 'Ended',
      dataIndex: 'endedAt',
      key: 'endedAt',
      render: (t: string | null, o: AlertOverride) => (t ? `${o.endCause} @ ${new Date(t).toLocaleString()}` : <Tag color="blue">active</Tag>),
    },
    {
      title: 'Actions',
      key: 'actions',
      render: (_: unknown, o: AlertOverride) => (
        <Space>
          {!o.endedAt && (
            <Button
              size="small"
              danger
              onClick={() => modal.confirm({ title: 'Revoke override?', onOk: () => revokeMutation.mutate(o.id) })}
            >
              Revoke
            </Button>
          )}
          {!o.seenAt && (
            <Button size="small" onClick={() => seenMutation.mutate(o.id)}>
              Mark seen
            </Button>
          )}
        </Space>
      ),
    },
  ];

  return <Table rowKey="id" columns={columns} dataSource={overrides ?? []} loading={isLoading} size="small" scroll={{ x: 'max-content' }} />;
}

function AlertCatalogTab() {
  const { data: catalog, isLoading } = useQuery({ queryKey: ['alert-catalog'], queryFn: alarmsApi.alertCatalog });
  const columns = [
    { title: 'Alert type', dataIndex: 'alertType', key: 'alertType' },
    { title: 'Class', dataIndex: 'class', key: 'class', render: (c: string) => <Tag>{c}</Tag> },
    { title: 'Overridable by', dataIndex: 'overridableBy', key: 'overridableBy' },
    { title: 'Max override (min)', dataIndex: 'maxOverrideMin', key: 'maxOverrideMin' },
    { title: 'Sound', dataIndex: 'soundPattern', key: 'soundPattern', render: (v: string | null) => v ?? '-' },
  ];
  return <Table rowKey="id" columns={columns} dataSource={(catalog ?? []) as AlertCatalog[]} loading={isLoading} size="small" scroll={{ x: 'max-content' }} />;
}

export function AlarmsPage() {
  return (
    <div>
      <Typography.Title level={4}>Alarms & Overrides</Typography.Title>
      <Tabs
        items={[
          { key: 'alarms', label: 'Alarms', children: <AlarmsTab /> },
          { key: 'overrides', label: 'Overrides', children: <OverridesTab /> },
          {
            key: 'catalog',
            label: 'Alert catalog',
            children: (
              <RoleGate roles={['ADMIN']}>
                <AlertCatalogTab />
              </RoleGate>
            ),
          },
        ]}
      />
    </div>
  );
}
