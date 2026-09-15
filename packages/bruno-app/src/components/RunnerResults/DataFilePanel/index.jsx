import React, { useEffect, useState } from 'react';
import { useDispatch } from 'react-redux';
import { IconFileImport, IconX } from '@tabler/icons';
import { updateRunnerDataFile } from 'providers/ReduxStore/slices/collections/actions';
import StyledWrapper from './StyledWrapper';

const MAX_PREVIEW_ROWS = 50;

const formatErrors = (errors, fallback) => {
  if (errors?.length) {
    return errors.map((e) => (e.line ? `Line ${e.line}: ${e.message}` : e.message)).join(' · ');
  }
  return fallback;
};

const DataFilePanel = ({ collection, onStatusChange }) => {
  const dispatch = useDispatch();
  const savedPath = collection?.runnerConfiguration?.dataFilePath || null;
  const [rows, setRows] = useState([]);
  const [errors, setErrors] = useState([]);
  const [readError, setReadError] = useState(null);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    onStatusChange({ filePath: savedPath, rows, errors: errors.length ? errors : (readError ? [readError] : []), isLoading });
  }, [savedPath, rows, errors, readError, isLoading]);

  useEffect(() => {
    if (!savedPath) {
      setRows([]);
      setErrors([]);
      setReadError(null);
      return;
    }
    let cancelled = false;
    setIsLoading(true);
    const { ipcRenderer } = window;
    ipcRenderer
      .invoke('renderer:read-data-file', savedPath)
      .then((parsed) => {
        if (cancelled) return;
        setRows(parsed.rows);
        setErrors(parsed.errors);
        setReadError(null);
      })
      .catch((err) => {
        if (cancelled) return;
        setRows([]);
        setErrors([]);
        setReadError({ message: err?.message || 'Failed to read data file' });
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [savedPath]);

  const handleChoose = async () => {
    const { ipcRenderer } = window;
    const filePaths = await ipcRenderer.invoke('renderer:browse-files', [
      { name: 'Data Files', extensions: ['csv', 'json'] }
    ]);
    if (filePaths?.length) {
      dispatch(updateRunnerDataFile(collection.uid, filePaths[0]));
    }
  };

  const handleClear = () => {
    dispatch(updateRunnerDataFile(collection.uid, null));
  };

  // Rows are preview-only; the run itself re-reads the file in the main process
  const previewRows = rows.slice(0, MAX_PREVIEW_ROWS);
  const columnNames = previewRows.length ? Object.keys(previewRows[0]) : [];
  const hasFatalError = Boolean(readError) || errors.length > 0;

  return (
    <StyledWrapper data-testid="data-file-panel">
      <div className="flex items-center justify-between mb-2">
        <div className="file-name-wrap">
          {savedPath ? (
            <>
              <span className="file-name" title={savedPath}>{savedPath.split(/[\\/]/).pop()}</span>
              <span className="row-count" data-testid="data-file-row-count">
                {isLoading ? 'Reading…' : `${rows.length} row${rows.length === 1 ? '' : 's'}`}
              </span>
            </>
          ) : (
            <button className="btn btn-sm btn-secondary" onClick={handleChoose} data-testid="data-file-choose">
              <IconFileImport size={14} className="mr-1" /> Choose CSV/JSON file…
            </button>
          )}
        </div>
        {savedPath ? (
          <button className="link" onClick={handleClear} data-testid="data-file-clear">
            <IconX size={12} className="mr-1" /> Clear
          </button>
        ) : null}
      </div>
      {hasFatalError ? (
        <div className="error" data-testid="data-file-error">
          {formatErrors(errors) || formatErrors(null, readError?.message)}
        </div>
      ) : null}
      {!hasFatalError && previewRows.length > 0 ? (
        <div className="preview" data-testid="data-file-preview">
          <table>
            <thead>
              <tr>{columnNames.map((name) => <th key={name}>{name}</th>)}</tr>
            </thead>
            <tbody>
              {previewRows.map((row, idx) => (
                <tr key={idx}>
                  {columnNames.map((name) => (
                    <td key={name} title={String(row[name] ?? '')}>{String(row[name] ?? '')}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
          {rows.length > MAX_PREVIEW_ROWS ? (
            <div className="more-rows">Showing first {MAX_PREVIEW_ROWS} of {rows.length} rows</div>
          ) : null}
        </div>
      ) : null}
      {!hasFatalError && !isLoading && savedPath && rows.length === 0 ? (
        <div className="error" data-testid="data-file-error">Data file contains no data rows</div>
      ) : null}
    </StyledWrapper>
  );
};

export default DataFilePanel;
