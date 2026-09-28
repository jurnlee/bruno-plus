import { test } from '../../../playwright';
import { setSandboxMode, runCollection, validateRunnerResults } from '../../utils/page';

test.describe('additionalContextRoots npm resolution [developer mode]', () => {
  test('Collection A resolves shared-lib via walk-up', async ({ pageWithUserData: page }) => {
    await setSandboxMode(page, 'Collection A', 'developer');
    await runCollection(page, 'Collection A');

    await validateRunnerResults(page, {
      totalRequests: 2,
      passed: 2,
      failed: 0,
      skipped: 0
    });
  });

  test('Collection B reuses the same shared root from the workspace', async ({ pageWithUserData: page }) => {
    await setSandboxMode(page, 'Collection B', 'developer');
    await runCollection(page, 'Collection B');

    await validateRunnerResults(page, {
      totalRequests: 1,
      passed: 1,
      failed: 0,
      skipped: 0
    });
  });
});

test.describe('additionalContextRoots local resolution', () => {
  // Collection C requires a dependency-free shared module, so the same fixture
  // works in both sandboxes — the npm-backed collections above stay nodevm-only.
  test('Collection C resolves the shared root in developer mode', async ({ pageWithUserData: page }) => {
    await setSandboxMode(page, 'Collection C', 'developer');
    await runCollection(page, 'Collection C');

    await validateRunnerResults(page, {
      totalRequests: 1,
      passed: 1,
      failed: 0,
      skipped: 0
    });
  });

  test('Collection C resolves the shared root in safe mode (quickjs)', async ({ pageWithUserData: page }) => {
    // No setSandboxMode call: safe mode (quickjs) is the default sandbox.
    await runCollection(page, 'Collection C');

    await validateRunnerResults(page, {
      totalRequests: 1,
      passed: 1,
      failed: 0,
      skipped: 0
    });
  });
});
