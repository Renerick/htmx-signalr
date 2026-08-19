import type { HtmxConfig } from 'htmx.org';
import type { HtmxInternalApi, HtmxExtension } from './htmx-internal-api';
import { HubConnection } from '@microsoft/signalr';
import { HtmxSignalRConfig } from './htmx-config';

declare const htmx: import('htmx.org').Htmx;
declare const signalR: typeof import('@microsoft/signalr');

declare interface IConnectController {
    start(): Promise<void>;
    stop(reason: string): void;
};

declare module './htmx-internal-api' {
    interface HtmxElementData {
        signalr?: {
            connect?: IConnectController
            // @ts-ignore
            subscribe?: SubscribeController
        }
    }
}

(() => {

    const ATTR = {
        build(name: string) {
            let attribute = 'hx-signalr' + (htmx.config.metaCharacter || ':') + name
            return attribute;
        },
        get CONNECT() { return this.build('connect') },
        get SUBSCRIBE() { return this.build('subscribe') },
        get SEND() { return this.build('send') },
    }

    const SELECTOR = {
        build(name: string) {
            let selector = `[${CSS.escape('hx-signalr' + (htmx.config.metaCharacter || ':') + name)}]`
            if (htmx.config.prefix) {
                selector += `,[${CSS.escape(htmx.config.prefix + 'signalr' + (htmx.config.metaCharacter || ':') + name)}]`
            }
            return selector
        },

        get CONNECT() { return this.build('connect'); },
        get SUBSCRIBE() { return this.build('subscribe'); },
        get SEND() { return this.build('send'); },
        get ALL() { return [this.CONNECT, this.SUBSCRIBE, this.SEND].join(',') }
    }

    function getConfig(elt: Element): HtmxSignalRConfig {
        const defaultConfig = {
            logging: false,
            automaticReconnect: true,
            maxOutgoingMessagesQueueSize: 100
        } satisfies HtmxSignalRConfig;
        const globalConfig = htmx.config.signalr || {};
        const elementConfig = api.HCON.parse<HtmxConfig>(api.attributeValue(elt, 'hx-config')).signalr || {};

        return {
            ...defaultConfig,
            ...globalConfig,
            ...elementConfig
        }
    }

    class ConnectController implements IConnectController {
        private ownerElement: Element;
        private hubConnection: HubConnection | null;
        private config: HtmxSignalRConfig;
        private url: string;
        private stopReason: string | null;

        constructor(ownerElement: Element) {
            this.ownerElement = ownerElement;
            this.config = getConfig(ownerElement);
            this.url = this.getHubUrl();
            this.hubConnection = null;
            this.stopReason = null;
        }

        start() {
            let connectionEvent = {
                url: this.url,
                hub: null as HubConnection | null,
                config: this.config,
                cancelled: false
            }

            if (!api.triggerHtmxEvent(this.ownerElement, 'htmx:signalr:before:connection', { connection: connectionEvent })
                || connectionEvent.cancelled) {

                api.triggerHtmxEvent(this.ownerElement, 'htmx:signalr:close', {
                    connection: connectionEvent,
                    reason: 'cancelled'
                })
                return Promise.resolve();
            }

            this.url = connectionEvent.url;
            this.config = connectionEvent.config;

            this.hubConnection = this.createHub();
            this.connectHubEvents();

            connectionEvent.hub = this.hubConnection;

            return this.hubConnection.start().then(() => {
                api.triggerHtmxEvent(this.ownerElement, 'htmx:signalr:after:connection', { connection: connectionEvent })
            });
        }

        stop(reason: string) {
            this.stopReason = reason;
            return this.hubConnection?.stop();
        }

        private connectHubEvents() {
            if (!this.hubConnection) {
                throw new Error("Hub connection is not created");
            }
            this.hubConnection.onclose(e => {
                let connectionEvent = {
                    url: this.url,
                    hub: this.hubConnection,
                    config: this.config,
                    cancelled: false
                }
                api.triggerHtmxEvent(this.ownerElement, 'htmx:signalr:close', {
                    connection: connectionEvent,
                    error: e,
                    reason: this.stopReason ?? 'closed'
                })
            });
            this.hubConnection.onreconnecting(e => {
                let connectionEvent = {
                    url: this.url,
                    hub: this.hubConnection,
                    config: this.config,
                }
                api.triggerHtmxEvent(this.ownerElement, 'htmx:signalr:reconnecting', {
                    connection: connectionEvent,
                    error: e
                })
            });
            this.hubConnection.onreconnected(connectionId => {
                let connectionEvent = {
                    url: this.url,
                    hub: this.hubConnection,
                    config: this.config,
                }
                api.triggerHtmxEvent(this.ownerElement, 'htmx:signalr:reconnected', {
                    connection: connectionEvent,
                    connectionId: connectionId
                })
            });
        }

        private getHubUrl() {
            let url = api.attributeValue(this.ownerElement, ATTR.CONNECT);
            if (!url) {
                throw new Error('Element has no hx-signalr:connect attribute value');
            }

            return url;
        }

        private createHub() {
            if (this.config.createHubConnection) {
                return this.config.createHubConnection(this.url, this.ownerElement, this.config);
            }

            let hubBuilder = new signalR.HubConnectionBuilder();

            if (this.config.urlOptions) {
                hubBuilder.withUrl(this.url, this.config.urlOptions);
            } else {
                hubBuilder.withUrl(this.url);
            }

            if (this.config.logging) {
                hubBuilder.configureLogging(this.config.logging);
            }

            if (this.config.automaticReconnect === true) {
                hubBuilder.withAutomaticReconnect();
            } else if (Array.isArray(this.config.automaticReconnect)) {
                hubBuilder.withAutomaticReconnect(this.config.automaticReconnect);
            } else if (this.config.automaticReconnect) {
                hubBuilder.withAutomaticReconnect(this.config.automaticReconnect);
            }

            if (this.config.keepAliveInterval) {
                hubBuilder.withKeepAliveInterval(this.config.keepAliveInterval)
            }

            if (this.config.serverTimeout) {
                hubBuilder.withServerTimeout(this.config.serverTimeout)
            }

            if (this.config.statefulReconnect) {
                hubBuilder.withStatefulReconnect(this.config.statefulReconnect);
            }

            return hubBuilder.build();
        }

        static attachIfNeeded(elt: Element): IConnectController | undefined {
            if (elt._htmx?.signalr?.connect) {
                return elt._htmx.signalr.connect;
            }

            if (!api.attributeValue(elt, ATTR.CONNECT)) {
                return undefined;
            }

            let controller = new ConnectController(elt);

            let prop = api.htmxProp(elt);
            prop.signalr ??= {};
            prop.signalr.connect = controller;

            let trigger = api.attributeValue(elt, 'hx-trigger') ?? 'load';

            api.onTrigger(elt, trigger, (e) => {
                // @ts-ignore
                if (!window.signalR) {
                    let error = new Error("SignalR object not found. Include SignalR script in the page scripts before this extenion.");
                    api.triggerHtmxEvent(elt, "htmx:signalr:error", { error })
                    return;
                }
                if (!controller.hubConnection) {
                    controller.start();
                }
            })

            return controller;
        }

        static cleanUpIfNeeded(elt: Element) {
            if (!elt._htmx?.signalr?.connect) {
                return;
            }

            let controller = elt._htmx.signalr.connect;
            controller.stop('removed');
            delete elt._htmx.signalr.connect;
        }
    };


    let api: HtmxInternalApi;

    function processElement(elt: Element): void {
        if (elt.matches(SELECTOR.CONNECT)) {
            ConnectController.attachIfNeeded(elt);
        }
        if (elt.matches(SELECTOR.SEND) && api.attributeValue(elt, ATTR.SEND)) {
            // console.log('process', elt, 'as send')
        }
        if (elt.matches(SELECTOR.SUBSCRIBE) && api.attributeValue(elt, ATTR.SUBSCRIBE)) {
            // console.log('process', elt, 'as subscribe')
        }
    }

    htmx.registerExtension('hx-signalr', {
        init: (internalApi) => {

            api = internalApi;
            htmx.config.signalr ??= {};
        },

        htmx_after_process: (elt) => {
            processElement(elt);
            let elementsToProcess = elt.querySelectorAll(SELECTOR.ALL);
            elementsToProcess.forEach(processElement);
        },

        htmx_before_cleanup: (elt) => {
            ConnectController.cleanUpIfNeeded(elt);
        }
    } satisfies HtmxExtension)
})();