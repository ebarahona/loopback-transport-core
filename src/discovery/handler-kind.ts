/**
 * Kind of a transport handler. The two well-known values
 * (`'request'` and `'event'`) ship as default constants below; plugin
 * discoverers may use any string value to declare additional kinds
 * (e.g. `'cron'`, `'subscription'`, `'stream'`) without requiring a
 * transport-core release.
 *
 * The open shape uses the `string & {}` autocomplete trick so editors
 * still suggest the well-known values while accepting any string.
 *
 * @public
 */
export type HandlerKind = 'request' | 'event' | (string & {});

/**
 * Well-known kind for request/response handlers (`@messageHandler`).
 * @public
 */
export const HANDLER_KIND_REQUEST = 'request';

/**
 * Well-known kind for fire-and-forget chainable event handlers (`@eventHandler`).
 * @public
 */
export const HANDLER_KIND_EVENT = 'event';
