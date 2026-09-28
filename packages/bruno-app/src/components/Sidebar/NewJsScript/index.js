import React, { useRef } from 'react';
import { useFormik } from 'formik';
import * as Yup from 'yup';
import toast from 'react-hot-toast';
import { useDispatch, useSelector } from 'react-redux';
import Modal from 'components/Modal';
import Portal from 'components/Portal';
import { newJsScript } from 'providers/ReduxStore/slices/collections/actions';
import { sanitizeName, validateName, validateNameError } from 'utils/common/regex';
import { resolveRequestFilename } from 'utils/common/platform';

const NewJsScript = ({ collectionUid, item, onClose }) => {
  const dispatch = useDispatch();
  const submitLockRef = useRef(false);

  const collection = useSelector((state) =>
    state.collections.collections?.find((c) => c.uid === collectionUid)
  );

  const formik = useFormik({
    enableReinitialize: true,
    initialValues: { scriptName: '' },
    validationSchema: Yup.object({
      scriptName: Yup.string()
        .trim()
        .min(1, 'Script name is required')
        .max(255, 'Must be 255 characters or less')
        .test('valid-name', validateNameError, (value) => validateName(value || ''))
        .required('Script name is required')
    }),
    onSubmit: (values) => {
      const name = values.scriptName.trim();
      return dispatch(
        newJsScript({
          scriptName: name,
          filename: resolveRequestFilename(sanitizeName(name), 'js'),
          collectionUid,
          itemUid: item ? item.uid : null
        })
      )
        .then(() => {
          toast.success('JS Script created');
          onClose();
        })
        .catch((err) => toast.error(err?.message || 'Failed to create JS Script'))
        .finally(() => { submitLockRef.current = false; });
    }
  });

  const onSubmit = () => {
    if (submitLockRef.current || formik.isSubmitting) return;
    submitLockRef.current = true;
    formik.handleSubmit();
    setTimeout(() => { submitLockRef.current = false; }, 0);
  };

  return (
    <Portal>
      <Modal
        size="md"
        title="New JS Script"
        confirmText="Create"
        handleConfirm={onSubmit}
        handleCancel={onClose}
        disableEscapeKey={false}
        disableCloseOnOutsideClick={false}
        confirmDisabled={formik.isSubmitting}
      >
        <form
          className="bruno-form"
          onSubmit={(e) => e.preventDefault()}
          data-testid="new-js-script-form"
        >
          <label htmlFor="scriptName" className="block font-semibold">
            Name
          </label>
          <div className="relative flex flex-row gap-1 items-center justify-between">
            <input
              id="scriptName"
              type="text"
              name="scriptName"
              data-testid="new-js-script-name-input"
              autoFocus
              autoComplete="off"
              spellCheck="false"
              className="block textbox mt-2 w-full !pr-10"
              value={formik.values.scriptName}
              onChange={formik.handleChange}
            />
            <span className="absolute right-2 top-4 flex justify-center items-center file-extension">.js</span>
          </div>
          {formik.touched.scriptName && formik.errors.scriptName ? (
            <div className="text-red-500 text-xs mt-2" data-testid="form-error">{formik.errors.scriptName}</div>
          ) : (
            <div className="text-xs mt-2 opacity-70">
              Creates a standalone JS file in {item ? 'this folder' : `collection "${collection?.name || ''}"`}.
            </div>
          )}
        </form>
      </Modal>
    </Portal>
  );
};

export default NewJsScript;
