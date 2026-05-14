import type {Constructor} from '@loopback/core';
import {MetadataInspector} from '@loopback/core';
import {
  MESSAGE_HANDLER_METADATA,
  type HandlerOptions,
  type MessageHandlerMetadata,
} from '../decorators';
import type {DiscoveredHandler, HandlerDiscoverer} from './handler-discoverer';
import {HANDLER_KIND_REQUEST} from './handler-kind';

/**
 * Default {@link HandlerDiscoverer} for the `@messageHandler` decorator
 * vocabulary. Reads `MESSAGE_HANDLER_METADATA` from every method on the
 * supplied controller class and emits a `DiscoveredHandler` of
 * `kind: 'request'` for each one.
 *
 * Registered automatically by `TransportComponent` under the
 * `TransportBindings.tags.HANDLER_DISCOVERER` tag. Subclass or replace
 * this discoverer to alter how `@messageHandler` decorators are
 * interpreted; bind under the same tag to add a new vocabulary instead.
 *
 * @public
 */
export class MessageHandlerDiscoverer implements HandlerDiscoverer {
  readonly id = 'message';

  discover(controllerClass: Constructor<unknown>): DiscoveredHandler[] {
    const methods =
      MetadataInspector.getAllMethodMetadata<MessageHandlerMetadata>(
        MESSAGE_HANDLER_METADATA.key,
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
        kind: HANDLER_KIND_REQUEST,
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
