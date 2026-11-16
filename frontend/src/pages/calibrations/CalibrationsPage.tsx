import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Table,
  Button,
  Space,
  Modal,
  Form,
  Input,
  Select,
  App,
  Tag,
  Card,
  Typography,
} from 'antd';
import { ToolOutlined, PlusOutlined } from '@ant-design/icons';
import { reactorsApi } from '@/api/reactors';
import { calibrationsApi, type CreateCalibrationBody } from '@/api/calibrations';
import { devicesApi } from '@/api/devices';
import type { Equipment, CalibrationVersion } from '@/api/types';

export function CalibrationsPage() {
  const qc = useQueryClient();
  const { message } = App.useApp();
  const [modalOpen, setModalOpen] = useState(false);
  const [rollbackTarget, setRollbackTarget] = useState<CalibrationVersion | null>(null);
  const [form] = Form.useForm();
  const [rollbackForm] = Form.useForm();

  const { data: calibrations, isLoading } = useQuery({
    queryKey: ['calibrations'],
    queryFn: () => calibrationsApi.list(),
  });

  const { data: reactors } = useQuery({
    queryKey: ['reactors'],
    queryFn: reactorsApi.list,
  });

  const { data: devices } = useQuery({
    queryKey: ['devices'],
    queryFn: devicesApi.list,
  });

  const createMutation = useMutation({
    mutationFn: (body: CreateCalibrationBody) => calibrationsApi.create(body),
    onSuccess: () => {
      message.success('Calibration draft created successfully');
      qc.invalidateQueries({ queryKey: ['calibrations'] });
      setModalOpen(false);
      form.resetFields();
    },
    onError: (err: unknown) => {
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message;
      message.error(typeof msg === 'string' ? msg : 'Failed to create calibration');
    },
  });

  const approveMutation = useMutation({
    mutationFn: (id: string) => calibrationsApi.approve(id),
    onSuccess: () => {
      message.success('Calibration approved');
      qc.invalidateQueries({ queryKey: ['calibrations'] });
    },
    onError: (err: unknown) => {
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message;
      message.error(typeof msg === 'string' ? msg : 'Approval failed');
    },
  });

  const applyMutation = useMutation({
    mutationFn: (id: string) => calibrationsApi.apply(id),
    onSuccess: () => {
      message.success('Calibration coefficients applied and pushed to device');
      qc.invalidateQueries({ queryKey: ['calibrations'] });
    },
    onError: (err: unknown) => {
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message;
      message.error(typeof msg === 'string' ? msg : 'Apply failed');
    },
  });

  const rollbackMutation = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) => calibrationsApi.rollback(id, reason),
    onSuccess: () => {
      message.success('Calibration rolled back');
      qc.invalidateQueries({ queryKey: ['calibrations'] });
      setRollbackTarget(null);
      rollbackForm.resetFields();
    },
    onError: (err: unknown) => {
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message;
      message.error(typeof msg === 'string' ? msg : 'Rollback failed');
    },
  });

  const columns = [
    {
      title: 'Reactor / Equipment',
      key: 'equipment',
      render: (_: unknown, r: CalibrationVersion) => {
        const reactor = (reactors ?? []).find((eq) => eq.id === r.equipmentId);
        return reactor?.displayName || reactor?.reactorNumber || r.equipmentId;
      },
    },
    {
      title: 'Channel',
      dataIndex: 'channel',
      key: 'channel',
      render: (v: string) => <Tag color="blue">{v?.toUpperCase()}</Tag>,
    },
    {
      title: 'Method',
      dataIndex: 'method',
      key: 'method',
    },
    {
      title: 'Correction Coefficients',
      key: 'coefficients',
      render: (_: unknown, r: CalibrationVersion) => {
        const coeff = (r.coefficientsJson as any) ?? {};
        const a = typeof coeff.a === 'number' ? coeff.a.toFixed(4) : '1.0000';
        const b = typeof coeff.b === 'number' ? (coeff.b >= 0 ? `+${coeff.b.toFixed(2)}` : coeff.b.toFixed(2)) : '0.00';
        return <code>T_cal = ({a} × T_raw) {b}</code>;
      },
    },
    {
      title: 'Error Points',
      key: 'errors',
      render: (_: unknown, r: CalibrationVersion) => {
        const errs = (r.errorSummary as any)?.errors;
        if (!Array.isArray(errs)) return '-';
        return errs.map((e: any, idx: number) => (
          <div key={idx} style={{ fontSize: 12 }}>
            Ref: {e.reference}°C → Ind: {e.indicated}°C (Err: {e.error >= 0 ? `+${e.error}` : e.error}°C)
          </div>
        ));
      },
    },
    {
      title: 'Certificate / Tool',
      key: 'cert',
      render: (_: unknown, r: CalibrationVersion) => (
        <div>
          <div>{r.certificateNo || 'No cert #'}</div>
          <small style={{ color: '#888' }}>{r.referenceInstrument || '-'}</small>
        </div>
      ),
    },
    {
      title: 'Status',
      dataIndex: 'status',
      key: 'status',
      render: (s: string) => {
        const colors: Record<string, string> = {
          DRAFT: 'orange',
          APPROVED: 'geekblue',
          APPLIED: 'green',
          SUPERSEDED: 'default',
          ROLLED_BACK: 'red',
        };
        return <Tag color={colors[s] || 'default'}>{s}</Tag>;
      },
    },
    {
      title: 'Actions',
      key: 'actions',
      render: (_: unknown, r: CalibrationVersion) => (
        <Space size="small">
          {r.status === 'DRAFT' && (
            <Button
              size="small"
              type="primary"
              onClick={() => approveMutation.mutate(r.id)}
              loading={approveMutation.isPending}
            >
              Approve
            </Button>
          )}
          {r.status === 'APPROVED' && (
            <Button
              size="small"
              type="primary"
              style={{ background: '#52c41a', borderColor: '#52c41a' }}
              onClick={() => applyMutation.mutate(r.id)}
              loading={applyMutation.isPending}
            >
              Apply to Device
            </Button>
          )}
          {r.status === 'APPLIED' && (
            <Button size="small" danger onClick={() => setRollbackTarget(r)}>
              Rollback
            </Button>
          )}
        </Space>
      ),
    },
  ];

  return (
    <div>
      <Typography.Title level={4} style={{ marginBottom: 16 }}>
        <ToolOutlined style={{ marginRight: 8 }} />
        Sensor Calibrations &amp; Drift Management
      </Typography.Title>
      <Card
        extra={
          <Button type="primary" icon={<PlusOutlined />} onClick={() => setModalOpen(true)}>
            New Sensor Calibration
          </Button>
        }
      >
        <Table
          rowKey="id"
          columns={columns}
          dataSource={calibrations ?? []}
          loading={isLoading}
          scroll={{ x: 'max-content' }}
        />

        <Modal
          title="Calibrate Temperature / Sensor Probe"
          open={modalOpen}
          onCancel={() => {
            setModalOpen(false);
            form.resetFields();
          }}
          onOk={() => form.submit()}
          confirmLoading={createMutation.isPending}
          width={600}
        >
          <Form
            form={form}
            layout="vertical"
            initialValues={{
              channel: 'temperature',
              method: 'two_point',
              ref1: 0.0,
              ind1: 0.4,
              ref2: 100.0,
              ind2: 100.8,
              referenceInstrument: 'Fluke 724 RTD Calibrator',
              certificateNo: 'NABL-CAL-2026-001',
              reason: 'Routine annual calibration & sensor drift correction',
            }}
            onFinish={(v) => {
              const points = [
                { reference: Number(v.ref1), indicated: Number(v.ind1) },
                { reference: Number(v.ref2), indicated: Number(v.ind2) },
              ];
              createMutation.mutate({
                equipmentId: v.equipmentId,
                deviceId: v.deviceId,
                channel: v.channel,
                method: v.method,
                points,
                referenceInstrument: v.referenceInstrument,
                certificateNo: v.certificateNo,
                reason: v.reason,
              });
            }}
          >
            <Form.Item name="equipmentId" label="Select Reactor / Equipment" rules={[{ required: true }]}>
              <Select
                placeholder="Select reactor"
                options={(reactors ?? []).map((r: Equipment) => ({
                  value: r.id,
                  label: `${r.displayName || r.reactorNumber} (${r.status})`,
                }))}
              />
            </Form.Item>

            <Form.Item name="deviceId" label="Associated Device" tooltip="Select the ESP32 hardware device attached to this reactor">
              <Select
                placeholder="Optional device override"
                allowClear
                options={(devices ?? []).map((d) => ({
                  value: d.id,
                  label: `${d.serialNo} (${d.status}) - ${d.id}`,
                }))}
              />
            </Form.Item>

            <Form.Item name="channel" label="Channel">
              <Select
                options={[
                  { value: 'temperature', label: 'Temperature (°C)' },
                  { value: 'rpm', label: 'Stirrer RPM' },
                  { value: 'torque', label: 'Torque (Ncm)' },
                ]}
              />
            </Form.Item>

            <Form.Item name="method" label="Calibration Method">
              <Select
                options={[
                  { value: 'two_point', label: '2-Point Linear (Zero & Span)' },
                  { value: 'single_point', label: '1-Point Offset' },
                ]}
              />
            </Form.Item>

            <Typography.Text strong style={{ display: 'block', marginBottom: 8 }}>
              Calibration Calibration Points (Actual vs Indicated):
            </Typography.Text>
            <Space style={{ display: 'flex', marginBottom: 8 }} align="baseline">
              <Form.Item label="Ref 1 (°C)" name="ref1" rules={[{ required: true }]}>
                <Input type="number" step="0.1" style={{ width: 110 }} />
              </Form.Item>
              <Form.Item label="Indicated 1 (°C)" name="ind1" rules={[{ required: true }]}>
                <Input type="number" step="0.1" style={{ width: 110 }} />
              </Form.Item>
            </Space>

            <Space style={{ display: 'flex', marginBottom: 16 }} align="baseline">
              <Form.Item label="Ref 2 (°C)" name="ref2" rules={[{ required: true }]}>
                <Input type="number" step="0.1" style={{ width: 110 }} />
              </Form.Item>
              <Form.Item label="Indicated 2 (°C)" name="ind2" rules={[{ required: true }]}>
                <Input type="number" step="0.1" style={{ width: 110 }} />
              </Form.Item>
            </Space>

            <Form.Item name="referenceInstrument" label="Reference Standard / Calibrator">
              <Input placeholder="e.g. Fluke 724 Temperature Calibrator" />
            </Form.Item>

            <Form.Item name="certificateNo" label="Traceability Certificate #">
              <Input placeholder="e.g. NABL-CAL-2026-001" />
            </Form.Item>

            <Form.Item name="reason" label="Justification / Calibration Reason">
              <Input.TextArea rows={2} placeholder="Reason for new calibration" />
            </Form.Item>
          </Form>
        </Modal>

        <Modal
          title="Rollback Calibration"
          open={!!rollbackTarget}
          onCancel={() => {
            setRollbackTarget(null);
            rollbackForm.resetFields();
          }}
          onOk={() => rollbackForm.submit()}
          confirmLoading={rollbackMutation.isPending}
        >
          <Form
            form={rollbackForm}
            layout="vertical"
            onFinish={(v) => {
              if (rollbackTarget) {
                rollbackMutation.mutate({ id: rollbackTarget.id, reason: v.reason });
              }
            }}
          >
            <Form.Item name="reason" label="Rollback Reason" rules={[{ required: true }]}>
              <Input.TextArea rows={3} placeholder="Explain why this calibration is being reverted" />
            </Form.Item>
          </Form>
        </Modal>
      </Card>
    </div>
  );
}
