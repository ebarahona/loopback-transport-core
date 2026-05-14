import type {Application, Binding, Constructor, Provider} from '@loopback/core';
import {BindingScope} from '@loopback/core';
import type {TransportServer} from '../interfaces';
import {
  TRANSPORT_NAME_TAG,
  TRANSPORT_SERVER_TAG,
  TransportBindings,
} from '../keys';

/**
 * Tag a transport server binding for booter discovery.
 *
 * @internal
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
 * Use when the server is already constructed (for example in tests or
 * when no DI is needed).
 *
 * @public
 * @param app - The LoopBack application
 * @param transport - Transport name (e.g. `'kafka'`, `'rabbitmq'`)
 * @param instance - A concrete transport server instance
 * @returns The created binding.
 */
export function registerServer(
  app: Application,
  transport: string,
  instance: TransportServer,
): Binding<TransportServer> {
  return tagServerBinding(
    app.bind(TransportBindings.server(transport)).to(instance),
    transport,
  );
}

/**
 * Register a transport server class with the IoC container.
 *
 * The class is instantiated by the container, enabling constructor
 * injection of config, clients, health checks, and other dependencies.
 * This is the recommended registration method for transport adapters.
 *
 * @public
 * @param app - The LoopBack application
 * @param transport - Transport name (e.g. `'kafka'`, `'rabbitmq'`)
 * @param serverClass - A transport server class constructor
 * @returns The created binding.
 */
export function registerServerClass(
  app: Application,
  transport: string,
  serverClass: Constructor<TransportServer>,
): Binding<TransportServer> {
  return tagServerBinding(
    app
      .bind(TransportBindings.server(transport))
      .toClass(serverClass)
      .inScope(BindingScope.SINGLETON),
    transport,
  );
}

/**
 * Register a transport server provider.
 *
 * Providers enable async factory patterns with full DI support. Use
 * when server construction requires async initialization or complex
 * setup logic. The binding is singleton-scoped so every resolution
 * returns the same server instance.
 *
 * @public
 * @param app - The LoopBack application
 * @param transport - Transport name (e.g. `'kafka'`, `'rabbitmq'`)
 * @param serverProvider - A provider class that produces a {@link TransportServer}
 * @returns The created binding.
 */
export function registerServerProvider(
  app: Application,
  transport: string,
  serverProvider: Constructor<Provider<TransportServer>>,
): Binding<TransportServer> {
  return tagServerBinding(
    app
      .bind(TransportBindings.server(transport))
      .toProvider(serverProvider)
      .inScope(BindingScope.SINGLETON),
    transport,
  );
}
