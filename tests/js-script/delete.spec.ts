import fs from 'node:fs';
import path from 'node:path';
import { test, expect } from '../../playwright';
import {
  createCollection,
  createJsScriptViaModal,
  deleteRequest,
  buildCommonLocators
} from '../utils/page';

const listFiles = (dir: string) => fs.readdirSync(dir).filter((f) => f.endsWith('.js'));

test.describe('JS Script - delete flow', () => {
  // The Electron page is worker-scoped, so a modal or open menu left over from one test
  // will block sidebar clicks in the next. Dismiss both after every test.
  test.afterEach(async ({ page }) => {
    await page.keyboard.press('Escape').catch(() => {});
    if (await page.locator('.bruno-modal').count()) {
      await page.keyboard.press('Escape').catch(() => {});
      await page.locator('.bruno-modal').waitFor({ state: 'detached', timeout: 5000 }).catch(() => {});
    }
  });

  test('deletes a JS script from the sidebar and the disk', async ({ page, createTmpDir }) => {
    const collectionPath = await createTmpDir('js-script-delete');
    const collectionName = 'js-script-delete';
    const scriptName = 'doomed-script';
    await createCollection(page, collectionName, collectionPath, 'bru');

    await createJsScriptViaModal(page, collectionName, scriptName);
    const { sidebar, tabs } = buildCommonLocators(page);
    await expect(sidebar.itemRow(scriptName)).toBeVisible();

    await deleteRequest(page, scriptName, collectionName);

    await test.step('Sidebar row, tab and disk file are all gone', async () => {
      await expect(sidebar.itemRow(scriptName)).toHaveCount(0);
      await expect(tabs.requestTab(scriptName)).toHaveCount(0);

      const collectionDir = path.join(collectionPath, collectionName);
      await expect.poll(() => listFiles(collectionDir), { timeout: 5000 }).not.toContain(`${scriptName}.js`);
    });
  });
});
