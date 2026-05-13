/**
 * The type of transport handling the current request.
 */
export type ContextType = 'http' | 'rpc' | 'event';

/**
 * HTTP-specific context. Wraps Express request/response.
 */
export interface HttpContext {
  getRequest<T = unknown>(): T;
  getResponse<T = unknown>(): T;
}

/**
 * RPC-specific context (gRPC, request/response patterns).
 */
export interface RpcContext {
  getData<T = unknown>(): T;
  getContext<T = unknown>(): T;
  getMethod(): string;
}

/**
 * Event-specific context (Kafka, RabbitMQ, MQTT, NATS events).
 */
export interface EventContext {
  getData<T = unknown>(): T;
  getPattern(): string;
  getContext<T = unknown>(): T;
}

/**
 * Unified execution context that works across HTTP, RPC, and event transports.
 *
 * Wraps LoopBack 4's InvocationContext without modifying it.
 * Transport adapters populate the context with transport-specific data.
 * Interceptors use getType() and switch methods to access the right context.
 */
export class ExecutionContext {
  private readonly type: ContextType;
  private readonly args: unknown[];
  private readonly handler: Function;
  private readonly controllerClass: Function;
  private httpCtx?: HttpContext;
  private rpcCtx?: RpcContext;
  private eventCtx?: EventContext;

  constructor(
    type: ContextType,
    args: unknown[],
    handler: Function,
    controllerClass: Function,
  ) {
    this.type = type;
    this.args = args;
    this.handler = handler;
    this.controllerClass = controllerClass;
  }

  /**
   * Returns the transport type handling this request.
   */
  getType(): ContextType {
    return this.type;
  }

  /**
   * Returns the controller class the handler belongs to.
   */
  getClass<T = unknown>(): T {
    return this.controllerClass as T;
  }

  /**
   * Returns the handler method that will be invoked.
   */
  getHandler(): Function {
    return this.handler;
  }

  /**
   * Returns the raw arguments array.
   */
  getArgs<T extends unknown[] = unknown[]>(): T {
    return this.args as T;
  }

  /**
   * Returns a specific argument by index.
   */
  getArgByIndex<T = unknown>(index: number): T {
    return this.args[index] as T;
  }

  /**
   * Switch to HTTP context. Throws if the current type is not 'http'.
   */
  switchToHttp(): HttpContext {
    if (!this.httpCtx) {
      throw new Error(
        `Cannot switch to HTTP context: current transport type is "${this.type}"`,
      );
    }
    return this.httpCtx;
  }

  /**
   * Switch to RPC context. Throws if the current type is not 'rpc'.
   */
  switchToRpc(): RpcContext {
    if (!this.rpcCtx) {
      throw new Error(
        `Cannot switch to RPC context: current transport type is "${this.type}"`,
      );
    }
    return this.rpcCtx;
  }

  /**
   * Switch to event context. Throws if the current type is not 'event'.
   */
  switchToEvent(): EventContext {
    if (!this.eventCtx) {
      throw new Error(
        `Cannot switch to event context: current transport type is "${this.type}"`,
      );
    }
    return this.eventCtx;
  }

  /**
   * Set the HTTP context. Called by the HTTP adapter.
   */
  setHttpContext(ctx: HttpContext): void {
    this.httpCtx = ctx;
  }

  /**
   * Set the RPC context. Called by RPC transport adapters (gRPC).
   */
  setRpcContext(ctx: RpcContext): void {
    this.rpcCtx = ctx;
  }

  /**
   * Set the event context. Called by event transport adapters (Kafka, RabbitMQ, MQTT, NATS).
   */
  setEventContext(ctx: EventContext): void {
    this.eventCtx = ctx;
  }
}
