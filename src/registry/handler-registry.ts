import {
  Application,
  Binding,
  BindingScope,
  CoreBindings,
  inject,
  injectable,
  MetadataInspector,
} from '@loopback/core';
import debugFactory from 'debug';
import {
  MESSAGE_HANDLER_METADATA,
  EVENT_HANDLER_METADATA,
  MessageHandlerMetadata,
  EventHandlerMetadata,
} from '../decorators';
import {TransportServer, MessageHandler} from '../interfaces';
import {TransportBindings} from '../keys';

const debug = debugFactory('loopback:transport:registry');

/**
 * Discovers @messageHandler and @eventHandler decorated methods
 * from controllers and registers them with the appropriate transport server.
 *
 * This class does NOT run in the constructor. It is invoked by
 * TransportBooter after all controllers are registered.
 */
@injectable({scope: BindingScope.SINGLETON})
export class HandlerRegistry {
  private readonly handlers = new Map<string, MessageHandler>();

  /**
   * Scan all controllers in the application for transport decorators
   * and register the handlers.
   */
  async discoverHandlers(app: Application): Promise<void> {
    const controllerBindings = app.findByTag('controller');
    debug('scanning %d controllers for transport handlers', controllerBindings.length);

    for (const binding of controllerBindings) {
      const controllerClass = binding.valueConstructor;
      if (!controllerClass) continue;

      this.scanMessageHandlers(controllerClass, app);
      this.scanEventHandlers(controllerClass, app);
    }

    debug('discovered %d transport handlers', this.handlers.size);
  }

  /**
   * Bind discovered handlers to the registered transport servers.
   */
  async bindToServers(app: Application): Promise<void> {
    const serverBindings = app.findByTag('transport-server');

    for (const serverBinding of serverBindings) {
      const server = await app.get<TransportServer>(serverBinding.key);
      const transportName = serverBinding.tagMap?.transport as string | undefined;

      for (const [pattern, handler] of this.handlers) {
        const handlerTransport = handler.extras?.transport as string | undefined;

        // Bind handler to server if transport matches or handler has no transport preference
        if (!handlerTransport || handlerTransport === transportName) {
          server.addHandler(pattern, handler);
          debug(
            'bound handler [%s] to transport [%s]',
            pattern,
            transportName ?? 'default',
          );
        }
      }
    }
  }

  /**
   * Get all discovered handlers.
   */
  getHandlers(): Map<string, MessageHandler> {
    return this.handlers;
  }

  private scanMessageHandlers(
    controllerClass: Function,
    app: Application,
  ): void {
    const methods = MetadataInspector.getAllMethodMetadata<MessageHandlerMetadata>(
      MESSAGE_HANDLER_METADATA.key,
      controllerClass.prototype,
    );
    if (!methods) return;

    for (const [methodName, metadata] of Object.entries(methods)) {
      const handler: MessageHandler = this.createHandler(
        controllerClass,
        methodName,
        app,
      );
      handler.isEventHandler = false;
      handler.extras = {
        ...metadata.extras,
        transport: metadata.transport,
      };

      this.handlers.set(metadata.pattern, handler);
      debug(
        'discovered @messageHandler [%s] on %s.%s',
        metadata.pattern,
        controllerClass.name,
        methodName,
      );
    }
  }

  private scanEventHandlers(
    controllerClass: Function,
    app: Application,
  ): void {
    const methods = MetadataInspector.getAllMethodMetadata<EventHandlerMetadata>(
      EVENT_HANDLER_METADATA.key,
      controllerClass.prototype,
    );
    if (!methods) return;

    for (const [methodName, metadata] of Object.entries(methods)) {
      const handler: MessageHandler = this.createHandler(
        controllerClass,
        methodName,
        app,
      );
      handler.isEventHandler = true;
      handler.extras = {
        ...metadata.extras,
        transport: metadata.transport,
      };

      const existing = this.handlers.get(metadata.pattern);
      if (existing && existing.isEventHandler) {
        // Chain event handlers on the same pattern
        let current = existing;
        while (current.next) {
          current = current.next;
        }
        current.next = handler;
        debug(
          'chained @eventHandler [%s] on %s.%s',
          metadata.pattern,
          controllerClass.name,
          methodName,
        );
      } else {
        this.handlers.set(metadata.pattern, handler);
        debug(
          'discovered @eventHandler [%s] on %s.%s',
          metadata.pattern,
          controllerClass.name,
          methodName,
        );
      }
    }
  }

  /**
   * Create a handler function that resolves the controller instance
   * from the DI container and calls the method.
   *
   * The controller is resolved per-invocation so scoped bindings
   * (e.g., request-scoped) work correctly.
   */
  private createHandler(
    controllerClass: Function,
    methodName: string,
    app: Application,
  ): MessageHandler {
    const handler: MessageHandler = async (
      data: unknown,
      context?: unknown,
    ) => {
      // Bind the current payload and context for @payload() / @transportCtx()
      app.bind(TransportBindings.CURRENT_PAYLOAD).to(data);
      app.bind(TransportBindings.CURRENT_CONTEXT).to(context);

      // Resolve the controller from DI (respects binding scope)
      const controller = await app.get<Record<string, Function>>(
        `controllers.${controllerClass.name}`,
      );
      return controller[methodName](data, context);
    };
    return handler;
  }
}
