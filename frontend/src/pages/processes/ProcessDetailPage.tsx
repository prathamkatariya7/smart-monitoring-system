import { useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Card, Descriptions, Tag, Space, Button, Breadcrumb, Table, Spin, Modal, Form, Input, InputNumber, App } from 'antd';
import { processesApi } from '@/api/processes';
import { reactorsApi } from '@/api/reactors';
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

/** Reason-required actions open this modal; others fire immediately. */
function ReasonModal({
  title,
  open,
  onClose,
  onSubmit,
  loading,
  extraField,
}: {
  title: string;
  open: boolean;
  onClose: () => void;
  onSubmit: (reason: string, extra?: number) => void;
  loading: boolean;
  extraField?: { label: string; name: string };
}) {
  const [form] = Form.useForm();
  return (
    <Modal
      title={title}
      open={open}
      onCancel={onClose}
      confirmLoading={loading}
      onOk={() => form.submit()}
    >
      <Form form={form} layout="vertical" onFinish={(v) => onSubmit(v.reason, v.extra)}>
        {extraField && (
          <Form.Item name="extra" label={extraField.label} rules={[{ required: true }]}>
            <InputNumber style={{ width: '100%' }} min={1} />
          </Form.Item>
        )}
        <Form.Item name="reason" label="Reason" rules={[{ required: true }]}>
          <Input.TextArea rows={3} />
        </Form.Item>
      </Form>
    </Modal>
  );
}

export function ProcessDetailPage() {
  const { id } = useParams<{ id: string }>();
  const qc = useQueryClient();
  const { message } = App.useApp();
  const [modal, setModal] = useState<'pause' | 'cancel' | 'abort' | 'restart' | 'extend' | null>(null);

  const { data: process, isLoading } = useQuery({ queryKey: ['process', id], queryFn: () => processesApi.get(id!), enabled: !!id });
  const { data: attempts } = useQuery({ queryKey: ['process-attempts', id], queryFn: () => processesApi.attempts(id!), enabled: !!id });
  const { data: equipment } = useQuery({ queryKey: ['reactor', process?.equipmentId], queryFn: () => reactorsApi.get(process!.equipmentId), enabled: !!process });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['process', id] });
    qc.invalidateQueries({ queryKey: ['process-attempts', id] });
    qc.invalidateQueries({ queryKey: ['processes'] });
  };
  const onErr = (err: unknown) => {
    const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message;
    message.error(typeof msg === 'string' ? msg : 'Action failed');
  };

  const simpleAction = useMutation({
    mutationFn: (fn: () => Promise<unknown>) => fn(),
    onSuccess: () => {
      message.success('Done');
      invalidate();
    },
    onError: onErr,
  });

  const reasonAction = useMutation({
    mutationFn: (v: { fn: (reason: string, extra?: number) => Promise<unknown>; reason: string; extra?: number }) =>
      v.fn(v.reason, v.extra),
    onSuccess: () => {
      message.success('Done');
      invalidate();
      setModal(null);
    },
    onError: onErr,
  });

  if (isLoading || !process) return <Spin />;

  const attemptColumns = [
    { title: 'Attempt #', dataIndex: 'attemptNo', key: 'attemptNo' },
    { title: 'Status', dataIndex: 'status', key: 'status', render: (s: string) => <Tag>{s}</Tag> },
    { title: 'Start', dataIndex: 'startTs', key: 'startTs', render: (t: string | null) => (t ? new Date(t).toLocaleString() : '-') },
    { title: 'End', dataIndex: 'endTs', key: 'endTs', render: (t: string | null) => (t ? new Date(t).toLocaleString() : '-') },
    { title: 'Active elapsed (s)', dataIndex: 'activeElapsedS', key: 'activeElapsedS' },
    { title: 'End reason', dataIndex: 'endReason', key: 'endReason', render: (v: string | null) => v ?? '-' },
  ];

  const s = process.status;

  return (
    <Space orientation="vertical" size="large" style={{ width: '100%' }}>
      <Breadcrumb items={[{ title: <Link to="/processes">Processes</Link> }, { title: process.name }]} />

      <Card
        title={process.name}
        extra={<Tag color={STATUS_COLORS[s]}>{s}</Tag>}
      >
        <Descriptions bordered size="small" column={2}>
          <Descriptions.Item label="Reactor">{equipment?.displayName || equipment?.reactorNumber || process.equipmentId}</Descriptions.Item>
          <Descriptions.Item label="Quick run">{process.quickRun ? 'Yes' : 'No'}</Descriptions.Item>
          <Descriptions.Item label="Planned start">{new Date(process.plannedStartUtc).toLocaleString()}</Descriptions.Item>
          <Descriptions.Item label="Planned end">{new Date(process.plannedEndUtc).toLocaleString()}</Descriptions.Item>
          <Descriptions.Item label="Description" span={2}>{process.description ?? '-'}</Descriptions.Item>
          <Descriptions.Item label="Remarks" span={2}>{process.remarks ?? '-'}</Descriptions.Item>
        </Descriptions>

        <Space style={{ marginTop: 16 }} wrap>
          {(s === 'SCHEDULED') && (
            <>
              <Button onClick={() => simpleAction.mutate(() => processesApi.acceptAssignment(id!))}>Accept assignment</Button>
              <Button onClick={() => simpleAction.mutate(() => processesApi.rejectAssignment(id!, 'Rejected via web UI'))}>Reject assignment</Button>
            </>
          )}
          {(s === 'SCHEDULED' || s === 'ACCEPTED') && (
            <Button type="primary" onClick={() => simpleAction.mutate(() => processesApi.start(id!))}>Start</Button>
          )}
          {s === 'RUNNING' && (
            <>
              <Button onClick={() => setModal('pause')}>Pause</Button>
              <Button onClick={() => simpleAction.mutate(() => processesApi.complete(id!))}>Complete</Button>
              <Button onClick={() => setModal('extend')}>Extend</Button>
              <Button danger onClick={() => setModal('abort')}>Abort</Button>
            </>
          )}
          {s === 'PAUSED' && (
            <>
              <Button type="primary" onClick={() => simpleAction.mutate(() => processesApi.resume(id!))}>Resume</Button>
              <Button danger onClick={() => setModal('abort')}>Abort</Button>
            </>
          )}
          {s === 'AWAITING_COMPLETION' && (
            <Button type="primary" onClick={() => simpleAction.mutate(() => processesApi.complete(id!))}>Confirm complete</Button>
          )}
          {(s === 'SCHEDULED' || s === 'ACCEPTED' || s === 'RUNNING' || s === 'PAUSED') && (
            <Button danger onClick={() => setModal('cancel')}>Cancel</Button>
          )}
          {(s === 'COMPLETED' || s === 'CANCELLED' || s === 'ABORTED') && (
            <Button onClick={() => setModal('restart')}>Restart</Button>
          )}
        </Space>
      </Card>

      <Card title="Attempts">
        <Table rowKey="id" columns={attemptColumns} dataSource={attempts ?? []} pagination={false} size="small" scroll={{ x: 'max-content' }} />
      </Card>

      <ReasonModal
        title="Pause process"
        open={modal === 'pause'}
        onClose={() => setModal(null)}
        loading={reasonAction.isPending}
        onSubmit={(reason) => reasonAction.mutate({ fn: (r) => processesApi.pause(id!, r), reason })}
      />
      <ReasonModal
        title="Cancel process"
        open={modal === 'cancel'}
        onClose={() => setModal(null)}
        loading={reasonAction.isPending}
        onSubmit={(reason) => reasonAction.mutate({ fn: (r) => processesApi.cancel(id!, r), reason })}
      />
      <ReasonModal
        title="Abort process"
        open={modal === 'abort'}
        onClose={() => setModal(null)}
        loading={reasonAction.isPending}
        onSubmit={(reason) => reasonAction.mutate({ fn: (r) => processesApi.abort(id!, r), reason })}
      />
      <ReasonModal
        title="Restart process"
        open={modal === 'restart'}
        onClose={() => setModal(null)}
        loading={reasonAction.isPending}
        onSubmit={(reason) => reasonAction.mutate({ fn: (r) => processesApi.restart(id!, r), reason })}
      />
      <ReasonModal
        title="Extend process"
        open={modal === 'extend'}
        onClose={() => setModal(null)}
        loading={reasonAction.isPending}
        extraField={{ label: 'New planned duration (hours)', name: 'extra' }}
        onSubmit={(reason, extra) =>
          reasonAction.mutate({ fn: (r, e) => processesApi.extend(id!, (e ?? 1) * 3600, r), reason, extra })
        }
      />
    </Space>
  );
}
