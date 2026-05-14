import {TransportError} from '../helpers/errors';

/**
 * The type of transport handling the current request.
 *
 * @public
 */
export type ContextType = 'http' | 'rpc' | 'event';

/**
 * Handler function type. Avoids bare `Function`.
 *
 * @public
 */
export type HandlerFunction = (...args: unknown[]) => unknown;

/**
 * Controller class type. Avoids bare `Function`.
 *
 * @public
 * @typeParam T - The constructed instance type.
 */
export type ControllerClass<T = unknown> = abstract new (...args: never[]) => T;

/**
 * HTTP-specific context. Wraps Express request/response.
 *
 * @public
 */
export interface HttpContext {
  getRequest<T = unknown>(): T;
  getResponse<T = unknown>(): T;
}

/**
 * RPC-specific context (gRPC, request/response patterns).
 *
 * @public
 */
export interface RpcContext {
  getData<T = unknown>(): T;
  getContext<T = unknown>(): T;
  getMethod(): string;
}

/**
 * Event-specific context (Kafka, RabbitMQ, MQTT, NATS events).
 *
 * @public
 */
export interface EventContext {
  getData<T = unknown>(): T;
  getPattern(): string;
  getContext<T = unknown>(): T;
}

/**
 * Unified execution context that works across HTTP, RPC, and event
 * transports.
 *
 * Immutable after construction. Created via static factory methods that
 * guarantee the transport-specific context is present. No half-built
 * contexts, no post-construction mutation.
 *
 * NestJS-compatible mental model: `getType()` + `switchToHttp/Rpc/Event`.
 * Cleaner construction: factory methods enforce correct state.
 *
 * @public
 */
export class ExecutionContext {
  private readonly type: ContextType;
  private readonly args: readonly unknown[];
  private readonly handler: HandlerFunction;
  private readonly controllerClass: ControllerClass;
  private readonly httpCtx?: HttpContext;
  private readonly rpcCtx?: RpcContext;
  private readonly eventCtx?: EventContext;

  private constructor(
    type: ContextType,
    args: unknown[],
    handler: HandlerFunction,
    controllerClass: ControllerClass,
    contexts: {
      http?: HttpContext;
      rpc?: RpcContext;
      event?: EventContext;
    },
  ) {
    this.type = type;
    this.args = [...args];
    this.handler = handler;
    this.controllerClass = controllerClass;
    if (contexts.http !== undefined) this.httpCtx = contexts.http;
    if (contexts.rpc !== undefined) this.rpcCtx = contexts.rpc;
    if (contexts.event !== undefined) this.eventCtx = contexts.event;
  }

  /**
   * Create an HTTP execution context.
   *
   * @public
   */
  static forHttp(
    args: unknown[],
    handler: HandlerFunction,
    controllerClass: ControllerClass,
    httpCtx: HttpContext,
  ): ExecutionContext {
    return new ExecutionContext('http', args, handler, controllerClass, {
      http: httpCtx,
    });
  }

  /**
   * Create an RPC execution context (gRPC, request/response patterns).
   *
   * @public
   */
  static forRpc(
    args: unknown[],
    handler: HandlerFunction,
    controllerClass: ControllerClass,
    rpcCtx: RpcContext,
  ): ExecutionContext {
    return new ExecutionContext('rpc', args, handler, controllerClass, {
      rpc: rpcCtx,
    });
  }

  /**
   * Create an event execution context (Kafka, RabbitMQ, MQTT, NATS).
   *
   * @public
   */
  static forEvent(
    args: unknown[],
    handler: HandlerFunction,
    controllerClass: ControllerClass,
    eventCtx: EventContext,
  ): ExecutionContext {
    return new ExecutionContext('event', args, handler, controllerClass, {
      event: eventCtx,
    });
  }

  /**
   * Returns the transport type handling this request.
   *
   * @public
   */
  getType(): ContextType {
    return this.type;
  }

  /**
   * Returns the controller class the handler belongs to.
   *
   * @experimental The generic parameter is asserted, not inferred.
   *   Callers must verify the resulting class shape themselves.
   * @typeParam T - Caller-asserted instance type.
   */
  getClass<T = unknown>(): ControllerClass<T> {
    return this.controllerClass as ControllerClass<T>;
  }

  /**
   * Returns the handler function that will be invoked.
   *
   * @public
   */
  getHandler(): HandlerFunction {
    return this.handler;
  }

  /**
   * Returns a copy of the arguments array.
   *
   * @experimental Callers assert the tuple shape; no runtime check is
   *   performed.
   * @typeParam T - Caller-asserted tuple type.
   */
  getArgs<T extends readonly unknown[] = readonly unknown[]>(): T {
    return [...this.args] as unknown as T;
  }

  /**
   * Returns a specific argument by index.
   *
   * @experimental Callers assert the value type; no runtime check is
   *   performed.
   * @typeParam T - Caller-asserted argument type.
   */
  getArgByIndex<T = unknown>(index: number): T {
    return this.args[index] as T;
  }

  /**
   * Switch to HTTP context. Throws if the current type is not `http`
   * or the context is missing.
   *
   * @public
   * @throws TransportError When the current transport type is not HTTP.
   */
  switchToHttp(): HttpContext {
    if (this.type !== 'http' || !this.httpCtx) {
      throw new TransportError(
        `Cannot switch to HTTP context: current transport type is "${this.type}"`,
      );
    }
    return this.httpCtx;
  }

  /**
   * Switch to RPC context. Throws if the current type is not `rpc` or
   * the context is missing.
   *
   * @public
   * @throws TransportError When the current transport type is not RPC.
   */
  switchToRpc(): RpcContext {
    if (this.type !== 'rpc' || !this.rpcCtx) {
      throw new TransportError(
        `Cannot switch to RPC context: current transport type is "${this.type}"`,
      );
    }
    return this.rpcCtx;
  }

  /**
   * Switch to event context. Throws if the current type is not `event`
   * or the context is missing.
   *
   * @public
   * @throws TransportError When the current transport type is not event.
   */
  switchToEvent(): EventContext {
    if (this.type !== 'event' || !this.eventCtx) {
      throw new TransportError(
        `Cannot switch to event context: current transport type is "${this.type}"`,
      );
    }
    return this.eventCtx;
  }
}
