import fs from 'node:fs';
import path from 'node:path';
import { test, expect } from '../../playwright';
import {
  createCollection,
  createFolder,
  createJsScriptViaModal,
  expandFolder,
  buildCommonLocators
} from '../utils/page';

const INITIAL_JS_TEMPLATE = '// New JS Script';

test.describe('JS Script - creation flows', () => {
  // The Electron page is worker-scoped, so a modal or open menu left over from one test
  // will block sidebar clicks in the next. Dismiss both after every test.
  test.afterEach(async ({ page }) => {
    await page.keyboard.press('Escape').catch(() => {});
    if (await page.locator('.bruno-modal').count()) {
      await page.keyboard.press('Escape').catch(() => {});
      await page.locator('.bruno-modal').waitFor({ state: 'detached', timeout: 5000 }).catch(() => {});
    }
  });

  test('creates a JS script at the collection root and opens it in an editor tab', async ({ page, createTmpDir }) => {
    const collectionPath = await createTmpDir('js-script-create-root');
    const collectionName = 'js-script-create-root';
    const scriptName = 'root-script';
    await createCollection(page, collectionName, collectionPath, 'bru');

    await createJsScriptViaModal(page, collectionName, scriptName);

    const { sidebar, tabs, fileMode, toast } = buildCommonLocators(page);

    // The sidebar item appears via the file watcher, so rely on auto-retrying assertions.
    await expect(sidebar.itemRow(scriptName)).toBeVisible();
    await expect(tabs.requestTab(scriptName)).toBeVisible();

    const scriptPath = path.join(collectionPath, collectionName, `${scriptName}.js`);
    await expect.poll(() => fs.existsSync(scriptPath), { timeout: 5000 }).toBe(true);
    expect(fs.readFileSync(scriptPath, 'utf8')).toContain(INITIAL_JS_TEMPLATE);

    await expect(fileMode.editor()).toBeVisible();
    await expect(toast.byMessage(/JS Script created/)).toBeVisible({ timeout: 5000 });
  });

  test('creates a JS script inside a folder', async ({ page, createTmpDir }) => {
    const collectionPath = await createTmpDir('js-script-create-folder');
    const collectionName = 'js-script-create-folder';
    const folderName = 'scripts-folder';
    const scriptName = 'folder-script';
    await createCollection(page, collectionName, collectionPath, 'bru');
    await createFolder(page, folderName, collectionName, true);

    await createJsScriptViaModal(page, folderName, scriptName, { inFolder: true });

    const { sidebar, tabs, fileMode } = buildCommonLocators(page);

    // A collapsed folder keeps its children out of the DOM — expand before asserting.
    await expandFolder(page, folderName);
    await expect(sidebar.folderRequest(folderName, scriptName)).toBeVisible();
    await expect(tabs.requestTab(scriptName)).toBeVisible();

    const scriptPath = path.join(collectionPath, collectionName, folderName, `${scriptName}.js`);
    await expect.poll(() => fs.existsSync(scriptPath), { timeout: 5000 }).toBe(true);
    expect(fs.readFileSync(scriptPath, 'utf8')).toContain(INITIAL_JS_TEMPLATE);

    await expect(fileMode.editor()).toBeVisible();
  });
});
