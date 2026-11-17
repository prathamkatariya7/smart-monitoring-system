import { useEffect, useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Button, Typography, Space, Empty, Drawer, Tag, Descriptions, Tabs } from 'antd';
import { AlertOutlined, BellOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';
import { notificationsApi } from '@/api/notifications';
import { useNotificationsStore } from '@/store/notifications.store';
import { humanizeNotification, formatPayload } from '@/util/notification-format';
import type { Notification } from '@/api/types';

dayjs.extend(relativeTime);

function dayGroupLabel(iso: string): string {
  const d = dayjs(iso);
  if (d.isSame(dayjs(), 'day')) return 'Today';
  if (d.isSame(dayjs().subtract(1, 'day'), 'day')) return 'Yesterday';
  return d.format('D MMM YYYY');
}

function NotificationList({
  items,
  onOpen,
}: {
  items: Notification[];
  onOpen: (n: Notification) => void;
}) {
  const groups = useMemo(() => {
    const byDay = new Map<string, Notification[]>();
    for (const n of items) {
      const label = dayGroupLabel(n.createdAt);
      if (!byDay.has(label)) byDay.set(label, []);
      byDay.get(label)!.push(n);
    }
    return Array.from(byDay.entries());
  }, [items]);

  if (items.length === 0) return <Empty description="No notifications" style={{ marginTop: 32 }} />;

  return (
    <div style={{ border: '1px solid #e5e7eb', borderRadius: 8, overflow: 'hidden' }}>
      {groups.map(([label, group], gi) => (
        <div key={label}>
          <div
            style={{
              padding: '8px 16px',
              fontSize: 12,
              fontWeight: 600,
              color: '#8c8c8c',
              background: '#fafafa',
              borderTop: gi > 0 ? '1px solid #f0f0f0' : undefined,
            }}
          >
            {label}
          </div>
          {group.map((n) => {
            const { title, escalated } = humanizeNotification(n);
            const unread = !n.seenAt;
            const isHigh = n.priority === 'HIGH';
            const payload = n.payloadJson || {};
            const durationSec = typeof payload.durationSec === 'number' ? payload.durationSec : null;
            const occurrences = typeof payload.occurrences === 'number' && payload.occurrences > 1 ? payload.occurrences : null;
            const durationStr = durationSec != null && durationSec > 0
              ? durationSec >= 60
                ? `${Math.floor(durationSec / 60)}m ${durationSec % 60}s`
                : `${durationSec}s`
              : null;

            return (
              <div
                key={n.id}
                onClick={() => onOpen(n)}
                style={{
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: 10,
                  padding: '10px 16px',
                  cursor: 'pointer',
                  borderTop: '1px solid #f5f5f5',
                  background: unread ? '#f7fbff' : undefined,
                }}
              >
                <div style={{ marginTop: 3, flexShrink: 0 }}>
                  {isHigh ? (
                    <AlertOutlined style={{ color: '#f5222d', fontSize: 16 }} />
                  ) : (
                    <BellOutlined style={{ color: '#1677ff', fontSize: 16 }} />
                  )}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <span style={{ fontWeight: unread ? 600 : 400, overflowWrap: 'anywhere' }}>{title}</span>
                  {escalated && (
                    <Tag color="gold" style={{ marginLeft: 8 }}>
                      Escalated
                    </Tag>
                  )}
                  {durationStr && (
                    <Tag color="red" style={{ marginLeft: 8 }}>
                      Active for {durationStr}
                    </Tag>
                  )}
                  {occurrences && (
                    <Tag color="orange" style={{ marginLeft: 4 }}>
                      ×{occurrences}
                    </Tag>
                  )}
                  {!unread && n.seenAt && (
                    <Tag color="default" style={{ marginLeft: 8 }}>
                      Seen
                    </Tag>
                  )}
                </div>
                <div style={{ flexShrink: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
                  {unread && (
                    <span
                      style={{
                        width: 8,
                        height: 8,
                        borderRadius: '50%',
                        background: isHigh ? '#f5222d' : '#1677ff',
                        display: 'inline-block',
                      }}
                    />
                  )}
                  <Typography.Text type="secondary" style={{ fontSize: 12, whiteSpace: 'nowrap' }}>
                    {dayjs(n.createdAt).fromNow()}
                  </Typography.Text>
                </div>
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}

export function NotificationsPage() {
  // Active feed — only unseen notifications (backend filters seenAt IS NULL)
  const { data: activeData } = useQuery({ queryKey: ['notifications'], queryFn: notificationsApi.list });
  // History — all notifications including seen ones
  const { data: historyData } = useQuery({
    queryKey: ['notifications', 'history'],
    queryFn: notificationsApi.history,
  });

  const qc = useQueryClient();
  const items = useNotificationsStore((s) => s.items);
  const [selected, setSelected] = useState<Notification | null>(null);
  const [tab, setTab] = useState<'active' | 'history'>('active');

  // Sync active unseen feed into the global store
  useEffect(() => {
    if (activeData) useNotificationsStore.getState().setAll(activeData);
  }, [activeData]);

  const seenMutation = useMutation({
    mutationFn: (id: string) => notificationsApi.markSeen(id),
    onMutate: (id) => {
      // Optimistic: remove from active list immediately so the user sees it disappear
      useNotificationsStore.getState().markSeenLocal(id);
    },
    onSuccess: () => {
      // Refetch both feeds to keep everything consistent
      qc.invalidateQueries({ queryKey: ['notifications'] });
    },
  });

  const seenAllMutation = useMutation({
    mutationFn: notificationsApi.markAllSeen,
    onMutate: () => {
      // Optimistic: clear the active list immediately
      useNotificationsStore.getState().markAllSeenLocal();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['notifications'] });
    },
  });

  const hasUnread = items.length > 0;

  const openDetail = (n: Notification) => {
    setSelected(n);
    // If clicking from the active tab and notification is unseen, mark it seen
    if (!n.seenAt) seenMutation.mutate(n.id);
  };

  return (
    <div style={{ maxWidth: 760, minWidth: 0 }}>
      <Space style={{ width: '100%', justifyContent: 'space-between', marginBottom: 16 }} wrap>
        <Typography.Title level={4} style={{ margin: 0 }}>
          Notifications
        </Typography.Title>
        <Button
          onClick={() => seenAllMutation.mutate()}
          disabled={!hasUnread || seenAllMutation.isPending}
          loading={seenAllMutation.isPending}
        >
          Mark all as seen
        </Button>
      </Space>

      <Tabs
        activeKey={tab}
        onChange={(k) => setTab(k as 'active' | 'history')}
        items={[
          {
            key: 'active',
            label: `Unread${items.length > 0 ? ` (${items.length})` : ''}`,
            children: <NotificationList items={items} onOpen={openDetail} />,
          },
          {
            key: 'history',
            label: 'History',
            children: (
              <NotificationList items={historyData ?? []} onOpen={(n) => setSelected(n)} />
            ),
          },
        ]}
      />

      <Drawer title="Notification detail" open={!!selected} onClose={() => setSelected(null)} width={420}>
        {selected && (
          <Space direction="vertical" size="middle" style={{ width: '100%' }}>
            <Space wrap>
              <Tag color={selected.priority === 'HIGH' ? 'red' : 'blue'}>{selected.priority}</Tag>
              <Typography.Text strong style={{ overflowWrap: 'anywhere' }}>
                {humanizeNotification(selected).title}
              </Typography.Text>
            </Space>
            <Typography.Text type="secondary">
              {dayjs(selected.createdAt).format('D MMM YYYY, HH:mm:ss')}
            </Typography.Text>
            {selected.seenAt && (
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                Seen {dayjs(selected.seenAt).format('D MMM YYYY, HH:mm:ss')}
              </Typography.Text>
            )}
            <Descriptions column={1} size="small" bordered>
              {formatPayload(selected.payloadJson).map(([key, value]) => (
                <Descriptions.Item key={key} label={key}>
                  <span style={{ overflowWrap: 'anywhere' }}>{value}</span>
                </Descriptions.Item>
              ))}
            </Descriptions>
          </Space>
        )}
      </Drawer>
    </div>
  );
}

