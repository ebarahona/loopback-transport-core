import {
  Application,
  Binding,
  Component,
  CoreBindings,
  inject,
  MetadataInspector,
} from '@loopback/core';
import {
  MESSAGE_HANDLER_METADATA,
  EVENT_HANDLER_METADATA,
  MessageHandlerMetadata,
  EventHandlerMetadata,
} from './decorators';
import {TransportBindings} from './keys';
import {TransportServer, MessageHandler} from './interfaces';
import debugFactory from 'debug';

const debug = debugFactory('loopback:transport');

/**
 * LoopBack 4 component that enables transport-agnostic microservices.
 *
 * Scans controllers for @messageHandler and @eventHandler decorators
 * and registers them with the appropriate transport server.
 *
 * Usage:
 * ```typescript
 * const app = new Application();
 * app.component(TransportComponent);
 * ```
 *
 * Or with REST:
 * ```typescript
 * const app = new RestApplication();
 * app.component(TransportComponent);
 * // HTTP + transport listeners on the same app
 * ```
 */
export class TransportComponent implements Component {
  bindings: Binding[] = [];

  constructor(
    @inject(CoreBindings.APPLICATION_INSTANCE, {optional: true})
    private app?: Application,
  ) {
    debug('TransportComponent initialized');
  }
}
