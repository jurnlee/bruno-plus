import { test, expect } from '../../../playwright';
import * as fs from 'fs';
import * as path from 'path';
import {
  buildRunnerLocators,
  closeAllCollections,
  getRunnerResultCounts,
  openCollectionFromDialog,
  openRunnerResultTimeline,
  openRunnerTab
} from '../../utils/page';

const COLLECTION_NAME = 'Runner Data Driven Collection';

test.describe('Data-driven collection runner', () => {
  test.beforeAll(async ({ electronApp }) => {
    await electronApp.evaluate(({ dialog }) => {
      (dialog as any).__originalShowOpenDialog = dialog.showOpenDialog;
    });
  });

  test.afterAll(async ({ electronApp }) => {
    await electronApp.evaluate(({ dialog }) => {
      dialog.showOpenDialog = (dialog as any).__originalShowOpenDialog;
      delete (dialog as any).__originalShowOpenDialog;
    });
  });

  test.afterEach(async ({ page }) => {
    await closeAllCollections(page);
  });

  test('runs the collection once per data row and groups results by iteration', async ({
    page,
    electronApp,
    collectionFixturePath
  }) => {
    const locators = buildRunnerLocators(page);

    await test.step('Open the fixture collection and its runner tab', async () => {
      await openCollectionFromDialog(page, electronApp, collectionFixturePath!);
      await openRunnerTab(page, COLLECTION_NAME);
    });

    await test.step('Pick the data file through the stubbed native dialog', async () => {
      const dataFilePath = path.join(collectionFixturePath!, 'users.csv');
      await electronApp.evaluate(({ dialog }, filePath) => {
        dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [filePath] });
      }, dataFilePath);
      await page.getByTestId('data-file-choose').click();
    });

    await test.step('The data panel previews the parsed rows', async () => {
      await expect(page.getByTestId('data-file-row-count')).toHaveText('2 rows');
      const preview = page.getByTestId('data-file-preview');
      await expect(preview.locator('thead th').filter({ hasText: 'username' })).toBeVisible();
      await expect(preview.locator('tbody tr').first()).toContainText('alice');

      const runButton = locators.runCollectionButton();
      await expect(runButton).toBeEnabled();
      await expect(runButton).toContainText('× 2 iterations');
    });

    await test.step('Run and verify one results section per iteration', async () => {
      await locators.runCollectionButton().click();
      await locators.runAgainButton().waitFor({ timeout: 60_000 });

      await expect(locators.resultItems()).toHaveCount(2);
      await expect(locators.passedTestRows()).toHaveCount(2);

      const groups = page.getByTestId('runner-iteration-group');
      await expect(groups).toHaveCount(2);
      await expect(groups.nth(0)).toContainText('Iteration 1 / 2');
      await expect(groups.nth(1)).toContainText('Iteration 2 / 2');

      const counts = await getRunnerResultCounts(page);
      expect(counts).toEqual({ totalRequests: 2, passed: 2, failed: 0, skipped: 0 });
    });

    await test.step('The response view shows the iteration-specific exchange', async () => {
      await openRunnerResultTimeline(page, 'echo-user');
      await expect(page.getByText('alice').first()).toBeVisible();
    });
  });

  test('a broken data file surfaces its parse error and disables Run', async ({
    page,
    electronApp,
    collectionFixturePath,
    createTmpDir
  }) => {
    const tmpDir = await createTmpDir('data-driven-broken-csv');
    const brokenCsvPath = path.join(tmpDir, 'broken.csv');
    await fs.promises.writeFile(brokenCsvPath, 'username\n"unterminated\n');

    await test.step('Open the fixture collection and its runner tab', async () => {
      await openCollectionFromDialog(page, electronApp, collectionFixturePath!);
      await openRunnerTab(page, COLLECTION_NAME);
    });

    await test.step('Pick a CSV with an unterminated quote', async () => {
      await electronApp.evaluate(({ dialog }, filePath) => {
        dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [filePath] });
      }, brokenCsvPath);
      await page.getByTestId('data-file-choose').click();
    });

    await test.step('The parse error is shown and Run stays disabled', async () => {
      const error = page.getByTestId('data-file-error');
      await expect(error).toBeVisible();
      await expect(error).toContainText('Unterminated quoted field');
      await expect(page.getByTestId('data-file-preview')).toHaveCount(0);
      await expect(buildRunnerLocators(page).runCollectionButton()).toBeDisabled();
    });
  });
});
