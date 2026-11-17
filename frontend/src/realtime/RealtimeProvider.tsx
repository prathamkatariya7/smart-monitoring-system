import { useEffect, type ReactNode } from 'react';
import { App } from 'antd';
import { useQueryClient } from '@tanstack/react-query';
import { useAuthStore } from '@/store/auth.store';
import { useNotificationsStore } from '@/store/notifications.store';
import { connectRealtime, disconnectRealtime } from './socket';
import { tenancyApi } from '@/api/tenancy';
import { notificationsApi } from '@/api/notifications';
import type { Notification, RealtimeAlarmEvent, TelemetryEvent } from '@/api/types';
import { humanizeNotification } from '@/util/notification-format';

/**
 * Mounted once at the app root. Opens the Socket.IO connection once a user
 * is authenticated, joins the relevant `lab:{id}` rooms (per realtime.gateway.ts
 * -- `join_lab` takes a raw laboratoryId string), and bridges server push
 * events into the notifications store + a toast.
 */
export function RealtimeProvider({ children }: { children: ReactNode }) {
  const user = useAuthStore((s) => s.user);
  const accessToken = useAuthStore((s) => s.accessToken);
  const { notification } = App.useApp();
  const qc = useQueryClient();

  useEffect(() => {
    if (!user || !accessToken) return;
    const socket = connectRealtime(accessToken);

    socket.on('connect', async () => {
      try {
        if (user.isAdmin) {
          const labs = await tenancyApi.laboratories();
          labs.forEach((lab) => socket.emit('join_lab', lab.id));
        } else {
          user.laboratoryIds.forEach((labId) => socket.emit('join_lab', labId));
        }
      } catch {
        // non-fatal -- user just won't get lab-room broadcasts this session
      }
    });

    socket.on('notification', (n: Notification) => {
      useNotificationsStore.getState().push(n);
      const { title, escalated } = humanizeNotification(n);
      const bannerTitle = escalated ? `${title} (escalated)` : title;
      notification.info({
        key: n.id,
        message: bannerTitle,
        title: bannerTitle,
        placement: 'topRight',
        duration: 6,
      });
      qc.invalidateQueries({ queryKey: ['notifications'] });
      qc.invalidateQueries({ queryKey: ['alarms'] });
    });

    socket.on('notification_update', (n: Notification) => {
      useNotificationsStore.getState().updateItem(n);
      qc.setQueryData(['notifications'], (old: Notification[] | undefined) => {
        if (!old) return old;
        return old.map((item) => (item.id === n.id ? { ...item, ...n } : item));
      });
    });

    socket.on('notification_seen', ({ id, all }: { id?: string; all?: boolean }) => {
      if (all) {
        useNotificationsStore.getState().markAllSeenLocal();
      } else if (id) {
        useNotificationsStore.getState().markSeenLocal(id);
      }
      qc.invalidateQueries({ queryKey: ['notifications'] });
    });

    socket.on('notification_broadcast', () => {
      qc.invalidateQueries({ queryKey: ['notifications'] });
      qc.invalidateQueries({ queryKey: ['alarms'] });
    });

    socket.on('device_status', () => {
      qc.invalidateQueries({ queryKey: ['devices'] });
      qc.invalidateQueries({ queryKey: ['reactors'] });
      qc.invalidateQueries({ queryKey: ['laboratories'] });
    });

    socket.on('device_binding_changed', () => {
      qc.invalidateQueries({ queryKey: ['devices'] });
      qc.invalidateQueries({ queryKey: ['reactors'] });
      qc.invalidateQueries({ queryKey: ['laboratories'] });
    });

    socket.on('telemetry', (data: TelemetryEvent) => {
      if (data?.equipmentId) {
        qc.setQueryData(['reactor-live', data.equipmentId], (old: TelemetryEvent | undefined) => ({
          ...old,
          temperatureC: data.temperatureC ?? old?.temperatureC,
          rpm: data.rpm ?? old?.rpm,
          torqueNcm: data.torqueNcm ?? old?.torqueNcm,
          ts: data.ts,
        }));
      }
    });

    socket.on('ALARM_ACTIVE', (payload: RealtimeAlarmEvent) => {
      const isCritical = payload.severity === 'CRITICAL';
      const heading = isCritical ? '🔥 CRITICAL FIRE / RUNAWAY ALARM' : '⚠️ Threshold Warning';
      const desc = payload.title || `${payload.parameter} = ${payload.value} on reactor`;

      if (isCritical) {
        notification.error({
          message: heading,
          title: heading,
          description: desc,
          placement: 'topRight',
          duration: 10,
        });
      } else {
        notification.warning({
          message: heading,
          title: heading,
          description: desc,
          placement: 'topRight',
          duration: 6,
        });
      }
      qc.invalidateQueries({ queryKey: ['alarms'] });
      qc.invalidateQueries({ queryKey: ['reactor-alarms'] });
      qc.invalidateQueries({ queryKey: ['reactors'] });
      qc.invalidateQueries({ queryKey: ['laboratories'] });
      if (payload?.equipmentId) {
        qc.invalidateQueries({ queryKey: ['reactor-alarms', payload.equipmentId] });
        qc.invalidateQueries({ queryKey: ['reactor-live', payload.equipmentId] });
      }
      qc.invalidateQueries({ queryKey: ['notifications'] });
    });

    socket.on('ALARM_CLEARED', (payload: RealtimeAlarmEvent) => {
      qc.invalidateQueries({ queryKey: ['alarms'] });
      qc.invalidateQueries({ queryKey: ['reactor-alarms'] });
      qc.invalidateQueries({ queryKey: ['reactors'] });
      qc.invalidateQueries({ queryKey: ['laboratories'] });
      if (payload?.equipmentId) {
        qc.invalidateQueries({ queryKey: ['reactor-alarms', payload.equipmentId] });
      }
    });

    notificationsApi
      .list()
      .then((items) => useNotificationsStore.getState().setAll(items))
      .catch(() => { });

    return () => {
      disconnectRealtime();
    };
  }, [user, accessToken, notification, qc]);

  return <>{children}</>;
}
