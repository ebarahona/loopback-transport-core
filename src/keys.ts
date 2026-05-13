import {
  Application,
  Binding,
  BindingKey,
  BindingScope,
  Constructor,
  Provider,
} from '@loopback/core';
import {TransportClient, TransportServer} from './interfaces';
import type {HandlerRegistry} from './registry';

/**
 * Tag used to identify transport server bindings.
 * Transport adapters should tag their server bindings with this value.
 */
export const TRANSPORT_SERVER_TAG = 'transport-server';

/**
 * Tag key for the transport name on server bindings.
 */
export const TRANSPORT_NAME_TAG = 'transport';

export namespace TransportBindings {
  /**
   * Binding key for the handler registry.
   */
  export const HANDLER_REGISTRY = BindingKey.create<HandlerRegistry>(
    'transport.handler-registry',
  );

  /**
   * Binding key for the current message payload.
   * Set by the handler registry before invoking the handler.
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
  export function server(transport: string): BindingKey<TransportServer> {
    return BindingKey.create(`${SERVER_PREFIX}.${transport}`);
  }

  /**
   * Tag a transport server binding for booter discovery.
   */
  function tagServerBinding(
    binding: Binding<TransportServer>,
    transport: string,
  ): Binding<TransportServer> {
    return binding
      .tag(TRANSPORT_SERVER_TAG)
      .tag({[TRANSPORT_NAME_TAG]: transport});
  }

  /**
   * Register a concrete transport server instance.
   *
   * Use when the server is already constructed (e.g., in tests or
   * when no DI is needed).
   *
   * @param app - The LoopBack application
   * @param transport - Transport name (e.g., 'kafka', 'rabbitmq')
   * @param instance - A concrete transport server instance
   */
  export function registerServer(
    app: Application,
    transport: string,
    instance: TransportServer,
  ): Binding<TransportServer> {
    return tagServerBinding(app.bind(server(transport)).to(instance), transport);
  }

  /**
   * Register a transport server class with the IoC container.
   *
   * The class is instantiated by the container, enabling constructor
   * injection of config, clients, health checks, and other dependencies.
   * This is the recommended registration method for transport adapters.
   *
   * @param app - The LoopBack application
   * @param transport - Transport name (e.g., 'kafka', 'rabbitmq')
   * @param serverClass - A transport server class constructor
   */
  export function registerServerClass(
    app: Application,
    transport: string,
    serverClass: Constructor<TransportServer>,
  ): Binding<TransportServer> {
    return tagServerBinding(
      app
        .bind(server(transport))
        .toClass(serverClass)
        .inScope(BindingScope.SINGLETON),
      transport,
    );
  }

  /**
   * Register a transport server provider.
   *
   * Providers enable async factory patterns with full DI support.
   * Use when server construction requires async initialization or
   * complex setup logic. The binding is singleton-scoped so every
   * resolution returns the same server instance.
   *
   * @param app - The LoopBack application
   * @param transport - Transport name (e.g., 'kafka', 'rabbitmq')
   * @param serverProvider - A provider class that produces a TransportServer
   */
  export function registerServerProvider(
    app: Application,
    transport: string,
    serverProvider: Constructor<Provider<TransportServer>>,
  ): Binding<TransportServer> {
    return tagServerBinding(
      app
        .bind(server(transport))
        .toProvider(serverProvider)
        .inScope(BindingScope.SINGLETON),
      transport,
    );
  }
}
