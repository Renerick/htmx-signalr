import type {
    HubConnection,
    IHttpConnectionOptions,
    ILogger,
    IRetryPolicy,
    LogLevel,
} from '@microsoft/signalr';

export interface HtmxSignalRConfig {
    logging?: LogLevel | string | ILogger | false;
    urlOptions?: IHttpConnectionOptions;
    automaticReconnect?: boolean | number[] | IRetryPolicy;
    maxOutgoingMessagesQueueSize?: number;
    createHubConnection?: (
        url: string,
        element: Element,
        config: HtmxSignalRConfig,
    ) => HubConnection;
}

declare module 'htmx.org' {
    interface HtmxConfig {
        signalr?: HtmxSignalRConfig;
    }
}
