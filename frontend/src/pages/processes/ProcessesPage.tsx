import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Table, Tag, Button, Space, Modal, Form, Input, Select, DatePicker, InputNumber, App, Typography, Row, Col, Card } from 'antd';
import { Link } from 'react-router-dom';
import { processesApi, type CreateProcessBody } from '@/api/processes';
import { reactorsApi } from '@/api/reactors';
import { authApi } from '@/api/auth';
import { useAuthStore } from '@/store/auth.store';
import { RoleGate } from '@/auth/RoleGate';
import type { ProcessStatus } from '@/api/types';

const STATUS_COLORS: Record<ProcessStatus, string> = {
  SCHEDULED: 'default',
  ACCEPTED: 'cyan',
  RUNNING: 'green',
  PAUSED: 'orange',
  AWAITING_COMPLETION: 'gold',
  COMPLETED: 'blue',
  CANCELLED: 'default',
  ABORTED: 'red',
};

function CreateProcessModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [form] = Form.useForm();
  const qc = useQueryClient();
  const { message } = App.useApp();
  const currentUser = useAuthStore((s) => s.user);
  const { data: reactors } = useQuery({ queryKey: ['reactors'], queryFn: reactorsApi.list, enabled: open });
  const { data: users } = useQuery({ queryKey: ['users'], queryFn: authApi.users, enabled: open });

  const selectedEquipmentId = Form.useWatch('equipmentId', form);
  const selectedReactor = (reactors ?? []).find((r) => r.id === selectedEquipmentId);
  const targetLabId = selectedReactor?.laboratoryId;

  // Filter analysts strictly by the selected reactor's lab (or the Lab In-charge's assigned lab)
  const eligibleAnalysts = (users ?? []).filter((u) => {
    const isAnalyst = u.roles?.includes('ANALYST');
    if (!isAnalyst) return false;
    if (targetLabId) {
      return u.laboratoryId === targetLabId;
    }
    if (!currentUser?.isAdmin && currentUser?.laboratoryIds?.length) {
      return u.laboratoryId && currentUser.laboratoryIds.includes(u.laboratoryId);
    }
    return true;
  });

  const mutation = useMutation({
    mutationFn: (v: CreateProcessBody) => processesApi.create(v),
    onSuccess: () => {
      message.success('Process created');
      qc.invalidateQueries({ queryKey: ['processes'] });
      form.resetFields();
      onClose();
    },
    onError: (err: unknown) => {
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message;
      message.error(typeof msg === 'string' ? msg : 'Create failed');
    },
  });

  return (
    <Modal title="Schedule & Assign Process" open={open} onCancel={onClose} onOk={() => form.submit()} confirmLoading={mutation.isPending} width={640}>
      <Form
        form={form}
        layout="vertical"
        initialValues={{
          plannedDurationHours: 4,
          maxTemp: 80,
          maxTempRiseRate: 5.0,
          maxRpm: 500,
          maxRpmRiseRate: 150,
        }}
        onFinish={(v) =>
          mutation.mutate({
            name: v.name,
            equipmentId: v.equipmentId,
            description: v.description,
            plannedStartUtc: v.plannedStartUtc.toISOString(),
            plannedDurationS: Math.round(v.plannedDurationHours * 3600),
            analystUserIds: v.analystUserIds,
            thresholds: {
              temperature: {
                max: v.maxTemp,
                rate_rise_max: v.maxTempRiseRate,
              },
              rpm: {
                max: v.maxRpm,
                rate_rise_max: v.maxRpmRiseRate,
              },
            },
          })
        }
      >
        <Form.Item name="name" label="Process Name" rules={[{ required: true }]}>
          <Input placeholder="e.g. Synthesis Batch 42" />
        </Form.Item>
        <Form.Item name="equipmentId" label="Reactor" rules={[{ required: true }]}>
          <Select placeholder="Select reactor" options={(reactors ?? []).map((r) => ({ value: r.id, label: r.displayName || r.reactorNumber }))} />
        </Form.Item>
        <Row gutter={16}>
          <Col span={12}>
            <Form.Item name="plannedStartUtc" label="Planned Start Time" rules={[{ required: true }]}>
              <DatePicker showTime style={{ width: '100%' }} />
            </Form.Item>
          </Col>
          <Col span={12}>
            <Form.Item name="plannedDurationHours" label="Duration (hours)" rules={[{ required: true }]}>
              <InputNumber min={0.1} step={0.5} style={{ width: '100%' }} />
            </Form.Item>
          </Col>
        </Row>
        <Form.Item
          name="analystUserIds"
          label={`Assigned Analysts (First = Primary Owner on Device)${targetLabId ? ' - Filtered to Reactor Lab' : ''}`}
          rules={[{ required: true, message: 'Please select an analyst' }]}
        >
          <Select
            mode="multiple"
            placeholder={targetLabId ? 'Select analyst(s) from this lab' : 'Select a reactor first to filter lab analysts'}
            options={eligibleAnalysts.map((u) => ({
              value: u.id,
              label: `${u.name} ${u.laboratoryName ? `(${u.laboratoryName})` : ''}`,
            }))}
            notFoundContent={targetLabId ? 'No analysts assigned to this lab' : 'Please select a reactor above'}
          />
        </Form.Item>

        <Card size="small" title="Safety Thresholds & Rate-of-Change Limits (Fire Hazard Prevention)" style={{ marginBottom: 16, background: '#fafafa' }}>
          <Row gutter={16}>
            <Col span={12}>
              <Form.Item name="maxTemp" label="Max Temperature (°C)" rules={[{ required: true }]}>
                <InputNumber min={0} max={300} style={{ width: '100%' }} />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="maxTempRiseRate" label="Max Temp Rise Rate (°C/min)" rules={[{ required: true }]} tooltip="Anti-thermal runaway guard: alarms & sirens if temperature rises faster than this limit">
                <InputNumber min={0.1} max={50} step={0.5} style={{ width: '100%' }} />
              </Form.Item>
            </Col>
          </Row>
          <Row gutter={16}>
            <Col span={12}>
              <Form.Item name="maxRpm" label="Max Motor Speed (RPM)" rules={[{ required: true }]}>
                <InputNumber min={0} max={2000} style={{ width: '100%' }} />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="maxRpmRiseRate" label="Max RPM Rise Rate (RPM/min)" rules={[{ required: true }]} tooltip="Motor runaway guard: alarms & sirens if speed surges unexpectedly">
                <InputNumber min={1} max={1000} step={10} style={{ width: '100%' }} />
              </Form.Item>
            </Col>
          </Row>
        </Card>

        <Form.Item name="description" label="Process Description / Remarks">
          <Input.TextArea rows={2} placeholder="Optional operational notes" />
        </Form.Item>
      </Form>
    </Modal>
  );
}

export function ProcessesPage() {
  const { data: processes, isLoading } = useQuery({ queryKey: ['processes'], queryFn: processesApi.list });
  const { data: reactors } = useQuery({ queryKey: ['reactors'], queryFn: reactorsApi.list });
  const [createOpen, setCreateOpen] = useState(false);
  const reactorName = (id: string) => reactors?.find((r) => r.id === id)?.displayName ?? reactors?.find((r) => r.id === id)?.reactorNumber ?? id;

  const columns = [
    { title: 'Name', dataIndex: 'name', key: 'name', render: (name: string, p: { id: string }) => <Link to={`/processes/${p.id}`}>{name}</Link> },
    { title: 'Reactor', dataIndex: 'equipmentId', key: 'equipmentId', render: reactorName },
    {
      title: 'Assigned Analyst',
      key: 'assignedAnalyst',
      render: (_: unknown, p: any) => {
        if (!p.ownerAnalystName) {
          return <span style={{ color: '#8c8c8c', fontStyle: 'italic' }}>Unassigned</span>;
        }
        const statusColors: Record<string, string> = {
          ACCEPTED: 'green',
          PENDING: 'gold',
          REJECTED: 'red',
          RELEASED: 'default',
        };
        return (
          <Space size="small">
            <Typography.Text strong>{p.ownerAnalystName}</Typography.Text>
            {p.ownerStatus && <Tag color={statusColors[p.ownerStatus] || 'default'}>{p.ownerStatus}</Tag>}
          </Space>
        );
      },
    },
    { title: 'Status', dataIndex: 'status', key: 'status', render: (s: ProcessStatus) => <Tag color={STATUS_COLORS[s]}>{s}</Tag> },
    { title: 'Planned start', dataIndex: 'plannedStartUtc', key: 'plannedStartUtc', render: (t: string) => new Date(t).toLocaleString() },
    { title: 'Planned end', dataIndex: 'plannedEndUtc', key: 'plannedEndUtc', render: (t: string) => new Date(t).toLocaleString() },
  ];

  return (
    <div>
      <Space style={{ marginBottom: 16, width: '100%', justifyContent: 'space-between' }} wrap>
        <Typography.Title level={4} style={{ margin: 0 }}>
          Processes
        </Typography.Title>
        <RoleGate roles={['ADMIN', 'LAB_INCHARGE']}>
          <Button type="primary" onClick={() => setCreateOpen(true)}>
            New process
          </Button>
        </RoleGate>
      </Space>
      <Table rowKey="id" columns={columns} dataSource={processes ?? []} loading={isLoading} scroll={{ x: 'max-content' }} />
      <CreateProcessModal open={createOpen} onClose={() => setCreateOpen(false)} />
    </div>
  );
}
