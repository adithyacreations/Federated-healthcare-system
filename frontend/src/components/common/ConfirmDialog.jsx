import Modal from './Modal';

const ConfirmDialog = ({
  isOpen,
  onConfirm,
  onCancel,
  title = 'Are you sure?',
  message = 'This action cannot be undone.',
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  variant = 'danger',
}) => (
  <Modal isOpen={isOpen} onClose={onCancel} title={title} size="sm">
    <p className="text-gray-700 mb-6 leading-relaxed">{message}</p>
    <div className="flex justify-end gap-3">
      <button onClick={onCancel} className="btn-secondary">
        {cancelLabel}
      </button>
      <button
        onClick={onConfirm}
        className={variant === 'danger' ? 'btn-danger' : 'btn-primary'}
      >
        {confirmLabel}
      </button>
    </div>
  </Modal>
);

export default ConfirmDialog;
