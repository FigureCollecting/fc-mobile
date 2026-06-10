import { signal } from '@preact/signals';

export interface ToastMessage {
  id: string;
  message: string;
  type: 'info' | 'success' | 'error';
}

export const toasts = signal<ToastMessage[]>([]);

export function showToast(message: string, type: 'info' | 'success' | 'error' = 'info') {
  const id = Date.now().toString();
  toasts.value = [...toasts.value, { id, message, type }];
  setTimeout(() => {
    toasts.value = toasts.value.filter((t) => t.id !== id);
  }, 3000);
}

export function dismissToast(id: string) {
  toasts.value = toasts.value.filter((t) => t.id !== id);
}
