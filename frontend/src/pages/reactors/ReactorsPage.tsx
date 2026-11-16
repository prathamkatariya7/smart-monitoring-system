import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import {
  Card,
  Col,
  Row,
  Statistic,
  Tag,
  Spin,
  Empty,
  Typography,
  Space,
  Button,
  Select,
  Breadcrumb,
} from 'antd';
import {
  ExperimentOutlined,
  AlertOutlined,
  BankOutlined,
  ArrowLeftOutlined,
} from '@ant-design/icons';
import { reactorsApi } from '@/api/reactors';
import { alarmsApi } from '@/api/alarms';
import { tenancyApi } from '@/api/tenancy';
import { processesApi } from '@/api/processes';
import { useAuthStore } from '@/store/auth.store';
import type { Equipment, Laboratory, Process } from '@/api/types';

export function ReactorCard({ equipment }: { equipment: Equipment }) {
  const { data: live } = useQuery({
    queryKey: ['reactor-live', equipment.id],
    queryFn: () => reactorsApi.live(equipment.id),
    refetchInterval: 5000,
  });
  const { data: alarms } = useQuery({
    queryKey: ['reactor-alarms', equipment.id],
    queryFn: () => alarmsApi.listForReactor(equipment.id),
    refetchInterval: 10000,
  });
  const activeAlarms = alarms?.filter((a) => a.state === 'ACTIVE_UNACK' || a.state === 'ACTIVE_ACK') ?? [];
  const isOnline = equipment.online ?? (live?.ts ? Date.now() - new Date(live.ts).getTime() < 45000 : false);

  return (
    <Link to={`/reactors/${equipment.id}`}>
      <Card
        hoverable
        style={{
          height: '100%',
          borderColor: activeAlarms.length > 0 ? '#ff4d4f' : undefined,
          borderWidth: activeAlarms.length > 0 ? 2 : 1,
          boxShadow: activeAlarms.length > 0 ? '0 0 12px rgba(255, 77, 79, 0.35)' : undefined,
        }}
        title={
          <span>
            <ExperimentOutlined style={{ marginRight: 8, color: '#1677ff' }} />
            {equipment.displayName || equipment.reactorNumber}
          </span>
        }
        extra={
          equipment.maintenanceMode ? (
            <Tag color="orange">Maintenance</Tag>
          ) : activeAlarms.length > 0 ? (
            <Tag color="red">
              <AlertOutlined /> {activeAlarms.length}
            </Tag>
          ) : isOnline ? (
            <Tag color="green">● Online</Tag>
          ) : (
            <Tag color="default">○ Offline</Tag>
          )
        }
      >
        {live ? (
          <Row gutter={8}>
            <Col span={8}>
              <Statistic title="Temp (°C)" value={live.temperatureC ?? '-'} precision={1} />
            </Col>
            <Col span={8}>
              <Statistic title="RPM" value={live.rpm ?? '-'} />
            </Col>
            <Col span={8}>
              <Statistic title="Torque" value={live.torqueNcm ?? '-'} precision={1} />
            </Col>
          </Row>
        ) : (
          <Typography.Text type="secondary">No live data yet</Typography.Text>
        )}
      </Card>
    </Link>
  );
}

export function ReactorsPage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const labId = searchParams.get('labId');
  const currentUser = useAuthStore((s) => s.user);

  const { data: reactors, isLoading: reactorsLoading } = useQuery({
    queryKey: ['reactors'],
    queryFn: reactorsApi.list,
  });

  const { data: laboratories, isLoading: labsLoading } = useQuery({
    queryKey: ['laboratories'],
    queryFn: tenancyApi.laboratories,
  });

  const { data: processes, isLoading: processesLoading } = useQuery({
    queryKey: ['processes'],
    queryFn: processesApi.list,
  });

  const isAnalyst = !currentUser?.isAdmin && (currentUser?.roles.includes('ANALYST') ?? false) && !(currentUser?.roles.includes('LAB_INCHARGE') ?? false);

  const assignedReactorIds = useMemo(() => {
    if (!isAnalyst || !processes || !currentUser) return null;
    const activeStatuses = ['SCHEDULED', 'ACCEPTED', 'RUNNING', 'PAUSED', 'AWAITING_COMPLETION'];
    const myProcs = processes.filter(
      (p: Process) =>
        activeStatuses.includes(p.status) &&
        (p.assignments?.some((a) => a.userId === currentUser.userId && a.status !== 'REJECTED' && a.status !== 'RELEASED') ||
          p.ownerAnalystName === currentUser.name),
    );
    return new Set(myProcs.map((p) => p.equipmentId));
  }, [isAnalyst, processes, currentUser]);

  const isLabScoped = !currentUser?.isAdmin && (currentUser?.laboratoryIds?.length ?? 0) > 0;
  const visibleLabs = useMemo(() => {
    return (laboratories ?? []).filter((lab: Laboratory) => {
      if (!isLabScoped) return true;
      return currentUser?.laboratoryIds?.includes(lab.id);
    });
  }, [laboratories, isLabScoped, currentUser]);

  const currentLab = useMemo(() => {
    if (!labId || labId === 'all' || labId === 'unassigned') return null;
    return visibleLabs.find((l) => l.id === labId) ?? null;
  }, [labId, visibleLabs]);

  const filteredReactors = useMemo(() => {
    if (!reactors) return [];
    let list = reactors;
    if (isAnalyst && assignedReactorIds) {
      list = list.filter((r) => assignedReactorIds.has(r.id));
    }
    if (labId === 'unassigned') {
      return list.filter((r) => !r.laboratoryId);
    }
    if (labId && labId !== 'all') {
      return list.filter((r) => r.laboratoryId === labId);
    }
    if (isLabScoped) {
      return list.filter((r) => r.laboratoryId && currentUser?.laboratoryIds?.includes(r.laboratoryId));
    }
    return list;
  }, [reactors, labId, isLabScoped, currentUser, isAnalyst, assignedReactorIds]);

  if (reactorsLoading || labsLoading || (isAnalyst && processesLoading)) {
    return <Spin style={{ display: 'block', margin: '40px auto' }} />;
  }

  return (
    <div>
      <Breadcrumb
        style={{ marginBottom: 16 }}
        items={[
          { title: <Link to="/">Laboratories Overview</Link> },
          { title: <Link to="/reactors">Reactors</Link> },
          ...(currentLab ? [{ title: currentLab.name }] : labId === 'unassigned' ? [{ title: 'Unassigned' }] : []),
        ]}
      />

      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: 12,
          marginBottom: 20,
        }}
      >
        <Space align="center" size="middle">
          <Button icon={<ArrowLeftOutlined />} onClick={() => navigate('/')}>
            Back to Laboratories
          </Button>
          <div>
            <Typography.Title level={4} style={{ margin: 0 }}>
              {currentLab ? (
                <span>
                  <BankOutlined style={{ color: '#1677ff', marginRight: 8 }} />
                  {currentLab.name}
                  {currentLab.code && <Tag color="blue" style={{ marginLeft: 8 }}>{currentLab.code}</Tag>}
                </span>
              ) : labId === 'unassigned' ? (
                'Unassigned / General Reactors'
              ) : (
                'All Monitored Reactors'
              )}
            </Typography.Title>
            <Typography.Text type="secondary" style={{ fontSize: 13 }}>
              {filteredReactors.length} {filteredReactors.length === 1 ? 'reactor' : 'reactors'} found •{' '}
              <span style={{ color: '#52c41a', fontWeight: 600 }}>
                {filteredReactors.filter((r) => r.online).length} online
              </span>
            </Typography.Text>
          </div>
        </Space>

        <Space>
          <Typography.Text strong>Filter Laboratory:</Typography.Text>
          <Select
            style={{ width: 220 }}
            value={labId ?? 'all'}
            onChange={(val) => {
              if (val === 'all') {
                searchParams.delete('labId');
                setSearchParams(searchParams);
              } else {
                setSearchParams({ labId: val });
              }
            }}
            options={[
              { label: 'All Laboratories', value: 'all' },
              ...visibleLabs.map((l) => ({ label: l.name, value: l.id })),
              ...(currentUser?.isAdmin ? [{ label: 'Unassigned Reactors', value: 'unassigned' }] : []),
            ]}
          />
        </Space>
      </div>

      {filteredReactors.length === 0 ? (
        <Card style={{ textAlign: 'center', padding: '50px 20px' }}>
          <Empty
            description={
              isAnalyst
                ? 'No reactors currently assigned to you. When a Lab In-charge assigns a process to you, its reactor card will appear here with live telemetry.'
                : 'No reactors found in this selection'
            }
          />
        </Card>
      ) : (
        <Row gutter={[16, 16]}>
          {filteredReactors.map((r) => (
            <Col key={r.id} xs={24} sm={12} lg={8} xl={6}>
              <ReactorCard equipment={r} />
            </Col>
          ))}
        </Row>
      )}
    </div>
  );
}
