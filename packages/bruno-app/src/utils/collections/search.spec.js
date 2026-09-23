const { describe, it, expect } = require('@jest/globals');

import {
  doesRequestMatchSearchText,
  doesFolderHaveItemsMatchSearchText,
  doesCollectionHaveItemsMatchingSearchText
} from './search';

describe('doesRequestMatchSearchText', () => {
  it('matches by request name', () => {
    const item = { name: 'Get Users', request: { url: '{{baseUrl}}/api/users' } };

    expect(doesRequestMatchSearchText(item, 'get')).toBe(true);
    expect(doesRequestMatchSearchText(item, 'users')).toBe(true);
    expect(doesRequestMatchSearchText(item, 'orders')).toBe(false);
  });

  it('matches by request url, case-insensitively', () => {
    const item = { name: 'Get Users', request: { url: '{{baseUrl}}/api/users' } };

    expect(doesRequestMatchSearchText(item, '/api/')).toBe(true);
    expect(doesRequestMatchSearchText(item, 'API/USERS')).toBe(true);
    expect(doesRequestMatchSearchText(item, 'baseurl')).toBe(true);
    expect(doesRequestMatchSearchText(item, '/api/orders')).toBe(false);
  });

  it('matches the draft url while the request has unsaved changes', () => {
    const item = {
      name: 'Get Users',
      request: { url: '{{baseUrl}}/api/users' },
      draft: { request: { url: '{{baseUrl}}/api/customers' } }
    };

    expect(doesRequestMatchSearchText(item, 'customers')).toBe(true);
    expect(doesRequestMatchSearchText(item, '/api/')).toBe(true);
  });

  it('returns false when the item has neither a name nor a url', () => {
    expect(doesRequestMatchSearchText({}, '')).toBe(false);
    expect(doesRequestMatchSearchText({}, 'anything')).toBe(false);
  });

  it('does not throw for transient requests without a request object', () => {
    expect(doesRequestMatchSearchText({ name: 'Alpha' }, 'alpha')).toBe(true);
    expect(doesRequestMatchSearchText({ name: 'Alpha' }, 'missing')).toBe(false);
  });
});

describe('doesFolderHaveItemsMatchSearchText', () => {
  it('matches a nested request by url', () => {
    const folder = {
      type: 'folder',
      name: 'folderA',
      items: [
        { uid: 'r1', type: 'http-request', name: 'Alpha', request: { url: '{{baseUrl}}/api/users' } },
        { uid: 'r2', type: 'http-request', name: 'Beta', request: { url: '{{baseUrl}}/api/orders' } }
      ]
    };

    expect(doesFolderHaveItemsMatchSearchText(folder, 'orders')).toBeTruthy();
    expect(doesFolderHaveItemsMatchSearchText(folder, '/payments')).toBeFalsy();
  });
});

describe('doesCollectionHaveItemsMatchingSearchText', () => {
  it('matches a request nested in folders by url', () => {
    const collection = {
      name: 'colA',
      items: [
        {
          uid: 'f1',
          type: 'folder',
          name: 'folderA',
          items: [
            { uid: 'r1', type: 'http-request', name: 'Alpha', request: { url: '{{baseUrl}}/api/users' } }
          ]
        }
      ]
    };

    expect(doesCollectionHaveItemsMatchingSearchText(collection, '/api/users')).toBeTruthy();
    expect(doesCollectionHaveItemsMatchingSearchText(collection, '/api/orders')).toBeFalsy();
  });
});
