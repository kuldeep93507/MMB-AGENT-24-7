/** @type {import('jest').Config} */
module.exports = {
  testEnvironment: 'node',
  testMatch: ['**/server/tests/**/*.test.cjs'],
  transform: {},
  // Increase timeout for async tests
  testTimeout: 30000,
};
