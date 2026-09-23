import { flattenItems, isItemARequest } from './index';
import filter from 'lodash/filter';
import find from 'lodash/find';

export const doesRequestMatchSearchText = (item, searchText = '') => {
  const searchQuery = searchText.toLowerCase();
  if (item?.name?.toLowerCase().includes(searchQuery)) {
    return true;
  }

  // The draft url wins over the saved one, mirroring how the request pane renders the in-edit url
  const url = item?.draft?.request?.url ?? item?.request?.url;
  return Boolean(url?.toLowerCase().includes(searchQuery));
};

export const doesFolderHaveItemsMatchSearchText = (item, searchText = '') => {
  let flattenedItems = flattenItems(item.items);
  let requestItems = filter(flattenedItems, (item) => isItemARequest(item) && !item.isTransient);

  return find(requestItems, (request) => doesRequestMatchSearchText(request, searchText));
};

export const doesCollectionHaveItemsMatchingSearchText = (collection, searchText = '') => {
  let flattenedItems = flattenItems(collection.items);
  let requestItems = filter(flattenedItems, (item) => isItemARequest(item) && !item.isTransient);

  return find(requestItems, (request) => doesRequestMatchSearchText(request, searchText));
};
