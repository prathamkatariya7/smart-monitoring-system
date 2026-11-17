import configuration from './configuration';

describe('configuration security defaults', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('rejects missing JWT secrets in production', () => {
    process.env.NODE_ENV = 'production';
    delete process.env.JWT_ACCESS_SECRET;
    delete process.env.JWT_REFRESH_SECRET;

    expect(() => configuration()).toThrow(
      'JWT_ACCESS_SECRET must be set in production',
    );
  });

  it('does not enable device auto-registration in production', () => {
    process.env.NODE_ENV = 'production';
    process.env.JWT_ACCESS_SECRET = 'test-access-secret';
    process.env.JWT_REFRESH_SECRET = 'test-refresh-secret';
    process.env.ALLOW_DEV_DEVICE_AUTO_REGISTER = 'true';

    expect(configuration().security.allowDevDeviceAutoRegistration).toBe(false);
  });
});
