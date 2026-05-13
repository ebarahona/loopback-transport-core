import {
  Application,
  BindingScope,
  Context,
  injectable,
  invokeMethod,
  MetadataInspector,
} from '@loopback/core';
import {randomUUID} from 'crypto';
import debugFactory from 'debug';
import {isObservable, Observable} from 'rxjs';
import {
  MESSAGE_HANDLER_METADATA,
  EVENT_HANDLER_METADATA,
  MessageHandlerMetadata,
} from '../decorators';
import {TransportServer, MessageHandler} from '../interfaces';
import {TransportBindings, TRANSPORT_SERVER_TAG, TRANSPORT_NAME_TAG} from '../keys';
import {normalizePattern} from '../utils';

const debug = debugFactory('loopback:transport:registry');

/**
 * Separator for registry keys. Uses double colon to avoid collision
 * with colons that may appear inside JSON-stringified object patterns.
 */
const KEY_SEPARATOR = '::';

/**
 * Type-safe controller class and instance signatures.
 */
type ControllerConstructor = abstract new (...args: never[]) => unknown;
type ControllerInstance = Record<string, (...args: unknown[]) => unknown>;

/**
 * Discovers @messageHandler and @eventHandler decorated methods
 * from controllers and registers them with the appropriate transport server.
 *
 * This class does NOT run in the constructor. It is invoked by
 * TransportBooter after all controllers are registered.
 *
 * Handler invocations use per-message child contexts for concurrency
 * safety. The application context is never mutated per-message.
 *
 * Context lifetime extends until the handler result (including Observable
 * streams) fully completes, errors, or times out.
 */
@injectable({scope: BindingScope.SINGLETON})
export class HandlerRegistry {
  /**
   * Registry keyed by `transport::pattern` to support the same pattern
   * on different transports without collision.
   */
  private readonly handlers = new Map<string, MessageHandler[]>();
  private discovered = false;

  /**
   * Scan all controllers in the application for transport decorators
   * and register the handlers.
   *
   * Idempotent: clears previously discovered handlers before scanning.
   */
  async discoverHandlers(app: Application): Promise<void> {
    this.handlers.clear();
    this.discovered = false;

    const controllerBindings = app.findByTag('controller');
    debug(
      'scanning %d controllers for transport handlers',
      controllerBindings.length,
    );

    for (const binding of controllerBindings) {
      const controllerClass = binding.valueConstructor;
      if (!controllerClass) continue;

      const bindingKey = binding.key;
      this.scanMessageHandlers(controllerClass, bindingKey, app);
      this.scanEventHandlers(controllerClass, bindingKey, app);
    }

    this.discovered = true;
    debug('discovered %d transport handlers', this.handlers.size);
  }

  /**
   * Bind discovered handlers to the registered transport servers.
   * Throws if discovery has not been run.
   *
   * Handles precedence: transport-specific handlers override wildcard
   * handlers for the same pattern on that transport's server.
   */
  async bindToServers(app: Application): Promise<void> {
    if (!this.discovered) {
      throw new Error(
        'Cannot bind handlers to servers: discoverHandlers() has not been called.',
      );
    }

    const serverBindings = app.findByTag(TRANSPORT_SERVER_TAG);

    for (const serverBinding of serverBindings) {
      const server = await app.get<TransportServer>(serverBinding.key);
      const transportName = serverBinding.tagMap?.[TRANSPORT_NAME_TAG] as
        | string
        | undefined;

      // Collect handlers for this server.
      // Precedence rules differ by handler type:
      // - Request handlers: specific overrides wildcard (only one per pattern)
      // - Event handlers: both specific and wildcard run (fan-out)
      const boundRequestPatterns = new Set<string>();

      // First pass: transport-specific handlers
      for (const [registryKey, handlers] of this.handlers) {
        if (handlers[0].transport && handlers[0].transport === transportName) {
          const pattern = this.extractPattern(registryKey);
          for (const handler of handlers) {
            server.addHandler(pattern, handler);
          }
          if (!handlers[0].isEventHandler) {
            boundRequestPatterns.add(pattern);
          }
          debug(
            'bound handler [%s] to transport [%s] (specific)',
            pattern,
            transportName,
          );
        }
      }

      // Second pass: wildcard handlers
      // - Request handlers: skip if transport-specific already bound
      // - Event handlers: always bind (fan-out semantics)
      for (const [registryKey, handlers] of this.handlers) {
        if (!handlers[0].transport) {
          const pattern = this.extractPattern(registryKey);
          if (handlers[0].isEventHandler || !boundRequestPatterns.has(pattern)) {
            for (const handler of handlers) {
              server.addHandler(pattern, handler);
            }
            debug(
              'bound handler [%s] to transport [%s] (wildcard)',
              pattern,
              transportName ?? 'default',
            );
          }
        }
      }
    }
  }

  /**
   * Get all discovered handlers.
   */
  getHandlers(): ReadonlyMap<string, readonly MessageHandler[]> {
    const copy = new Map<string, readonly MessageHandler[]>();
    for (const [key, handlers] of this.handlers) {
      copy.set(key, [...handlers]);
    }
    return copy;
  }

  /**
   * Whether discovery has been run.
   */
  isDiscovered(): boolean {
    return this.discovered;
  }

  /**
   * Build the registry key from transport and raw pattern.
   * Normalizes the pattern (sorts object keys) before keying.
   * Format: `transport::normalizedPattern` or `*::normalizedPattern`.
   */
  private buildKey(
    transport: string | undefined,
    pattern: string | Record<string, unknown>,
  ): string {
    return `${transport ?? '*'}${KEY_SEPARATOR}${normalizePattern(pattern)}`;
  }

  /**
   * Extract the pattern portion from a registry key.
   */
  private extractPattern(key: string): string {
    const separatorIndex = key.indexOf(KEY_SEPARATOR);
    return separatorIndex >= 0
      ? key.slice(separatorIndex + KEY_SEPARATOR.length)
      : key;
  }

  private scanMessageHandlers(
    controllerClass: ControllerConstructor,
    controllerBindingKey: string,
    app: Application,
  ): void {
    this.scanHandlers(
      controllerClass,
      controllerBindingKey,
      app,
      MESSAGE_HANDLER_METADATA.key,
      false,
    );
  }

  private scanEventHandlers(
    controllerClass: ControllerConstructor,
    controllerBindingKey: string,
    app: Application,
  ): void {
    this.scanHandlers(
      controllerClass,
      controllerBindingKey,
      app,
      EVENT_HANDLER_METADATA.key,
      true,
    );
  }

  /**
   * Shared scanner for both @messageHandler and @eventHandler metadata.
   * The isEvent flag controls duplicate/chaining rules.
   */
  private scanHandlers(
    controllerClass: ControllerConstructor,
    controllerBindingKey: string,
    app: Application,
    metadataKey: string,
    isEvent: boolean,
  ): void {
    const methods =
      MetadataInspector.getAllMethodMetadata<MessageHandlerMetadata>(
        metadataKey,
        controllerClass.prototype,
      );
    if (!methods) return;

    const decoratorName = isEvent ? '@eventHandler' : '@messageHandler';

    for (const [methodName, metadata] of Object.entries(methods)) {
      const key = this.buildKey(metadata.transport, metadata.pattern);
      const existing = this.handlers.get(key);

      // Reject mixed handler types on the same pattern
      if (existing && existing[0].isEventHandler !== isEvent) {
        throw new Error(
          `Cannot mix @messageHandler and @eventHandler for pattern: ${normalizePattern(metadata.pattern)}. ` +
            'A pattern must be exclusively request/response or event.',
        );
      }

      // Reject duplicate request/response handlers
      if (existing && !isEvent) {
        throw new Error(
          `Duplicate @messageHandler for pattern: ${normalizePattern(metadata.pattern)}. ` +
            'Only one request/response handler per pattern is allowed.',
        );
      }

      const handler: MessageHandler = this.createHandler(
        controllerBindingKey,
        methodName,
        app,
      );
      handler.isEventHandler = isEvent;
      handler.transport = metadata.transport;
      handler.extras = metadata.extras;

      if (existing) {
        existing.push(handler);
        debug(
          'chained %s [%s] on %s.%s',
          decoratorName,
          normalizePattern(metadata.pattern),
          controllerClass.name,
          methodName,
        );
      } else {
        this.handlers.set(key, [handler]);
        debug(
          'discovered %s [%s] on %s.%s',
          decoratorName,
          normalizePattern(metadata.pattern),
          controllerClass.name,
          methodName,
        );
      }
    }
  }

  /**
   * Create a handler function that invokes the controller method through
   * LoopBack's native invocation pipeline.
   *
   * Each invocation creates a uniquely named child Context from the
   * application context. Per-message bindings (payload, transport context)
   * are scoped to the child context and cannot collide with concurrent
   * messages.
   *
   * The child context lifetime extends until the handler result fully
   * resolves. For Observable results, the context stays open until the
   * Observable completes, errors, or times out.
   */
  private createHandler(
    controllerBindingKey: string,
    methodName: string,
    app: Application,
  ): MessageHandler {
    const handler: MessageHandler = async (
      data: unknown,
      context?: unknown,
    ) => {
      const invocationCtx = new Context(
        app,
        `transport-invocation-${randomUUID()}`,
      );

      // Idempotent cleanup guard: Context.close() is synchronous but
      // may be reached from multiple paths (error + teardown) for Observables
      let closed = false;
      const cleanup = () => {
        if (!closed) {
          closed = true;
          invocationCtx.close();
        }
      };

      try {
        invocationCtx.bind(TransportBindings.CURRENT_PAYLOAD).to(data);
        invocationCtx.bind(TransportBindings.CURRENT_CONTEXT).to(context);

        const controller =
          await invocationCtx.get<ControllerInstance>(controllerBindingKey);

        const method = controller[methodName];
        if (typeof method !== 'function') {
          throw new Error(
            `Transport handler method "${methodName}" not found on controller "${controllerBindingKey}"`,
          );
        }

        // Invoke through LoopBack's method invocation pipeline
        // This honors parameter injection, interceptors, and other
        // framework invocation semantics
        const result = await invokeMethod(
          controller,
          methodName,
          invocationCtx,
          [data, context],
        );

        // For Observable results, defer context cleanup until stream completes
        if (isObservable(result)) {
          const obs = result as Observable<unknown>;
          return new Observable(subscriber => {
            const subscription = obs.subscribe({
              next: value => subscriber.next(value),
              error: err => {
                subscriber.error(err);
                cleanup();
              },
              complete: () => {
                subscriber.complete();
                cleanup();
              },
            });
            return () => {
              subscription.unsubscribe();
              cleanup();
            };
          });
        }

        // For non-Observable results, close context immediately
        cleanup();
        return result;
      } catch (err) {
        cleanup();
        throw err;
      }
    };
    return handler;
  }
}
