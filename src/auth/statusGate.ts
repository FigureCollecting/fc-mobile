// The one writer of the auth status. A write carries a ticket: the generation its operation
// started in. reloadRequired() starts a new generation, so a status an operation worked out
// before a newer build took the store is dropped instead of replacing 'reload-required'.
import { computed, signal, type ReadonlySignal } from '@preact/signals';

export type AuthStatus = 'loading' | 'signed-out' | 'signed-in' | 'offline' | 'reauth-required' | 'reload-required';

declare const ticketBrand: unique symbol;
/** Only ticket() makes one, so a write cannot be made without one. */
export type Ticket = number & { readonly [ticketBrand]: true };

export class StatusGate {
  readonly #status = signal<AuthStatus>('loading');
  #generation = 0;
  /** Read-only to everyone: a write through it is a type error, and throws if forced with a cast. */
  readonly status: ReadonlySignal<AuthStatus> = computed(() => this.#status.value);

  /** Take this before the operation's first read or write. */
  ticket(): Ticket {
    return this.#generation as Ticket;
  }

  /** Report `status` only if reloadRequired() has not run since `ticket` was taken; else leave the status alone. */
  settle(ticket: Ticket, status: AuthStatus): AuthStatus {
    if (ticket !== this.#generation) return this.#status.peek();
    this.#status.value = status;
    return status;
  }

  /** A newer build took the store: void every ticket already taken. */
  reloadRequired(): void {
    this.#generation += 1;
    this.#status.value = 'reload-required';
  }
}
