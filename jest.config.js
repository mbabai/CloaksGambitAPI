module.exports = {
  testEnvironment: 'node',
  testMatch: ['<rootDir>/tests/**/*.test.js'],
  testPathIgnorePatterns: [
    '/node_modules/',
    '<rootDir>/venv/',
    '<rootDir>/.venv/',
    '<rootDir>/ml_backend/',
  ],
  modulePathIgnorePatterns: [
    '<rootDir>/venv/',
    '<rootDir>/.venv/',
    '<rootDir>/ml_backend/',
  ],
  watchPathIgnorePatterns: [
    '<rootDir>/venv/',
    '<rootDir>/.venv/',
    '<rootDir>/ml_backend/',
  ],
};
