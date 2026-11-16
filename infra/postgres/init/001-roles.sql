-- Dev/local bootstrap only. In production, rotate this password and set it via
-- Docker secrets or an .env file outside version control (see .env.example).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'rmp_app') THEN
    CREATE ROLE rmp_app LOGIN PASSWORD 'change_me_dev_password';
  END IF;
END $$;

GRANT CONNECT ON DATABASE rmp TO rmp_app;
