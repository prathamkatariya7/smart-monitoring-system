/**
 * End-to-end smoke test for the Reactor Monitoring Platform backend
 * (Part 15 "device simulator" deliverable). Exercises the whole pipeline
 * against a running `docker compose` stack:
 *
 *   1. GET /health                         -- infra checks all green
 *   2. POST /auth/login                    -- admin auth works
 *   3. GET /devices/:id                     -- registry readable
 *   4. find the device's bound equipment
 *   5. publish a tagged MQTT batch as that device (mTLS)
 *   6. poll GET /reactors/:id/measurements  -- new sample visible via API
 *   7. GET /system/licence, /system/backups -- ops endpoints respond
 *
 * Exits 0 and prints "SMOKE TEST PASSED" on success, exits 1 otherwise.
 *
 * Usage (from tools/smoke-test):
 *   npm install
 *   API_BASE=http://localhost:3000/api/v1 DEVICE_ID=<uuid> npx ts-node run.ts
 */
import * as fs from 'fs';
import * as path from 'path';
import * as mqtt from 'mqtt';

const apiBase = process.env.API_BASE ?? 'http://localhost:3000/api/v1';
const healthBase = process.env.HEALTH_BASE ?? 'http://localhost:3000';
const mqttUrl = process.env.MQTT_URL ?? 'mqtts://localhost:18883';
const certDir = process.env.CERT_DIR ?? path.join(__dirname, '..', '..', 'infra', 'mosquitto', 'certs');
const deviceId = process.env.DEVICE_ID;
const adminUser = process.env.ADMIN_USER ?? 'admin';
const adminPass = process.env.ADMIN_PASS ?? 'ChangeMe123!';

if (!deviceId) {
  console.error('DEVICE_ID env var is required (UUID of a claimed+bound device, e.g. DEV-0001).');
  process.exit(1);
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  let step = 'start';
  try {
    // 1. Health
    step = 'health check';
    const healthRes = await fetch(`${healthBase}/health`);
    const health = await healthRes.json();
    if (health.status === 'critical') throw new Error(`health is critical: ${JSON.stringify(health)}`);
    console.log(`[1/7] health = ${health.status}`);

    // 2. Login
    step = 'admin login';
    const loginRes = await fetch(`${apiBase}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: adminUser, password: adminPass }),
    });
    if (!loginRes.ok) throw new Error(`login failed: HTTP ${loginRes.status}`);
    const { accessToken } = await loginRes.json();
    const authHeaders = { Authorization: `Bearer ${accessToken}` };
    console.log('[2/7] admin login ok');

    // 3. Device readable
    step = 'read device';
    const deviceRes = await fetch(`${apiBase}/devices/${deviceId}`, { headers: authHeaders });
    if (!deviceRes.ok) throw new Error(`GET /devices/:id failed: HTTP ${deviceRes.status}`);
    const device = await deviceRes.json();
    if (device.claimState !== 'CLAIMED') throw new Error(`device is not claimed: ${JSON.stringify(device)}`);
    console.log(`[3/7] device ${device.serialNo} is claimed+${device.status}`);

    // 4. Bound equipment
    step = 'find bound equipment';
    const historyRes = await fetch(`${apiBase}/devices/${deviceId}/history`, { headers: authHeaders });
    if (!historyRes.ok) throw new Error(`GET /devices/:id/history failed: HTTP ${historyRes.status}`);
    const bindings: Array<{ equipmentId: string; boundTo: string | null }> = await historyRes.json();
    const openBinding = bindings.find((b) => !b.boundTo);
    if (!openBinding) throw new Error('device has no open (current) binding to an equipment/reactor');
    const equipmentId = openBinding.equipmentId;
    console.log(`[4/7] device bound to equipment ${equipmentId}`);

    // 5. Publish a uniquely-tagged MQTT batch as the device
    step = 'mqtt publish';
    const certName = process.env.DEVICE_CERT_NAME ?? 'device-0001';
    const client = mqtt.connect(mqttUrl, {
      clientId: `smoke-${deviceId}-${Date.now()}`,
      protocolVersion: 5,
      ca: fs.readFileSync(path.join(certDir, 'ca.crt')),
      cert: fs.readFileSync(path.join(certDir, `${certName}.crt`)),
      key: fs.readFileSync(path.join(certDir, `${certName}.key`)),
      rejectUnauthorized: true,
    });

    const marker = Math.round(Math.random() * 90) + 10; // small float temperature, safe for float4 precision
    const seq = Math.floor(Date.now() / 1000) % 90000; // unique-ish seq used as the correlation key
    await new Promise<void>((resolve, reject) => {
      client.on('connect', () => {
        const topicPrefix = `rmp/v1/${deviceId}`;
        const bootId = 999; // distinct boot id for smoke-test runs
        const f = ['seq', 'mono', 'ts', 't', 't_raw', 'rpm', 'tq', 'q', 'flt', 'fl'];
        const batch = {
          v: 1,
          boot: bootId,
          attempt: null,
          cal: 1,
          fw: 'smoke-test',
          link: 'eth',
          tsync: 1,
          f,
          d: [[seq, 1000, Date.now(), marker, marker, 400, 12.5, 'GGG', 0, 0]],
        };
        client.publish(`${topicPrefix}/tele/batch`, JSON.stringify(batch), { qos: 1 }, (err) => {
          if (err) reject(err);
          else resolve();
        });
      });
      client.on('error', reject);
    });
    client.end();
    console.log(`[5/7] published marker temperature t=${marker} (boot=999, seq=${seq})`);

    // 6. Poll the measurements API until the marker shows up (ingestion is async)
    step = 'poll measurements API';
    let found = false;
    for (let i = 0; i < 10 && !found; i++) {
      await sleep(500);
      const measRes = await fetch(`${apiBase}/reactors/${equipmentId}/measurements?limit=20`, {
        headers: authHeaders,
      });
      if (!measRes.ok) continue;
      const rows: Array<{ seq: number | string | null }> = await measRes.json();
      found = rows.some((r) => Number(r.seq) === seq);
    }
    if (!found) throw new Error(`published seq ${seq} never appeared via GET /reactors/:id/measurements`);
    console.log('[6/7] marker sample visible via measurements API -- ingestion pipeline end-to-end OK');

    // 7. Ops endpoints
    step = 'ops endpoints';
    const licenceRes = await fetch(`${apiBase}/system/licence`, { headers: authHeaders });
    const backupsRes = await fetch(`${apiBase}/system/backups`, { headers: authHeaders });
    if (!licenceRes.ok || !backupsRes.ok) {
      throw new Error(`ops endpoints failed: licence=${licenceRes.status} backups=${backupsRes.status}`);
    }
    console.log('[7/7] /system/licence and /system/backups respond ok');

    console.log('\nSMOKE TEST PASSED');
    process.exit(0);
  } catch (err: any) {
    console.error(`\nSMOKE TEST FAILED at step "${step}": ${err.message}`);
    process.exit(1);
  }
}

main();
