import type { Notification } from '@/api/types';

function shortId(id: unknown): string {
  return typeof id === 'string' ? id.slice(0, 8) : String(id ?? '');
}

export interface HumanizedNotification {
  title: string;
  escalated: boolean;
}

/**
 * Turns a raw notification into a single human-readable sentence, covering
 * the known backend notification types (`ALARM_ACTIVE`, `ALERT_SOUND_OVERRIDDEN`,
 * `ALERT_OVERRIDE_REPEATED`) with a safe title-cased fallback for anything else.
 * `payload.escalatedFrom` (set by the escalation scheduler) is surfaced as a
 * separate `escalated` flag instead of being baked into the sentence/type.
 */
export function humanizeNotification(n: Notification): HumanizedNotification {
  const p = n.payloadJson ?? {};
  const escalated = typeof p.escalatedFrom === 'string';
  let title: string;
  switch (n.type) {
    case 'ALARM_ACTIVE': {
      const param = String(p.parameter ?? 'Parameter').toUpperCase();
      const valStr = p.value !== undefined && p.value !== null ? ` (${p.value})` : '';
      const durMin = typeof p.durationMin === 'number' && p.durationMin > 0 ? ` • active ${p.durationMin}m` : '';
      const occStr = typeof p.occurrences === 'number' && p.occurrences > 1 ? ` [${p.occurrences}x]` : '';
      title = `${param} alarm on equipment ${shortId(p.equipmentId)}${valStr}${durMin}${occStr}`;
      break;
    }
    case 'ALERT_SOUND_OVERRIDDEN':
      title = `${p.analystName ?? 'An analyst'} overrode the ${p.alertType ?? 'alert'} alert on equipment ${shortId(p.equipmentId)}`;
      break;
    case 'ALERT_OVERRIDE_REPEATED':
      title = `${p.alertType ?? 'Alert'} overridden ${p.countInLastHour ?? ''}x in the last hour on equipment ${shortId(p.equipmentId)}`;
      break;
    default:
      title = n.type
        .replace(/_/g, ' ')
        .toLowerCase()
        .replace(/^./, (c) => c.toUpperCase());
  }
  return { title, escalated };
}

/** Renders a payload object as [label, value] pairs for the notification detail drawer. */
export function formatPayload(payload: Record<string, unknown>): Array<[string, string]> {
  return Object.entries(payload)
    .filter(([key]) => key !== 'escalatedFrom')
    .map(([key, value]) => [key, typeof value === 'string' ? value : JSON.stringify(value)]);
}
