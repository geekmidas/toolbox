import { clsx } from 'clsx';
import type { HTMLAttributes, ReactNode, MouseEvent } from 'react';
import { useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';

export interface ModalProps extends HTMLAttributes<HTMLDivElement> {
  /**
   * Whether the modal is open.
   */
  open: boolean;
  /**
   * Callback when the modal should close.
   */
  onClose: () => void;
  /**
   * The content of the modal.
   */
  children: ReactNode;
  /**
   * Whether to close the modal when clicking the backdrop.
   * @default true
   */
  closeOnBackdropClick?: boolean;
  /**
   * Whether to close the modal when pressing Escape.
   * @default true
   */
  closeOnEscape?: boolean;
  /**
   * Size of the modal.
   * @default 'md'
   */
  size?: 'sm' | 'md' | 'lg' | 'xl' | 'full';
}

export interface ModalHeaderProps extends HTMLAttributes<HTMLDivElement> {
  /**
   * The content of the modal header.
   */
  children: ReactNode;
  /**
   * Whether to show a close button.
   * @default true
   */
  showCloseButton?: boolean;
  /**
   * Callback when the close button is clicked.
   */
  onClose?: () => void;
}

export interface ModalContentProps extends HTMLAttributes<HTMLDivElement> {
  /**
   * The content of the modal body.
   */
  children: ReactNode;
}

export interface ModalFooterProps extends HTMLAttributes<HTMLDivElement> {
  /**
   * The content of the modal footer.
   */
  children: ReactNode;
}

const sizeStyles: Record<string, string> = {
  sm: 'max-w-sm',
  md: 'max-w-md',
  lg: 'max-w-lg',
  xl: 'max-w-xl',
  full: 'max-w-[calc(100vw-2rem)] max-h-[calc(100vh-2rem)]',
};

/**
 * Modal component for dialogs and overlays.
 *
 * @example
 * ```tsx
 * <Modal open={isOpen} onClose={() => setIsOpen(false)}>
 *   <ModalHeader onClose={() => setIsOpen(false)}>
 *     <h2>Modal Title</h2>
 *   </ModalHeader>
 *   <ModalContent>
 *     <p>Modal content goes here</p>
 *   </ModalContent>
 *   <ModalFooter>
 *     <Button onClick={() => setIsOpen(false)}>Close</Button>
 *   </ModalFooter>
 * </Modal>
 * ```
 */
export function Modal({
  open,
  onClose,
  children,
  closeOnBackdropClick = true,
  closeOnEscape = true,
  size = 'md',
  className,
  ...props
}: ModalProps) {
  // Handle escape key
  useEffect(() => {
    if (!open || !closeOnEscape) return;

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
      }
    };

    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [open, closeOnEscape, onClose]);

  // Lock body scroll when open
  useEffect(() => {
    if (open) {
      document.body.style.overflow = 'hidden';
      return () => {
        document.body.style.overflow = '';
      };
    }
  }, [open]);

  const handleBackdropClick = useCallback(
    (event: MouseEvent<HTMLDivElement>) => {
      if (closeOnBackdropClick && event.target === event.currentTarget) {
        onClose();
      }
    },
    [closeOnBackdropClick, onClose],
  );

  if (!open) {
    return null;
  }

  const content = (
    <div
      className={clsx(
        'fixed inset-0 z-50',
        'flex items-center justify-center p-4',
        'bg-black/50 backdrop-blur-sm',
        'animate-in fade-in duration-200',
      )}
      onClick={handleBackdropClick}
    >
      <div
        role="dialog"
        aria-modal="true"
        className={clsx(
          'w-full rounded-[var(--ui-radius-lg)]',
          'bg-[var(--ui-background)] border border-[var(--ui-border)]',
          'shadow-xl',
          'animate-in zoom-in-95 duration-200',
          sizeStyles[size],
          className,
        )}
        {...props}
      >
        {children}
      </div>
    </div>
  );

  // Use portal to render at document root
  if (typeof document !== 'undefined') {
    return createPortal(content, document.body);
  }

  return content;
}

/**
 * Modal header section.
 */
export function ModalHeader({
  children,
  showCloseButton = true,
  onClose,
  className,
  ...props
}: ModalHeaderProps) {
  return (
    <div
      className={clsx(
        'flex items-center justify-between gap-4',
        'px-6 py-4',
        'border-b border-[var(--ui-border)]',
        className,
      )}
      {...props}
    >
      <div className="font-semibold text-[var(--ui-text)]">{children}</div>
      {showCloseButton && onClose && (
        <button
          onClick={onClose}
          className={clsx(
            'p-1 rounded-[var(--ui-radius-sm)]',
            'text-[var(--ui-text-muted)] hover:text-[var(--ui-text)]',
            'hover:bg-[var(--ui-surface-hover)]',
            'transition-colors duration-[var(--ui-transition-fast)]',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ui-accent)]',
          )}
          aria-label="Close modal"
        >
          <svg
            className="w-5 h-5"
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 20 20"
            fill="currentColor"
          >
            <path
              fillRule="evenodd"
              d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z"
              clipRule="evenodd"
            />
          </svg>
        </button>
      )}
    </div>
  );
}

/**
 * Modal content section.
 */
export function ModalContent({ children, className, ...props }: ModalContentProps) {
  return (
    <div
      className={clsx('px-6 py-4', className)}
      {...props}
    >
      {children}
    </div>
  );
}

/**
 * Modal footer section.
 */
export function ModalFooter({ children, className, ...props }: ModalFooterProps) {
  return (
    <div
      className={clsx(
        'flex items-center justify-end gap-2',
        'px-6 py-4',
        'border-t border-[var(--ui-border)]',
        className,
      )}
      {...props}
    >
      {children}
    </div>
  );
}

export default Modal;
