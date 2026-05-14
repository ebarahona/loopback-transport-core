import type {Constructor} from '@loopback/core';
import {MetadataInspector} from '@loopback/core';
import {
  EVENT_HANDLER_METADATA,
  type EventHandlerMetadata,
  type HandlerOptions,
} from '../decorators';
import type {DiscoveredHandler, HandlerDiscoverer} from './handler-discoverer';
import {HANDLER_KIND_EVENT} from './handler-kind';

/**
 * Default {@link HandlerDiscoverer} for the `@eventHandler` decorator
 * vocabulary. Reads `EVENT_HANDLER_METADATA` from every method on the
 * supplied controller class and emits a `DiscoveredHandler` of
 * `kind: 'event'` for each one.
 *
 * Registered automatically by `TransportComponent` under the
 * `TransportBindings.tags.HANDLER_DISCOVERER` tag. Subclass or replace
 * this discoverer to alter how `@eventHandler` decorators are
 * interpreted; bind under the same tag to add a new vocabulary instead.
 *
 * @public
 */
export class EventHandlerDiscoverer implements HandlerDiscoverer {
  readonly id = 'event';

  discover(controllerClass: Constructor<unknown>): DiscoveredHandler[] {
    const methods =
      MetadataInspector.getAllMethodMetadata<EventHandlerMetadata>(
        EVENT_HANDLER_METADATA.key,
        controllerClass.prototype,
      );
    if (!methods) return [];

    const handlers: DiscoveredHandler[] = [];
    for (const [methodName, metadata] of Object.entries(methods)) {
      const options: HandlerOptions = {};
      if (metadata.transport !== undefined) {
        options.transport = metadata.transport;
      }
      if (metadata.extras !== undefined) {
        options.extras = metadata.extras;
      }

      const discovered: DiscoveredHandler = {
        pattern: metadata.pattern,
        transport: metadata.transport ?? '*',
        kind: HANDLER_KIND_EVENT,
        methodName,
      };
      if (options.transport !== undefined || options.extras !== undefined) {
        discovered.options = options;
      }
      handlers.push(discovered);
    }
    return handlers;
  }
}
