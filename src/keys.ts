import {BindingKey} from '@loopback/core';
import {TransportClient} from './interfaces';

export namespace TransportBindings {
  /**
   * Binding key for the current message payload.
   * Set by the transport server before invoking the handler.
   */
  export const CURRENT_PAYLOAD = BindingKey.create<unknown>(
    'transport.current.payload',
  );

  /**
   * Binding key for the current transport context.
   * Set by the transport server before invoking the handler.
   */
  export const CURRENT_CONTEXT = BindingKey.create<unknown>(
    'transport.current.context',
  );

  /**
   * Binding key prefix for transport configurations.
   */
  export const CONFIG_PREFIX = 'transport.config';

  /**
   * Binding key prefix for transport clients.
   */
  export const CLIENT_PREFIX = 'transport.client';

  /**
   * Binding key prefix for transport servers.
   */
  export const SERVER_PREFIX = 'transport.server';

  /**
   * Get a binding key for a specific transport's configuration.
   */
  export function config(transport: string): BindingKey<Record<string, unknown>> {
    return BindingKey.create(`${CONFIG_PREFIX}.${transport}`);
  }

  /**
   * Get a binding key for a specific transport's client.
   */
  export function client(transport: string): BindingKey<TransportClient> {
    return BindingKey.create(`${CLIENT_PREFIX}.${transport}`);
  }

  /**
   * Get a binding key for a specific transport's server.
   */
  export function server(transport: string): BindingKey<unknown> {
    return BindingKey.create(`${SERVER_PREFIX}.${transport}`);
  }
}
