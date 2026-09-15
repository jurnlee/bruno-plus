const fs = require('fs');
const path = require('path');
const { ipcMain } = require('electron');
const { parseDataFile } = require('@usebruno/common');

const FORMATS_BY_EXTENSION = {
  '.csv': 'csv',
  '.json': 'json'
};

const readDataFile = (filePath) => {
  if (typeof filePath !== 'string' || !filePath.length) {
    throw new Error('A data file path is required');
  }
  const extension = path.extname(filePath).toLowerCase();
  const format = FORMATS_BY_EXTENSION[extension];
  if (!format) {
    throw new Error(`Unsupported data file extension "${extension}" — expected .csv or .json`);
  }
  const content = fs.readFileSync(path.resolve(filePath), 'utf8');
  return parseDataFile(content, format);
};

const registerDataFileIpc = () => {
  ipcMain.handle('renderer:read-data-file', async (event, filePath) => {
    // fs/extension failures reject so the renderer can surface them as data-file errors
    return readDataFile(filePath);
  });
};

module.exports = { readDataFile, registerDataFileIpc };
