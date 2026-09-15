import reducer, { runFolderEvent, updateRunnerDataFile, resetCollectionRunner } from './index';

const baseState = () => ({
  collections: [
    {
      uid: 'col-1',
      items: [{ uid: 'req-1', type: 'http-request' }],
      runnerResult: null,
      runnerConfiguration: null
    }
  ]
});

describe('data-driven runner events', () => {
  it('testrun-started stores iterationCount and dataFilePath in info', () => {
    const state = reducer(baseState(), runFolderEvent({
      type: 'testrun-started',
      collectionUid: 'col-1',
      folderUid: null,
      isRecursive: true,
      iterationCount: 3,
      dataFilePath: 'C:/data/rows.csv'
    }));
    const info = state.collections[0].runnerResult.info;
    expect(info.iterationCount).toBe(3);
    expect(info.dataFilePath).toBe('C:/data/rows.csv');
  });

  it('request-queued stores the 1-based iteration on the item', () => {
    let state = reducer(baseState(), runFolderEvent({
      type: 'testrun-started', collectionUid: 'col-1', folderUid: null
    }));
    state = reducer(state, runFolderEvent({
      type: 'request-queued', collectionUid: 'col-1', folderUid: null, itemUid: 'req-1', requestUid: 'ru-1', iteration: 2
    }));
    expect(state.collections[0].runnerResult.items[0].iteration).toBe(2);
  });

  it('later events target the latest item for a repeated request uid (findLast across iterations)', () => {
    let state = reducer(baseState(), runFolderEvent({
      type: 'testrun-started', collectionUid: 'col-1', folderUid: null
    }));
    for (const iteration of [1, 2]) {
      state = reducer(state, runFolderEvent({
        type: 'request-queued', collectionUid: 'col-1', folderUid: null, itemUid: 'req-1', requestUid: `ru-${iteration}`, iteration
      }));
      state = reducer(state, runFolderEvent({
        type: 'response-received', collectionUid: 'col-1', folderUid: null, itemUid: 'req-1', responseReceived: { status: 200, iteration }
      }));
    }
    const items = state.collections[0].runnerResult.items;
    expect(items).toHaveLength(2);
    expect(items[1].responseReceived.status).toBe(200);
  });

  it('updateRunnerDataFile persists and clears the path', () => {
    let state = reducer(baseState(), updateRunnerDataFile({ collectionUid: 'col-1', dataFilePath: 'C:/data/rows.csv' }));
    expect(state.collections[0].runnerConfiguration.dataFilePath).toBe('C:/data/rows.csv');
    state = reducer(state, updateRunnerDataFile({ collectionUid: 'col-1', dataFilePath: null }));
    expect(state.collections[0].runnerConfiguration.dataFilePath).toBeNull();
  });

  it('resetCollectionRunner clears data-driven state', () => {
    let state = reducer(baseState(), updateRunnerDataFile({ collectionUid: 'col-1', dataFilePath: 'x' }));
    state = reducer(state, resetCollectionRunner({ collectionUid: 'col-1' }));
    expect(state.collections[0].runnerConfiguration).toBeNull();
  });
});
