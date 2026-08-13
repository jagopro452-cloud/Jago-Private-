import React from "react";

type AdminLoaderProps = {
  label?: string;
};

export function AdminLoader({ label = "Loading admin module..." }: AdminLoaderProps) {
  return (
    <div className="admin-page-loading" aria-live="polite" aria-busy="true">
      <div className="admin-page-loading__bar" />
      <div className="admin-page-loading__text">{label}</div>
    </div>
  );
}

type AdminEmptyStateProps = {
  icon?: string;
  title: string;
  message?: string;
  action?: React.ReactNode;
};

export function AdminEmptyState({ icon = "bi-inbox", title, message, action }: AdminEmptyStateProps) {
  return (
    <div className="admin-empty-state text-center py-5 px-3">
      <div className="rounded-circle d-inline-flex align-items-center justify-content-center mb-3" style={{ width: 64, height: 64, background: "#eff6ff", color: "#2563eb" }}>
        <i className={`bi ${icon} fs-3`} />
      </div>
      <h2 className="h5 fw-bold mb-2">{title}</h2>
      {message && <p className="text-muted mb-3 mx-auto" style={{ maxWidth: 420 }}>{message}</p>}
      {action}
    </div>
  );
}

type AdminModalProps = {
  open: boolean;
  title: string;
  children: React.ReactNode;
  onClose: () => void;
  footer?: React.ReactNode;
  maxWidth?: number;
};

export function AdminModal({ open, title, children, onClose, footer, maxWidth = 640 }: AdminModalProps) {
  if (!open) return null;
  return (
    <div className="admin-modal-backdrop" role="presentation" onMouseDown={onClose}>
      <section
        className="admin-modal-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="admin-modal-title"
        style={{ maxWidth }}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="admin-modal-header">
          <h2 id="admin-modal-title" className="h5 mb-0 fw-bold">{title}</h2>
          <button type="button" className="btn-close" aria-label="Close dialog" onClick={onClose} />
        </header>
        <div className="admin-modal-body">{children}</div>
        {footer && <footer className="admin-modal-footer">{footer}</footer>}
      </section>
    </div>
  );
}

type AdminConfirmOptions = {
  title?: string;
  message: React.ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: "danger" | "primary";
};

type AdminConfirmRequest = Required<Pick<AdminConfirmOptions, "title" | "confirmLabel" | "cancelLabel" | "variant">> & {
  id: number;
  message: React.ReactNode;
  resolve: (confirmed: boolean) => void;
};

let adminConfirmSequence = 0;
const adminConfirmListeners = new Set<(request: AdminConfirmRequest) => void>();

export function adminConfirm(input: string | AdminConfirmOptions): Promise<boolean> {
  const options: AdminConfirmOptions = typeof input === "string" ? { message: input } : input;
  return new Promise((resolve) => {
    const request: AdminConfirmRequest = {
      id: ++adminConfirmSequence,
      title: options.title ?? "Confirm action",
      message: options.message,
      confirmLabel: options.confirmLabel ?? "Confirm",
      cancelLabel: options.cancelLabel ?? "Cancel",
      variant: options.variant ?? "danger",
      resolve,
    };

    if (adminConfirmListeners.size === 0) {
      resolve(false);
      return;
    }

    adminConfirmListeners.forEach((listener) => listener(request));
  });
}

export function AdminConfirmHost() {
  const [request, setRequest] = React.useState<AdminConfirmRequest | null>(null);

  React.useEffect(() => {
    const listener = (nextRequest: AdminConfirmRequest) => setRequest(nextRequest);
    adminConfirmListeners.add(listener);
    return () => {
      adminConfirmListeners.delete(listener);
    };
  }, []);

  const resolve = (confirmed: boolean) => {
    if (!request) return;
    request.resolve(confirmed);
    setRequest(null);
  };

  return (
    <AdminModal
      open={!!request}
      title={request?.title ?? "Confirm action"}
      onClose={() => resolve(false)}
      footer={(
        <>
          <button type="button" className="btn btn-outline-secondary" onClick={() => resolve(false)}>
            {request?.cancelLabel ?? "Cancel"}
          </button>
          <button
            type="button"
            className={`btn btn-${request?.variant === "primary" ? "primary" : "danger"}`}
            onClick={() => resolve(true)}
          >
            {request?.confirmLabel ?? "Confirm"}
          </button>
        </>
      )}
    >
      <div>{request?.message}</div>
    </AdminModal>
  );
}

type AdminDataTableProps = {
  children: React.ReactNode;
  minWidth?: number;
  maxHeight?: string;
  "aria-label"?: string;
};

export function AdminDataTable({ children, minWidth = 960, maxHeight, "aria-label": ariaLabel }: AdminDataTableProps) {
  return (
    <div className="admin-data-table" style={{ maxHeight }} aria-label={ariaLabel}>
      <table className="table table-borderless align-middle table-hover mb-0" style={{ minWidth }}>
        {children}
      </table>
    </div>
  );
}

type AdminErrorBoundaryState = {
  error: Error | null;
};

export class AdminErrorBoundary extends React.Component<{ children: React.ReactNode }, AdminErrorBoundaryState> {
  state: AdminErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): AdminErrorBoundaryState {
    return { error };
  }

  componentDidUpdate(previousProps: { children: React.ReactNode }) {
    if (previousProps.children !== this.props.children && this.state.error) {
      this.setState({ error: null });
    }
  }

  render() {
    if (this.state.error) {
      return (
        <AdminEmptyState
          icon="bi-exclamation-triangle-fill"
          title="Admin module crashed"
          message="This page failed before it could render safely. Refresh the page after checking the latest deployment logs."
          action={
            <button className="btn btn-primary btn-sm" onClick={() => window.location.reload()}>
              Reload module
            </button>
          }
        />
      );
    }

    return this.props.children;
  }
}
