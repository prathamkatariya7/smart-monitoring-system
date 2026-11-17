import { useQuery } from '@tanstack/react-query';
import { useParams, Link } from 'react-router-dom';
import { Card, Descriptions, Table, Tag, Spin, Breadcrumb, Space, Button, Statistic, Row, Col, Alert } from 'antd';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import { reactorsApi } from '@/api/reactors';
import { alarmsApi } from '@/api/alarms';
import type { Measurement, Alarm } from '@/api/types';
import { useNow } from '@/hooks/use-now';

function toChartPoint(m: Measurement) {
  return {
    time: new Date(m.ts).toLocaleTimeString(),
    temperature: m.temperatureC ?? null,
    rpm: m.rpm ?? null,
    torque: m.torqueNcm ?? null,
  };
}

const alarmColumns = [
  { title: 'Parameter', dataIndex: 'parameter', key: 'parameter' },
  { title: 'Kind', dataIndex: 'kind', key: 'kind' },
  {
    title: 'Severity',
    dataIndex: 'severity',
    key: 'severity',
    render: (s: string) => <Tag color={s === 'CRITICAL' ? 'red' : s === 'WARNING' ? 'orange' : 'blue'}>{s}</Tag>,
  },
  { title: 'State', dataIndex: 'state', key: 'state' },
  { title: 'Onset', dataIndex: 'onsetTs', key: 'onsetTs', render: (t: string) => new Date(t).toLocaleString() },
  {
    title: 'Actions',
    key: 'actions',
    render: (_: unknown, alarm: Alarm) =>
      alarm.state === 'ACTIVE_UNACK' ? (
        <Button
          size="small"
          onClick={() => alarmsApi.ack(alarm.id).then(() => window.location.reload())}
        >
          Acknowledge
        </Button>
      ) : null,
  },
];

export function ReactorDetailPage() {
  const { id } = useParams<{ id: string }>();
  const now = useNow();

  const { data: equipment, isLoading: loadingEq } = useQuery({
    queryKey: ['reactor', id],
    queryFn: () => reactorsApi.get(id!),
    enabled: !!id,
  });
  const { data: recent, isLoading: loadingRecent } = useQuery({
    queryKey: ['reactor-measurements', id],
    queryFn: () => reactorsApi.recent(id!, 100),
    enabled: !!id,
    refetchInterval: 5000,
  });
  const { data: live } = useQuery({
    queryKey: ['reactor-live', id],
    queryFn: () => reactorsApi.live(id!),
    enabled: !!id,
    refetchInterval: 5000,
  });
  const { data: alarms } = useQuery({
    queryKey: ['reactor-alarms', id],
    queryFn: () => alarmsApi.listForReactor(id!),
    enabled: !!id,
    refetchInterval: 10000,
  });

  if (loadingEq || !equipment) return <Spin />;

  const isOnline = live?.ts ? now - new Date(live.ts).getTime() < 45_000 : false;

  const chartData = (recent ?? [])
    .slice()
    .reverse()
    .map(toChartPoint);

  const activeAlarmList = (alarms ?? []).filter((a) => a.state === 'ACTIVE_UNACK' || a.state === 'ACTIVE_ACK');

  return (
    <Space orientation="vertical" size="large" style={{ width: '100%' }}>
      <Breadcrumb items={[{ title: <Link to="/">Dashboard</Link> }, { title: equipment.displayName || equipment.reactorNumber }]} />

      {activeAlarmList.length > 0 && (
        <Alert
          type="error"
          showIcon
          banner
          message={
            <span>
              <strong>🔥 CRITICAL SAFETY ALARM ACTIVE: </strong>
              {activeAlarmList.map((a) => `${a.parameter.toUpperCase()} (${a.kind})`).join(' | ')}
            </span>
          }
          style={{ borderRadius: 6 }}
        />
      )}

      <Card
        title="Live status"
        style={{
          borderColor: activeAlarmList.length > 0 ? '#ff4d4f' : undefined,
          boxShadow: activeAlarmList.length > 0 ? '0 0 10px rgba(255, 77, 79, 0.25)' : undefined,
        }}
      >
        <Row gutter={[16, 16]}>
          <Col xs={12} sm={12} md={6}>
            <Statistic title="Temperature (°C)" value={live?.temperatureC ?? '-'} precision={1} />
          </Col>
          <Col xs={12} sm={12} md={6}>
            <Statistic title="RPM" value={live?.rpm ?? '-'} />
          </Col>
          <Col xs={12} sm={12} md={6}>
            <Statistic title="Torque (N·cm)" value={live?.torqueNcm ?? '-'} precision={1} />
          </Col>
          <Col xs={12} sm={12} md={6}>
            <div className="ant-statistic">
              <div className="ant-statistic-title" style={{ marginBottom: 4, color: 'rgba(0, 0, 0, 0.45)', fontSize: 14 }}>
                Connectivity
              </div>
              <div className="ant-statistic-content">
                {isOnline ? (
                  <Tag color="success" style={{ fontSize: '1em', padding: '4px 12px' }}>● Online</Tag>
                ) : (
                  <Tag color="default" style={{ fontSize: '1em', padding: '4px 12px' }}>○ Offline</Tag>
                )}
                {equipment.maintenanceMode && <Tag color="warning" style={{ marginLeft: 6 }}>Maintenance</Tag>}
              </div>
            </div>
          </Col>
        </Row>
      </Card>

      <Card title="Recent trend" loading={loadingRecent}>
        <ResponsiveContainer width="100%" height={300}>
          <LineChart data={chartData}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="time" minTickGap={30} />
            <YAxis />
            <Tooltip />
            <Legend />
            <Line type="monotone" dataKey="temperature" stroke="#0958d9" dot={false} name="Temp (°C)" />
            <Line type="monotone" dataKey="rpm" stroke="#52c41a" dot={false} name="RPM" />
            <Line type="monotone" dataKey="torque" stroke="#fa8c16" dot={false} name="Torque" />
          </LineChart>
        </ResponsiveContainer>
      </Card>

      <Card title="Active alarms">
        <Table
          rowKey="id"
          columns={alarmColumns}
          dataSource={(alarms ?? []).filter((a) => a.state !== 'NORMAL')}
          pagination={false}
          size="small"
          scroll={{ x: 'max-content' }}
        />
      </Card>

      <Card title="Reactor details">
        <Descriptions bordered size="small" column={2}>
          <Descriptions.Item label="Reactor number">{equipment.reactorNumber}</Descriptions.Item>
          <Descriptions.Item label="Type">{equipment.equipmentType}</Descriptions.Item>
          <Descriptions.Item label="Status">{equipment.status}</Descriptions.Item>
          <Descriptions.Item label="Maintenance mode">{equipment.maintenanceMode ? 'Yes' : 'No'}</Descriptions.Item>
        </Descriptions>
      </Card>
    </Space>
  );
}
