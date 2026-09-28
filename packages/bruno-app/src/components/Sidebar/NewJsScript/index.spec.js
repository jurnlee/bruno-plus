import '@testing-library/jest-dom';
import os from 'os';
import path from 'path';
import React from 'react';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { Provider } from 'react-redux';
import { configureStore, createSlice } from '@reduxjs/toolkit';
import toast from 'react-hot-toast';
import { newJsScript } from 'providers/ReduxStore/slices/collections/actions';
import NewJsScript from './index';

const mockNewJsScript = jest.fn();

jest.mock('providers/ReduxStore/slices/collections/actions', () => ({
  newJsScript: (params) => (dispatch) => mockNewJsScript(params)
}));

jest.mock('react-hot-toast', () => ({
  success: jest.fn(),
  error: jest.fn()
}));

jest.mock('components/Portal', () => ({
  __esModule: true,
  default: ({ children }) => <div data-testid="portal-root">{children}</div>
}));

jest.mock('components/Modal', () => ({
  __esModule: true,
  default: (props) => (
    <div data-testid="mock-modal">
      <div data-testid="modal-title">{props.title}</div>
      {props.children}
      <button
        data-testid="new-js-script-submit-btn"
        disabled={props.confirmDisabled}
        onClick={props.handleConfirm}
      >
        {props.confirmText}
      </button>
      <button data-testid="new-js-script-cancel-btn" onClick={props.handleCancel}>
        cancel
      </button>
    </div>
  )
}));

const buildCollection = (overrides = {}) => ({
  uid: 'collection-1',
  name: 'Bruno-Testbench',
  pathname: path.join(os.tmpdir(), 'bruno-testbench'),
  format: 'bru',
  items: [],
  ...overrides
});

const renderNewJsScript = ({ collection = buildCollection(), item, onClose = jest.fn() } = {}) => {
  const collections = collection ? [collection] : [];
  const slice = createSlice({ name: 'collections', initialState: { collections }, reducers: {} });
  const store = configureStore({ reducer: { collections: slice.reducer } });
  const utils = render(
    <Provider store={store}>
      <NewJsScript collectionUid="collection-1" item={item} onClose={onClose} />
    </Provider>
  );
  return { ...utils, onClose, store };
};

const typeName = (value) => {
  fireEvent.change(screen.getByTestId('new-js-script-name-input'), { target: { value } });
};

beforeEach(() => {
  jest.clearAllMocks();
});

describe('NewJsScript', () => {
  it('renders the modal in a Portal (so it escapes the sidebar subtree)', () => {
    renderNewJsScript();
    expect(screen.getByTestId('portal-root')).toBeInTheDocument();
    expect(screen.getByTestId('mock-modal')).toBeInTheDocument();
    expect(screen.getByTestId('modal-title')).toHaveTextContent('New JS Script');
  });

  it('shows the collection name in the description when opened at the collection root', () => {
    renderNewJsScript();
    expect(screen.getByText(/collection "Bruno-Testbench"/i)).toBeInTheDocument();
  });

  it('shows "this folder" wording when opened on a folder item', () => {
    renderNewJsScript({ item: { uid: 'folder-1', type: 'folder', name: 'sub' } });
    expect(screen.getByText(/standalone JS file in this folder/i)).toBeInTheDocument();
  });

  it('always shows the fixed .js extension suffix', () => {
    renderNewJsScript();
    expect(screen.getByText('.js')).toBeInTheDocument();
  });

  it('dispatches newJsScript with a .js filename and shows success toast', async () => {
    mockNewJsScript.mockResolvedValue();
    const { onClose } = renderNewJsScript();

    typeName('My Script');
    fireEvent.click(screen.getByTestId('new-js-script-submit-btn'));

    await waitFor(() => expect(mockNewJsScript).toHaveBeenCalledTimes(1));
    expect(mockNewJsScript).toHaveBeenCalledWith({
      scriptName: 'My Script',
      filename: 'My Script.js',
      collectionUid: 'collection-1',
      itemUid: null
    });
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('JS Script created'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('passes the parent folder uid when opened from a folder', async () => {
    mockNewJsScript.mockResolvedValue();
    renderNewJsScript({ item: { uid: 'folder-1', type: 'folder', name: 'sub' } });

    typeName('helpers');
    fireEvent.click(screen.getByTestId('new-js-script-submit-btn'));

    await waitFor(() => expect(mockNewJsScript).toHaveBeenCalledWith({
      scriptName: 'helpers',
      filename: 'helpers.js',
      collectionUid: 'collection-1',
      itemUid: 'folder-1'
    }));
  });

  it('shows the thunk error message on failure and does not close the modal', async () => {
    mockNewJsScript.mockRejectedValue(new Error('An item with this name already exists in this folder'));
    const { onClose } = renderNewJsScript();

    typeName('Dupe');
    fireEvent.click(screen.getByTestId('new-js-script-submit-btn'));

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith('An item with this name already exists in this folder')
    );
    expect(toast.success).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('falls back to a generic error message when the thunk rejects without a message', async () => {
    mockNewJsScript.mockRejectedValue(new Error());
    renderNewJsScript();

    typeName('Anything');
    fireEvent.click(screen.getByTestId('new-js-script-submit-btn'));

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Failed to create JS Script'));
  });

  it('does not dispatch on an empty or blank name', async () => {
    renderNewJsScript();

    typeName('   ');
    fireEvent.click(screen.getByTestId('new-js-script-submit-btn'));

    // Give validation a tick to run
    await act(async () => {});
    expect(mockNewJsScript).not.toHaveBeenCalled();
    expect(toast.success).not.toHaveBeenCalled();
  });

  it('does not dispatch on an invalid name (leading hyphen)', async () => {
    renderNewJsScript();

    typeName('-invalid');
    fireEvent.click(screen.getByTestId('new-js-script-submit-btn'));

    await act(async () => {});
    expect(mockNewJsScript).not.toHaveBeenCalled();
  });

  describe('duplicate-submission protection', () => {
    // Same race as NewApp: Enter used to submit twice — once via the form's native
    // onSubmit, once via Modal's document-level Enter handler → handleConfirm. The
    // form preventDefaults, so the native path must NOT dispatch.
    it('does not dispatch when the form is submitted natively (Enter in input)', async () => {
      mockNewJsScript.mockResolvedValue();
      renderNewJsScript();

      typeName('My Script');
      // Simulate the browser's native form submit that Enter-in-input produces.
      const form = screen.getByTestId('new-js-script-form');
      fireEvent.submit(form);

      await act(async () => {});
      expect(mockNewJsScript).not.toHaveBeenCalled();
    });

    it('dispatches only once when both paths fire (native submit + confirm click)', async () => {
      mockNewJsScript.mockResolvedValue();
      renderNewJsScript();

      typeName('My Script');
      // Race the two paths that used to double-fire.
      fireEvent.submit(screen.getByTestId('new-js-script-form'));
      fireEvent.click(screen.getByTestId('new-js-script-submit-btn'));

      await waitFor(() => expect(mockNewJsScript).toHaveBeenCalledTimes(1));
      // No stray error toast about "already exists" from a duplicate call.
      expect(toast.error).not.toHaveBeenCalled();
    });

    it('ignores a second confirm click fired in the same tick as the first', async () => {
      let resolveDispatch;
      mockNewJsScript.mockReturnValue(new Promise((resolve) => { resolveDispatch = resolve; }));
      renderNewJsScript();

      typeName('My Script');
      const submitBtn = screen.getByTestId('new-js-script-submit-btn');

      // Fire two clicks BEFORE React can flush the disabled state — this is the
      // scenario formik.isSubmitting alone cannot guard against, since it is
      // render-state read via closure. The ref lock must catch the second one.
      fireEvent.click(submitBtn);
      fireEvent.click(submitBtn);

      await waitFor(() => expect(mockNewJsScript).toHaveBeenCalledTimes(1));

      // Let the original resolve — success toast fires exactly once.
      await act(async () => { resolveDispatch(); });
      await waitFor(() => expect(toast.success).toHaveBeenCalledTimes(1));
    });

    it('disables the confirm button while a submission is in flight', async () => {
      let resolveDispatch;
      mockNewJsScript.mockReturnValue(new Promise((resolve) => { resolveDispatch = resolve; }));
      renderNewJsScript();

      typeName('My Script');
      const submitBtn = screen.getByTestId('new-js-script-submit-btn');

      fireEvent.click(submitBtn);
      await waitFor(() => expect(submitBtn).toBeDisabled());

      await act(async () => { resolveDispatch(); });
    });
  });

  it('closes the modal when cancel is pressed', () => {
    const { onClose } = renderNewJsScript();
    fireEvent.click(screen.getByTestId('new-js-script-cancel-btn'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
