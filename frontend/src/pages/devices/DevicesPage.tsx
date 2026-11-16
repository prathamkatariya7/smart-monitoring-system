import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Table, Tag, Button, Space, Modal, Form, Input, Select, App, Drawer, Typography, Grid } from 'antd';
import { devicesApi } from '@/api/devices';
import { reactorsApi } from '@/api/reactors';
import type { Device } from '@/api/types';

function ClaimModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [form] = Form.useForm();
  const qc = useQueryClient();
  const { message } = App.useApp();
  const mutation = useMutation({
    mutationFn: devicesApi.claim,
    onSuccess: () => {
      message.success('Device claimed / reactivated');
      qc.invalidateQueries({ queryKey: ['devices'] });
      qc.invalidateQueries({ queryKey: ['reactors'] });
      form.resetFields();
      onClose();
    },
    onError: (err: unknown) => {
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message;
      message.error(typeof msg === 'string' ? msg : 'Claim failed');
    },
  });

  return (
    <Modal title="Claim Device" open={open} onCancel={onClose} onOk={() => form.submit()} confirmLoading={mutation.isPending}>
      <Typography.Paragraph type="secondary" style={{ fontSize: '0.85em', marginBottom: 16 }}>
        Connect new reactor hardware to your organisation. You can view and copy the <strong>Serial Number</strong> and <strong>Claim Code</strong> directly from the device&apos;s Wi-Fi setup page (192.168.4.1) during provisioning.
      </Typography.Paragraph>
      <Form form={form} layout="vertical" onFinish={(v) => mutation.mutate(v)}>
        <Form.Item name="serialNo" label="Serial Number" rules={[{ required: true, message: 'Please enter the device serial number' }]}>
          <Input placeholder="e.g. DEV-0001 or DEV-A1B2C3" />
        </Form.Item>
        <Form.Item name="claimCode" label="Claim Code / Device ID" rules={[{ required: true, message: 'Please enter the claim code' }]}>
          <Input placeholder="e.g. 01a1af2d-e705-75aa-b3fc-25b0cebb4882" />
        </Form.Item>
        <Form.Item name="hwRevision" label="Hardware Revision (Optional)">
          <Input placeholder="e.g. Waveshare ESP32-P4 v1.0" />
        </Form.Item>
        <Form.Item name="certSerial" label="Certificate Serial (Optional)">
          <Input placeholder="Client mTLS certificate serial" />
        </Form.Item>
      </Form>
    </Modal>
  );
}

function BindModal({ device, onClose }: { device: Device | null; onClose: () => void }) {
  const [form] = Form.useForm();
  const qc = useQueryClient();
  const { message } = App.useApp();
  const { data: reactors } = useQuery({ queryKey: ['reactors'], queryFn: reactorsApi.list, enabled: !!device });
  const mutation = useMutation({
    mutationFn: (v: { equipmentId: string; reason: string }) => devicesApi.bind(device!.id, v),
    onSuccess: () => {
      message.success('Device bound');
      qc.invalidateQueries({ queryKey: ['devices'] });
      qc.invalidateQueries({ queryKey: ['reactors'] });
      form.resetFields();
      onClose();
    },
    onError: (err: unknown) => {
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message;
      message.error(typeof msg === 'string' ? msg : 'Bind failed');
    },
  });

  return (
    <Modal
      title={`Bind ${device?.serialNo ?? ''} to a reactor`}
      open={!!device}
      onCancel={onClose}
      onOk={() => form.submit()}
      confirmLoading={mutation.isPending}
    >
      <Form form={form} layout="vertical" onFinish={(v) => mutation.mutate(v)}>
        <Form.Item name="equipmentId" label="Reactor" rules={[{ required: true, message: 'Please select a reactor' }]}>
          <Select
            placeholder="Select an unbound reactor"
            options={(reactors ?? []).map((r) => {
              const inUse = !!r.boundDeviceId;
              return {
                value: r.id,
                label: inUse
                  ? `${r.displayName || r.reactorNumber} (Already in use)`
                  : (r.displayName || r.reactorNumber),
                disabled: inUse,
              };
            })}
          />
        </Form.Item>
        <Form.Item name="reason" label="Reason" rules={[{ required: true }]}>
          <Input.TextArea rows={2} />
        </Form.Item>
      </Form>
    </Modal>
  );
}

function HistoryDrawer({ device, onClose }: { device: Device | null; onClose: () => void }) {
  const screens = Grid.useBreakpoint();
  const { data: history } = useQuery({
    queryKey: ['device-history', device?.id],
    queryFn: () => devicesApi.history(device!.id),
    enabled: !!device,
  });
  const columns = [
    { title: 'Equipment', dataIndex: 'equipmentId', key: 'equipmentId' },
    { title: 'Bound from', dataIndex: 'boundFrom', key: 'boundFrom', render: (t: string) => new Date(t).toLocaleString() },
    {
      title: 'Bound to',
      dataIndex: 'boundTo',
      key: 'boundTo',
      render: (t: string | null) => (t ? new Date(t).toLocaleString() : <Tag color="green">open</Tag>),
    },
    { title: 'Reason', dataIndex: 'reason', key: 'reason' },
  ];
  return (
    <Drawer title={`Binding history: ${device?.serialNo ?? ''}`} open={!!device} onClose={onClose} size={screens.sm ? 560 : '100vw'}>
      <Table rowKey="id" columns={columns} dataSource={history ?? []} pagination={false} size="small" scroll={{ x: 'max-content' }} />
    </Drawer>
  );
}

export function DevicesPage() {
  const { data: devices, isLoading } = useQuery({
    queryKey: ['devices'],
    queryFn: devicesApi.list,
    refetchInterval: 4000,
  });
  const [claimOpen, setClaimOpen] = useState(false);
  const [bindDevice, setBindDevice] = useState<Device | null>(null);
  const [historyDevice, setHistoryDevice] = useState<Device | null>(null);
  const qc = useQueryClient();
  const { message, modal } = App.useApp();

  const unbindMutation = useMutation({
    mutationFn: (device: Device) => devicesApi.unbind(device.id, 'Unbound via admin UI'),
    onSuccess: () => {
      message.success('Unbound');
      qc.invalidateQueries({ queryKey: ['devices'] });
      qc.invalidateQueries({ queryKey: ['reactors'] });
    },
  });
  const decommissionMutation = useMutation({
    mutationFn: (device: Device) => devicesApi.decommission(device.id, 'Decommissioned via admin UI'),
    onSuccess: () => {
      message.success('Decommissioned');
      qc.invalidateQueries({ queryKey: ['devices'] });
      qc.invalidateQueries({ queryKey: ['reactors'] });
    },
  });
  const reactivateMutation = useMutation({
    mutationFn: (device: Device) => devicesApi.reactivate(device.id, 'Reclaimed / reactivated via admin UI'),
    onSuccess: () => {
      message.success('Device reactivated');
      qc.invalidateQueries({ queryKey: ['devices'] });
      qc.invalidateQueries({ queryKey: ['reactors'] });
    },
    onError: (err: unknown) => {
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message;
      message.error(typeof msg === 'string' ? msg : 'Reactivate failed');
    },
  });

  const columns = [
    { title: 'Serial No', dataIndex: 'serialNo', key: 'serialNo' },
    { title: 'HW Rev', dataIndex: 'hwRevision', key: 'hwRevision' },
    {
      title: 'Claim state',
      dataIndex: 'claimState',
      key: 'claimState',
      render: (s: string) => <Tag color={s === 'CLAIMED' ? 'blue' : 'default'}>{s}</Tag>,
    },
    {
      title: 'Binding / Reactor',
      key: 'binding',
      render: (_: unknown, device: Device) => {
        if (device.currentBinding) {
          const name = device.currentBinding.displayName || device.currentBinding.reactorNumber || 'Reactor';
          return (
            <Tag color="cyan" style={{ fontWeight: 600 }}>
              🔗 Bound: {name}
            </Tag>
          );
        }
        return <Tag color="default">Unbound</Tag>;
      },
    },
    {
      title: 'Status',
      key: 'status',
      render: (_: unknown, device: Device) => {
        if (device.status === 'DECOMMISSIONED') {
          return <Tag color="error">Decommissioned</Tag>;
        }
        return device.online ? (
          <Tag color="success">● Online</Tag>
        ) : (
          <Tag color="default">○ Offline</Tag>
        );
      },
    },
    {
      title: 'Last telemetry',
      dataIndex: 'lastTelemetryAt',
      key: 'lastTelemetryAt',
      render: (t: string | null) => (t ? new Date(t).toLocaleString() : '-'),
    },
    { title: 'Last seen', dataIndex: 'lastSeen', key: 'lastSeen', render: (t: string | null) => (t ? new Date(t).toLocaleString() : '-') },
    { title: 'Firmware (P4)', dataIndex: 'fwP4', key: 'fwP4', render: (v: string | null) => v ?? '-' },
    {
      title: 'Actions',
      key: 'actions',
      render: (_: unknown, device: Device) => {
        const isDecommissioned = device.status === 'DECOMMISSIONED';
        const isBound = !!device.currentBinding;
        return (
          <Space>
            <Button size="small" onClick={() => setHistoryDevice(device)}>
              History
            </Button>
            {isDecommissioned && (
              <Button
                size="small"
                type="primary"
                style={{ backgroundColor: '#52c41a', borderColor: '#52c41a' }}
                onClick={() =>
                  modal.confirm({
                    title: `Reclaim / Reactivate ${device.serialNo}?`,
                    content: `This will restore device ${device.serialNo} back to active state. Its hardware will resume telemetry and become available for binding.`,
                    okText: 'Reclaim',
                    onOk: () => reactivateMutation.mutate(device),
                  })
                }
              >
                Reclaim
              </Button>
            )}
            {device.claimState === 'CLAIMED' && !isDecommissioned && (
              <>
                {!isBound ? (
                  <Button size="small" type="primary" onClick={() => setBindDevice(device)}>
                    Bind
                  </Button>
                ) : (
                  <Button
                    size="small"
                    danger
                    onClick={() =>
                      modal.confirm({
                        title: `Unbind ${device.serialNo}?`,
                        content: `This will unbind the device from ${device.currentBinding?.displayName || device.currentBinding?.reactorNumber || 'its reactor'}. The device screen will switch to Unbound immediately.`,
                        okText: 'Unbind',
                        okType: 'danger',
                        onOk: () => unbindMutation.mutate(device),
                      })
                    }
                  >
                    Unbind
                  </Button>
                )}
                <Button
                  size="small"
                  danger
                  onClick={() =>
                    modal.confirm({
                      title: `Decommission ${device.serialNo}?`,
                      content: 'This permanently deactivates this hardware device. Any open binding will be closed and the server will reject its data.',
                      okText: 'Decommission',
                      okType: 'danger',
                      onOk: () => decommissionMutation.mutate(device),
                    })
                  }
                >
                  Decommission
                </Button>
              </>
            )}
          </Space>
        );
      },
    },
  ];

  return (
    <div>
      <Space style={{ marginBottom: 16, width: '100%', justifyContent: 'space-between' }} wrap>
        <Typography.Title level={4} style={{ margin: 0 }}>
          Devices
        </Typography.Title>
        <Button type="primary" onClick={() => setClaimOpen(true)}>
          Claim device
        </Button>
      </Space>
      <Table rowKey="id" columns={columns} dataSource={devices ?? []} loading={isLoading} scroll={{ x: 'max-content' }} />
      <ClaimModal open={claimOpen} onClose={() => setClaimOpen(false)} />
      <BindModal device={bindDevice} onClose={() => setBindDevice(null)} />
      <HistoryDrawer device={historyDevice} onClose={() => setHistoryDevice(null)} />
    </div>
  );
}
