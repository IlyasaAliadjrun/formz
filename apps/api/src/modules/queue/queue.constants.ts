/** Token DI untuk instance Queue BullMQ. */
export const SHEET_SYNC_QUEUE = Symbol('SHEET_SYNC_QUEUE');
export const EMAIL_NOTIFICATION_QUEUE = Symbol('EMAIL_NOTIFICATION_QUEUE');

/** Token DI untuk QueueEvents, dipakai menunggu hasil job uji coba. */
export const SHEET_SYNC_QUEUE_EVENTS = Symbol('SHEET_SYNC_QUEUE_EVENTS');
export const EMAIL_NOTIFICATION_QUEUE_EVENTS = Symbol('EMAIL_NOTIFICATION_QUEUE_EVENTS');
