/**
 * Device simulator (Part 15 "device simulator" deliverable, minimal form).
 * Publishes Part 8.2 state/tele/batch/event payloads over MQTT mTLS so the
 * ingestion pipeline can be exercised without real ESP32-P4 hardware.
 *
 * Usage (from tools/device-simulator):
 *   npm install
 *   DEVICE_ID=<uuid of a claimed+bound device> npx ts-node simulate.ts [--gap] [--unsynced]
 *
 * Env vars:
 *   MQTT_URL   default mqtts://localhost:18883 (host-mapped broker port)
 *   CERT_DIR   default ../../infra/mosquitto/certs
 *   DEVICE_ID  required: the UUID of a device row already claimed+bound to a reactor
 */
import * as fs from 'fs';
import * as path from 'path';
import * as mqtt from 'mqtt';

const mqttUrl = process.env.MQTT_URL ?? 'mqtts://localhost:18883';
const certDir = process.env.CERT_DIR ?? path.join(__dirname, '..', '..', 'infra', 'mosquitto', 'certs');
const deviceId = process.env.DEVICE_ID;
const injectGap = process.argv.includes('--gap');
const unsynced = process.argv.includes('--unsynced');

if (!deviceId) {
  console.error('DEVICE_ID env var is required (UUID of a claimed+bound device).');
  process.exit(1);
}

const client = mqtt.connect(mqttUrl, {
  clientId: `sim-${deviceId}`,
  protocolVersion: 5,
  ca: fs.readFileSync(path.join(certDir, 'ca.crt')),
  cert: fs.readFileSync(path.join(certDir, 'device-0001.crt')),
  key: fs.readFileSync(path.join(certDir, 'device-0001.key')),
  rejectUnauthorized: true,
});

const topicPrefix = `rmp/v1/${deviceId}`;
const bootId = 1;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

client.on('connect', async () => {
  console.log(`Simulator connected to ${mqttUrl} as device ${deviceId}`);

  client.subscribe(`${topicPrefix}/ack/data`, { qos: 1 });
  client.on('message', (topic, payload) => {
    console.log(`<- ${topic}: ${payload.toString()}`);
  });

  // Birth message (Part 8.2: state topic, retained)
  client.publish(
    `${topicPrefix}/state`,
    JSON.stringify({ online: true, link: 'eth', boot: bootId, fw: '1.0.0' }),
    { qos: 1, retain: true },
  );

  // TIME_ANCHOR event (Part 7.5)
  client.publish(
    `${topicPrefix}/event`,
    JSON.stringify({ type: 'TIME_ANCHOR', boot: bootId, ts: Date.now(), mono: 1000 }),
    { qos: 1 },
  );

  await sleep(300);

  // One batch of 10 samples, following the Part 8.2 columnar schema.
  const f = ['seq', 'mono', 'ts', 't', 't_raw', 'rpm', 'tq', 'q', 'flt', 'fl'];
  const rows: Array<Array<string | number>> = [];
  const baseSeq = 1000;
  const baseTs = Date.now() - 10_000;
  for (let i = 0; i < 10; i++) {
    let seq = baseSeq + i;
    if (injectGap && i >= 5) seq += 3; // skip 3 sequence numbers to trigger MISSING_SEQ
    rows.push([
      seq,
      1000 + i * 1000,
      baseTs + i * 1000,
      35 + Math.sin(i) * 0.5, // calibrated temperature
      35.5 + Math.sin(i) * 0.5, // raw temperature
      400,
      12.5,
      'GGG',
      0,
      0,
    ]);
  }

  const batch = {
    v: 1,
    boot: bootId,
    attempt: null,
    cal: 1,
    fw: '1.0.0',
    link: 'eth',
    tsync: unsynced ? 0 : 1,
    f,
    d: rows,
  };

  console.log(`-> publishing batch of ${rows.length} samples (gap=${injectGap}, unsynced=${unsynced})`);
  client.publish(`${topicPrefix}/tele/batch`, JSON.stringify(batch), { qos: 1 });

  await sleep(1000);
  client.end();
  console.log('Simulator done.');
});

client.on('error', (err) => {
  console.error('MQTT error:', err.message);
});
