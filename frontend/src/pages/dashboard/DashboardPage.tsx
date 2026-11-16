import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { Card, Col, Row, Statistic, Tag, Spin, Empty, Typography, Space } from 'antd';
import {
  BankOutlined,
  ExperimentOutlined,
  AlertOutlined,
  CheckCircleOutlined,
  ArrowRightOutlined,
  AppstoreOutlined,
} from '@ant-design/icons';
import { reactorsApi } from '@/api/reactors';
import { alarmsApi } from '@/api/alarms';
import { tenancyApi } from '@/api/tenancy';
import { processesApi } from '@/api/processes';
import { useAuthStore } from '@/store/auth.store';
import type { Equipment, Laboratory, Alarm, Process } from '@/api/types';

function LaboratoryCard({
  lab,
  reactors,
}: {
  lab: Laboratory;
  reactors: Equipment[];
}) {
  const navigate = useNavigate();

  // Query alarms across all reactors in this lab to show active alarm badge
  const { data: allAlarms } = useQuery<Alarm[]>({
    queryKey: ['alarms'],
    queryFn: alarmsApi.listAll,
    refetchInterval: 10000,
  });

  const labReactorIds = useMemo(() => new Set(reactors.map((r) => r.id)), [reactors]);

  const activeAlarmCount = useMemo(() => {
    if (!allAlarms) return 0;
    return allAlarms.filter(
      (a: Alarm) =>
        labReactorIds.has(a.equipmentId) &&
        (a.state === 'ACTIVE_UNACK' || a.state === 'ACTIVE_ACK'),
    ).length;
  }, [allAlarms, labReactorIds]);

  return (
    <Card
      hoverable
      onClick={() => navigate(`/reactors?labId=${lab.id}`)}
      style={{
        height: '100%',
        borderRadius: 10,
        boxShadow: '0 2px 8px rgba(0,0,0,0.04)',
        cursor: 'pointer',
        border: activeAlarmCount > 0 ? '1px solid #ff4d4f' : undefined,
      }}
      title={
        <Space>
          <BankOutlined style={{ color: '#1677ff', fontSize: 18 }} />
          <Typography.Text strong style={{ fontSize: 16 }}>
            {lab.name}
          </Typography.Text>
        </Space>
      }
      extra={
        <Space>
          {lab.code && <Tag color="blue">{lab.code}</Tag>}
          {activeAlarmCount > 0 ? (
            <Tag color="red">
              <AlertOutlined /> {activeAlarmCount} Active
            </Tag>
          ) : (
            <Tag color="green">Normal</Tag>
          )}
        </Space>
      }
    >
      <Row gutter={16} style={{ marginTop: 8 }}>
        <Col span={8}>
          <Statistic
            title="Total Reactors"
            value={reactors.length}
            prefix={<ExperimentOutlined style={{ color: '#1677ff', fontSize: 16 }} />}
          />
        </Col>
        <Col span={8}>
          <Statistic
            title="Online"
            value={reactors.filter((r) => r.online).length}
            valueStyle={{ color: '#3f8600' }}
            prefix={<CheckCircleOutlined style={{ fontSize: 16 }} />}
          />
        </Col>
        <Col span={8}>
          <Statistic
            title="Alarms"
            value={activeAlarmCount}
            valueStyle={{ color: activeAlarmCount > 0 ? '#cf1322' : '#8c8c8c' }}
            prefix={<AlertOutlined style={{ fontSize: 16 }} />}
          />
        </Col>
      </Row>

      <div
        style={{
          marginTop: 20,
          paddingTop: 12,
          borderTop: '1px solid #f0f0f0',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
        }}
      >
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          Tap to view reactor cards
        </Typography.Text>
        <Space size={4} style={{ color: '#1677ff', fontSize: 13, fontWeight: 500 }}>
          <span>Open Lab</span>
          <ArrowRightOutlined />
        </Space>
      </div>
    </Card>
  );
}

export function DashboardPage() {
  const navigate = useNavigate();
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

  // For analysts, find reactors that have an active process assigned to them
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

  if (reactorsLoading || labsLoading || (isAnalyst && processesLoading)) {
    return <Spin style={{ display: 'block', margin: '40px auto' }} />;
  }

  // Filter laboratories for Lab In-charge vs Admin
  const isLabScoped = !currentUser?.isAdmin && (currentUser?.laboratoryIds?.length ?? 0) > 0;
  const visibleLabs = (laboratories ?? []).filter((lab: Laboratory) => {
    if (!isLabScoped) return true;
    return currentUser?.laboratoryIds?.includes(lab.id);
  });

  // Group reactors by laboratory (for analysts, only include their assigned active reactors)
  const effectiveReactors = (reactors ?? []).filter((r) => {
    if (!isAnalyst || !assignedReactorIds) return true;
    return assignedReactorIds.has(r.id);
  });

  const reactorsByLab = new Map<string, Equipment[]>();
  const unassignedReactors: Equipment[] = [];

  for (const r of effectiveReactors) {
    if (r.laboratoryId) {
      const list = reactorsByLab.get(r.laboratoryId) ?? [];
      list.push(r);
      reactorsByLab.set(r.laboratoryId, list);
    } else {
      unassignedReactors.push(r);
    }
  }

  return (
    <div>
      <div style={{ marginBottom: 20 }}>
        <Typography.Title level={4} style={{ margin: 0 }}>
          <AppstoreOutlined style={{ marginRight: 8, color: '#1677ff' }} />
          {currentUser?.isAdmin ? 'Laboratories Overview' : 'Assigned Laboratories'}
        </Typography.Title>
        <Typography.Text type="secondary">
          Select a laboratory card to view live telemetry and reactor control cards
        </Typography.Text>
      </div>

      {visibleLabs.length === 0 ? (
        <Card style={{ textAlign: 'center', padding: '40px 0' }}>
          <Empty description="No laboratories assigned to your account" />
        </Card>
      ) : (
        <Row gutter={[20, 20]}>
          {visibleLabs.map((lab: Laboratory) => (
            <Col key={lab.id} xs={24} sm={12} lg={8} xl={8}>
              <LaboratoryCard lab={lab} reactors={reactorsByLab.get(lab.id) ?? []} />
            </Col>
          ))}

          {currentUser?.isAdmin && unassignedReactors.length > 0 && (
            <Col xs={24} sm={12} lg={8} xl={8}>
              <Card
                hoverable
                onClick={() => navigate('/reactors?labId=unassigned')}
                style={{
                  height: '100%',
                  borderRadius: 10,
                  boxShadow: '0 2px 8px rgba(0,0,0,0.04)',
                  cursor: 'pointer',
                }}
                title={
                  <Space>
                    <ExperimentOutlined style={{ color: '#fa8c16', fontSize: 18 }} />
                    <Typography.Text strong style={{ fontSize: 16 }}>
                      General / Unassigned
                    </Typography.Text>
                  </Space>
                }
                extra={<Tag color="orange">{unassignedReactors.length} Reactors</Tag>}
              >
                <Row gutter={16} style={{ marginTop: 8 }}>
                  <Col span={12}>
                    <Statistic
                      title="Total Reactors"
                      value={unassignedReactors.length}
                      prefix={<ExperimentOutlined style={{ color: '#fa8c16', fontSize: 16 }} />}
                    />
                  </Col>
                  <Col span={12}>
                    <Statistic
                      title="Online"
                      value={unassignedReactors.filter((r) => r.online).length}
                      valueStyle={{ color: '#3f8600' }}
                    />
                  </Col>
                </Row>
                <div
                  style={{
                    marginTop: 20,
                    paddingTop: 12,
                    borderTop: '1px solid #f0f0f0',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                  }}
                >
                  <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                    Reactors pending lab binding
                  </Typography.Text>
                  <Space size={4} style={{ color: '#fa8c16', fontSize: 13, fontWeight: 500 }}>
                    <span>Open</span>
                    <ArrowRightOutlined />
                  </Space>
                </div>
              </Card>
            </Col>
          )}
        </Row>
      )}
    </div>
  );
}
