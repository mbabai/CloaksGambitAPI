describe('ML workflow feature gate', () => {
  const previousNodeEnv = process.env.NODE_ENV;
  const previousFlag = process.env.ENABLE_ML_WORKFLOW;

  afterEach(() => {
    jest.resetModules();
    delete global.__APP_ENV__;
    if (previousNodeEnv === undefined) {
      delete process.env.NODE_ENV;
    } else {
      process.env.NODE_ENV = previousNodeEnv;
    }
    if (previousFlag === undefined) {
      delete process.env.ENABLE_ML_WORKFLOW;
    } else {
      process.env.ENABLE_ML_WORKFLOW = previousFlag;
    }
  });

  test('is enabled by default outside production', () => {
    process.env.NODE_ENV = 'development';
    delete process.env.ENABLE_ML_WORKFLOW;

    const { isMlWorkflowEnabled } = require('../src/utils/mlFeatureGate');
    expect(isMlWorkflowEnabled()).toBe(true);
  });

  test('is disabled by default in production', () => {
    process.env.NODE_ENV = 'production';
    delete process.env.ENABLE_ML_WORKFLOW;

    const { isMlWorkflowEnabled } = require('../src/utils/mlFeatureGate');
    expect(isMlWorkflowEnabled()).toBe(false);
  });

  test('can be explicitly enabled in production', () => {
    process.env.NODE_ENV = 'production';
    process.env.ENABLE_ML_WORKFLOW = 'true';

    const { isMlWorkflowEnabled } = require('../src/utils/mlFeatureGate');
    expect(isMlWorkflowEnabled()).toBe(true);
  });
});
