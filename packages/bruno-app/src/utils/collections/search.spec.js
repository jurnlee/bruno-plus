const { describe, it, expect } = require('@jest/globals');

import {
  doesRequestMatchSearchText,
  doesFolderHaveItemsMatchSearchText,
  doesCollectionHaveItemsMatchingSearchText
} from './search';

const createRequest = (name, props = {}) => ({
  uid: name,
  name,
  type: 'http-request',
  request: {},
  ...props
});

const createFolder = (name, items = []) => ({
  uid: name,
  name,
  type: 'folder',
  items
});

describe('whether a request matches the search text', () => {
  it('matches request names case-insensitively', () => {
    expect(doesRequestMatchSearchText(createRequest('GetUser'), 'user')).toBe(true);
    expect(doesRequestMatchSearchText(createRequest('GetUser'), 'xyz')).toBe(false);
  });

  it('matches request urls case-insensitively', () => {
    const request = createRequest('GetUser', { request: { url: '{{baseUrl}}/api/users' } });

    expect(doesRequestMatchSearchText(request, '/api/')).toBe(true);
    expect(doesRequestMatchSearchText(request, 'API/USERS')).toBe(true);
    expect(doesRequestMatchSearchText(request, '/api/orders')).toBe(false);
  });

  it('matches the draft url while the request has unsaved changes', () => {
    const request = createRequest('GetUser', {
      request: { url: '{{baseUrl}}/api/users' },
      draft: { request: { url: '{{baseUrl}}/api/customers' } }
    });

    expect(doesRequestMatchSearchText(request, 'customers')).toBe(true);
    expect(doesRequestMatchSearchText(request, '/api/')).toBe(true);
  });

  it('returns false when the item has neither a name nor a url', () => {
    expect(doesRequestMatchSearchText({}, '')).toBe(false);
    expect(doesRequestMatchSearchText({}, 'anything')).toBe(false);
  });

  it('does not throw for requests without a request object', () => {
    expect(doesRequestMatchSearchText(createRequest('Alpha'), 'alpha')).toBe(true);
    expect(doesRequestMatchSearchText(createRequest('Alpha'), 'missing')).toBe(false);
  });
});

describe('whether a folder contains a matching request', () => {
  it('matches requests nested inside folders', () => {
    const folder = createFolder('root', [
      createFolder('subfolder', [createRequest('login')]),
      createRequest('health')
    ]);

    expect(doesFolderHaveItemsMatchSearchText(folder, 'login')).toBeTruthy();
    expect(doesFolderHaveItemsMatchSearchText(folder, 'zzz')).toBeFalsy();
  });

  it('matches a nested request by url', () => {
    const folder = createFolder('root', [
      createRequest('Alpha', { request: { url: '{{baseUrl}}/api/users' } }),
      createRequest('Beta', { request: { url: '{{baseUrl}}/api/orders' } })
    ]);

    expect(doesFolderHaveItemsMatchSearchText(folder, 'orders')).toBeTruthy();
    expect(doesFolderHaveItemsMatchSearchText(folder, '/payments')).toBeFalsy();
  });

  it('ignores transient requests', () => {
    const folder = createFolder('root', [
      createRequest('login', { isTransient: true })
    ]);

    expect(doesFolderHaveItemsMatchSearchText(folder, 'login')).toBeFalsy();
  });
});

describe('whether a collection contains a matching request', () => {
  it('matches requests anywhere in the collection tree', () => {
    const collection = {
      items: [
        createFolder('folder', [createRequest('deep-login')]),
        createRequest('health')
      ]
    };

    expect(doesCollectionHaveItemsMatchingSearchText(collection, 'login')).toBeTruthy();
    expect(doesCollectionHaveItemsMatchingSearchText(collection, 'zzz')).toBeFalsy();
  });

  it('matches a nested request by url', () => {
    const collection = {
      items: [
        createFolder('folder', [createRequest('Alpha', { request: { url: '{{baseUrl}}/api/users' } })])
      ]
    };

    expect(doesCollectionHaveItemsMatchingSearchText(collection, '/api/users')).toBeTruthy();
    expect(doesCollectionHaveItemsMatchingSearchText(collection, '/api/orders')).toBeFalsy();
  });
});
