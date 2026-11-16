export interface AppConfig {
  nodeEnv: string;
  port: number;
  db: {
    host: string;
    port: number;
    username: string;
    password: string;
    database: string;
    ssl: boolean;
  };
  auth: {
    accessSecret: string;
    accessTtl: string;
    refreshSecret: string;
    refreshTtl: string;
    mfaIssuer: string;
  };
  mqtt: {
    url: string;
    caPath: string;
    certPath: string;
    keyPath: string;
    clientId: string;
  };
  install: {
    orgName: string;
    edition: string;
    policyPack: string;
  };
  licence: {
    filePath: string;
    publicKeyPath: string;
  };
  backup: {
    dir: string;
    dbUsername: string;
    dbPassword: string;
  };
}

export default (): AppConfig => ({
  nodeEnv: process.env.NODE_ENV ?? 'development',
  port: parseInt(process.env.PORT ?? '3000', 10),
  db: {
    host: process.env.DB_HOST ?? 'localhost',
    port: parseInt(process.env.DB_PORT ?? '5432', 10),
    username: process.env.DB_USERNAME ?? 'rmp_app',
    password: process.env.DB_PASSWORD ?? '',
    database: process.env.DB_DATABASE ?? 'rmp',
    ssl: (process.env.DB_SSL ?? 'false') === 'true',
  },
  auth: {
    accessSecret:
      process.env.JWT_ACCESS_SECRET ||
      (process.env.NODE_ENV === 'production'
        ? (() => {
            throw new Error('JWT_ACCESS_SECRET must be set in production');
          })()
        : 'dev_insecure_jwt_access_secret_do_not_use_in_prod'),
    accessTtl: process.env.JWT_ACCESS_TTL ?? '15m',
    refreshSecret:
      process.env.JWT_REFRESH_SECRET ||
      (process.env.NODE_ENV === 'production'
        ? (() => {
            throw new Error('JWT_REFRESH_SECRET must be set in production');
          })()
        : 'dev_insecure_jwt_refresh_secret_do_not_use_in_prod'),
    refreshTtl: process.env.JWT_REFRESH_TTL ?? '7d',
    mfaIssuer: process.env.MFA_ISSUER ?? 'ReactorMonitoringPlatform',
  },
  mqtt: {
    url: process.env.MQTT_URL ?? 'mqtts://localhost:8883',
    caPath: process.env.MQTT_CA_PATH ?? '',
    certPath: process.env.MQTT_CERT_PATH ?? '',
    keyPath: process.env.MQTT_KEY_PATH ?? '',
    clientId: process.env.MQTT_CLIENT_ID ?? 'rmp-backend',
  },
  install: {
    orgName: process.env.INSTALL_ORG_NAME ?? 'Default Organisation',
    edition: process.env.INSTALL_EDITION ?? 'solo',
    policyPack: process.env.INSTALL_POLICY_PACK ?? 'flexible',
  },
  licence: {
    filePath: process.env.LICENCE_FILE_PATH ?? '',
    publicKeyPath: process.env.LICENCE_PUBLIC_KEY_PATH ?? '',
  },
  backup: {
    dir: process.env.BACKUP_DIR ?? './backups',
    // pg_dump needs a role that bypasses RLS to see all rows -- reuse the
    // migration superuser creds (same trust tier as DDL, Part 10 migration runner).
    dbUsername: process.env.MIGRATION_DB_USERNAME ?? 'postgres',
    dbPassword: process.env.MIGRATION_DB_PASSWORD ?? '',
  },
});
