// Component
export {TransportComponent} from './transport.component';

// Lifecycle observer (was: transport-booter)
export {TransportBooter} from './transport.observer';

// Binding keys and tags
export {
  DESERIALIZER_TAG,
  HANDLER_DISCOVERER_TAG,
  SERIALIZER_TAG,
  TransportBindings,
  TRANSPORT_NAME_TAG,
  TRANSPORT_SERVER_TAG,
} from './keys';

// Server registration helpers
export {
  registerServer,
  registerServerClass,
  registerServerProvider,
} from './helpers/register-server';

// Typed errors
export {
  TransportConfigError,
  TransportError,
  TransportPatternError,
  TransportSerializationError,
  TransportTimeoutError,
} from './helpers/errors';

// Registry
export {HandlerRegistry} from './registry';

// Handler discovery extension point
export {
  DiscoveryService,
  EventHandlerDiscoverer,
  HANDLER_KIND_EVENT,
  HANDLER_KIND_REQUEST,
  MessageHandlerDiscoverer,
} from './discovery';
export type {
  DiscoveredHandler,
  HandlerDiscoverer,
  HandlerKind,
  RegisteredHandler,
} from './discovery';

// Interfaces (type-only)
export type {
  IncomingEvent,
  IncomingRequest,
  IncomingResponse,
  MessageHandler,
  OutgoingEvent,
  OutgoingRequest,
  PacketId,
  ReadPacket,
  TransportClient,
  TransportServer,
  TransportStatus,
  WritePacket,
} from './interfaces';

// Context
export {ExecutionContext} from './context';
export type {
  ContextType,
  ControllerClass,
  EventContext,
  HandlerFunction,
  HttpContext,
  RpcContext,
} from './context';

// Decorators
export {
  EVENT_HANDLER_METADATA,
  MESSAGE_HANDLER_METADATA,
  eventHandler,
  messageHandler,
  payload,
  transportCtx,
} from './decorators';
export type {
  EventHandlerMetadata,
  HandlerOptions,
  MessageHandlerMetadata,
} from './decorators';

// Utils
export {normalizePattern} from './utils';

// Client
export {ClientProxy} from './client';

// Server
export {ServerBase} from './server';
export type {HandlerResult} from './server';

// Serializers
export {
  CloudEventsDeserializer,
  CloudEventsSerializer,
  JsonDeserializer,
  JsonSerializer,
} from './serializers';
export type {
  CloudEventsSerializerOptions,
  Deserializer,
  Serializer,
  TransportPacket,
} from './serializers';
