import {inject} from '@loopback/core';
import {TransportBindings} from '../keys';

/**
 * Parameter decorator that injects the message payload.
 *
 * @example
 * ```typescript
 * @eventHandler('order.placed')
 * async handle(@payload() data: OrderDto): Promise<void> { ... }
 * ```
 */
export function payload() {
  return inject(TransportBindings.CURRENT_PAYLOAD);
}

/**
 * Parameter decorator that injects the transport-specific context.
 *
 * The context type depends on the transport:
 * - Kafka: KafkaContext (topic, partition, offset, consumer)
 * - RabbitMQ: RmqContext (channel, message, pattern)
 * - gRPC: GrpcContext (metadata, call)
 * - MQTT: MqttContext (topic, packet)
 * - NATS: NatsContext (subject, headers)
 *
 * @example
 * ```typescript
 * @eventHandler('order.placed')
 * async handle(
 *   @payload() data: OrderDto,
 *   @transportCtx() ctx: KafkaContext,
 * ): Promise<void> { ... }
 * ```
 */
export function transportCtx() {
  return inject(TransportBindings.CURRENT_CONTEXT);
}
