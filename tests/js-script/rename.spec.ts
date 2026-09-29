import fs from 'node:fs';
import path from 'node:path';
import { test, expect } from '../../playwright';
import {
  createCollection,
  createFolder,
  createJsScriptViaModal,
  expandFolder,
  renameItemTo,
  buildCommonLocators
} from '../utils/page';

const listFiles = (dir: string) => fs.readdirSync(dir).filter((f) => f.endsWith('.js'));

test.describe('JS Script - rename flows', () => {
  // The Electron page is worker-scoped, so a modal or open menu left over from one test
  // will block sidebar clicks in the next. Dismiss both after every test.
  test.afterEach(async ({ page }) => {
    await page.keyboard.press('Escape').catch(() => {});
    if (await page.locator('.bruno-modal').count()) {
      await page.keyboard.press('Escape').catch(() => {});
      await page.locator('.bruno-modal').waitFor({ state: 'detached', timeout: 5000 }).catch(() => {});
    }
  });

  test('renames a JS script at the collection root, keeping the tab identity', async ({ page, createTmpDir }) => {
    const collectionPath = await createTmpDir('js-script-rename-root');
    const collectionName = 'js-script-rename-root';
    const scriptName = 'old-script';
    const newScriptName = 'renamed-script';
    await createCollection(page, collectionName, collectionPath, 'bru');

    await createJsScriptViaModal(page, collectionName, scriptName);
    const { sidebar, tabs, toast } = buildCommonLocators(page);
    await expect(sidebar.itemRow(scriptName)).toBeVisible();
    await expect(tabs.requestTab(scriptName)).toBeVisible();

    await renameItemTo(page, scriptName, newScriptName, 'js');

    await test.step('Sidebar, tab and disk reflect the new name; old file is gone', async () => {
      await expect(toast.byMessage('Item renamed successfully').first()).toBeVisible({ timeout: 5000 });
      await expect(sidebar.itemRow(newScriptName)).toBeVisible();
      await expect(sidebar.itemRow(scriptName)).toHaveCount(0);
      await expect(tabs.requestTab(newScriptName)).toBeVisible({ timeout: 5000 });
      await expect(tabs.requestTab(scriptName)).toHaveCount(0);

      const collectionDir = path.join(collectionPath, collectionName);
      await expect.poll(() => listFiles(collectionDir), { timeout: 5000 }).toContain(`${newScriptName}.js`);
      expect(listFiles(collectionDir)).not.toContain(`${scriptName}.js`);
    });
  });

  test('renames a JS script inside a folder', async ({ page, createTmpDir }) => {
    const collectionPath = await createTmpDir('js-script-rename-folder');
    const collectionName = 'js-script-rename-folder';
    const folderName = 'scripts-folder';
    const scriptName = 'folder-script';
    // Not a substring of the old name — itemRow/folderRequest match by hasText.
    const newScriptName = 'renamed-js';
    await createCollection(page, collectionName, collectionPath, 'bru');
    await createFolder(page, folderName, collectionName, true);

    await createJsScriptViaModal(page, folderName, scriptName, { inFolder: true });
    const { sidebar } = buildCommonLocators(page);
    await expandFolder(page, folderName);
    await expect(sidebar.folderRequest(folderName, scriptName)).toBeVisible();

    await renameItemTo(page, scriptName, newScriptName, 'js');

    await test.step('Sidebar and disk reflect the new name inside the folder', async () => {
      await expect(sidebar.folderRequest(folderName, newScriptName)).toBeVisible();
      await expect(sidebar.folderRequest(folderName, scriptName)).toHaveCount(0);

      const folderDir = path.join(collectionPath, collectionName, folderName);
      await expect.poll(() => listFiles(folderDir), { timeout: 5000 }).toContain(`${newScriptName}.js`);
      expect(listFiles(folderDir)).not.toContain(`${scriptName}.js`);
    });
  });

  test('renaming to an existing name suffixes the file', async ({ page, createTmpDir }) => {
    const collectionPath = await createTmpDir('js-script-rename-collision');
    const collectionName = 'js-script-rename-collision';
    await createCollection(page, collectionName, collectionPath, 'bru');

    await createJsScriptViaModal(page, collectionName, 'signin');
    await createJsScriptViaModal(page, collectionName, 'login');
    const { sidebar } = buildCommonLocators(page);
    await expect(sidebar.itemRow('signin')).toBeVisible();
    await expect(sidebar.itemRow('login')).toBeVisible();

    await renameItemTo(page, 'login', 'signin', 'js');

    await test.step('Second script shows the suffixed name; old file gone', async () => {
      // A js script has no meta name — its display name is the file basename, so
      // the collision suffix lands in the sidebar name ("signin 1"), unlike requests
      // which keep the requested display name.
      await expect(sidebar.itemRow('signin 1')).toBeVisible();
      await expect(sidebar.itemRow('signin')).toHaveCount(1);
      await expect(sidebar.itemRow('login')).toHaveCount(0);

      const collectionDir = path.join(collectionPath, collectionName);
      await expect.poll(() => listFiles(collectionDir), { timeout: 5000 }).toContain('signin 1.js');
      expect(listFiles(collectionDir)).toContain('signin.js');
      expect(listFiles(collectionDir)).not.toContain('login.js');
    });
  });
});
