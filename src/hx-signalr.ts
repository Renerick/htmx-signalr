import type { HtmxConfig } from 'htmx.org';
import type { HtmxInternalApi, HtmxExtension } from './htmx-internal-api';
import { HubConnection } from '@microsoft/signalr';
import { HtmxSignalRConfig } from './htmx-config';

declare const htmx: import('htmx.org').Htmx;
declare const signalR: typeof import('@microsoft/signalr');

type ConnectionDetails = {
    hub: HubConnection | null,
    url: string,
    config: HtmxSignalRConfig
}

declare interface IConnectController {
    outboxIsFull(): boolean;
    serialized(work: (ConnectController: any) => Promise<void>): Promise<void>;
    buildConnectionDetails(): ConnectionDetails;
    send(method: string, message: Record<string, unknown>, callback: () => {}): Promise<void>;
    start(): Promise<void>;
    stop(reason: string): void;
};

declare module './htmx-internal-api' {
    interface HtmxElementData {
        signalr?: {
            connect?: IConnectController
            // @ts-ignore
            subscribe?: SubscribeController

            sendInitialized?: boolean
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
        const globalConfig = htmx.config.signalr!;
        const elementConfig = api.HCON.parse<HtmxConfig>(api.attributeValue(elt, 'hx-config')).signalr || {};

        return {
            ...defaultConfig,
            ...globalConfig,
            ...elementConfig
        }
    }

    type SendItem = {
        callback: () => void,
        method: string,
        data: unknown
    }

    class ConnectController implements IConnectController {
        private ownerElement: Element;
        private hubConnection: HubConnection | null;
        private config: HtmxSignalRConfig;
        private url: string;
        private stopReason: string | null;

        private queue: Promise<void>;

        private sendOutbox: SendItem[];

        constructor(ownerElement: Element) {
            this.ownerElement = ownerElement;
            this.config = getConfig(ownerElement);
            this.url = this.getHubUrl();
            this.hubConnection = null;
            this.stopReason = null;

            this.queue = Promise.resolve();
            this.sendOutbox = [];
        }

        serialized(work: (ConnectController: any) => Promise<void>) {
            this.queue = this.queue.then(() => work(this)).catch(() => { });
            return this.queue;
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
                this.flushSendQueue();
            });
        }

        stop(reason: string) {
            this.stopReason = reason;
            return this.hubConnection?.stop();
        }

        private isReady() {
            return this.hubConnection
                && this.hubConnection.state === signalR.HubConnectionState.Connected;
        }

        public outboxIsFull(): boolean {
            return this.sendOutbox.length >= this.config.maxOutgoingMessagesQueueSize
        }

        private sendEnqueue(item: SendItem) {
            if (this.outboxIsFull()) {
                throw new Error('Outgoing message queue is full');
            }

            this.sendOutbox.push(item);
        }

        async send(method: string, data: Record<string, unknown>, callback: () => void): Promise<void> {
            if (this.isReady() && this.sendOutbox.length === 0) {
                await this.hubConnection!.send(method, data);
                callback();
            } else {
                this.sendEnqueue({ method, data, callback })
            }
        }

        async flushSendQueue() {
            while (this.sendOutbox.length) {
                if (!this.isReady()) {
                    break;
                }

                let { method, data, callback } = this.sendOutbox[0];
                await this.hubConnection?.send(method, data);
                callback();
                this.sendOutbox.shift();
            }
        }

        buildConnectionDetails() {
            let connectionDetails = {
                url: this.url,
                hub: this.hubConnection,
                config: this.config,
            };

            return connectionDetails;
        }

        private connectHubEvents() {
            if (!this.hubConnection) {
                throw new Error("Hub connection is not created");
            }
            this.hubConnection.onclose(e => {
                let connectionDetails = this.buildConnectionDetails();
                api.triggerHtmxEvent(this.ownerElement, 'htmx:signalr:close', {
                    connection: connectionDetails,
                    error: e,
                    reason: this.stopReason ?? 'closed'
                })
                this.sendOutbox.length = 0;
            });
            this.hubConnection.onreconnecting(e => {
                let connectionDetails = this.buildConnectionDetails();
                api.triggerHtmxEvent(this.ownerElement, 'htmx:signalr:reconnecting', {
                    connection: connectionDetails,
                    error: e
                })
            });
            this.hubConnection.onreconnected(async connectionId => {
                let connectionDetails = this.buildConnectionDetails();
                api.triggerHtmxEvent(this.ownerElement, 'htmx:signalr:reconnected', {
                    connection: connectionDetails,
                    connectionId: connectionId
                })
                await this.flushSendQueue();
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

        static findParent(elt: Element | null) {
            while (elt && !elt._htmx?.signalr?.connect) {
                elt = elt.parentElement;
            }

            return elt?._htmx?.signalr?.connect;
        }
    };

    async function sendCollectMessage(elt: Element, event: Event) {
        let method = api.attributeValue(elt, ATTR.SEND);
        let ctx = api.createRequestContext(elt, event);
        let headers = ctx.request.headers;
        delete headers['Accept'];
        let form = (elt as HTMLInputElement).form ?? elt.closest('form');
        let formData = api.collectFormData(elt, form, (event as SubmitEvent).submitter) ?? new FormData();

        let values: Record<string, unknown> = {};
        for (let [key, value] of formData) {
            if (Object.hasOwn(values, key)) {
                const existing = values[key]
                values[key] = Array.isArray(existing)
                    ? [...existing, value]
                    : [existing, value]
            } else {
                values[key] = value;
            }
        }

        await api.getAttributeObject(elt, 'hx-vals', obj => Object.assign(values, obj));

        let message = {
            method,
            headers,
            values,
            data: undefined as Record<string, unknown> | undefined,
        };

        return message;
    }

    function sendAttachIfNeeded(elt: Element) {
        if (elt._htmx?.signalr?.sendInitialized) {
            return;
        }
        let method = api.attributeValue(elt, ATTR.SEND);
        if (!method) {
            return;
        }

        let trigger = api.attributeValue(elt, 'hx-trigger');

        if (!trigger) {
            if (elt.matches('form')) {
                trigger = 'submit'
            } else if (elt.matches('input:not([type=button]):not([type=submit]),select,textarea')) {
                trigger = 'change'
            } else {
                trigger = 'click'
            }
        }

        const sendingHandler = async (event: Event) => {
            if (elt.matches('form') && event.type === 'submit') {
                event.preventDefault();
            }

            let connectController = ConnectController.findParent(elt);
            if (!connectController) {
                let error = new Error('Could not find parent with hx-signalr:connect attribute');
                api.triggerHtmxEvent(elt, "htmx:signalr:error", { error })
                return;
            }


            let messagePromise = sendCollectMessage(elt, event);

            await connectController.serialized(async (controller: ConnectController) => {
                if (connectController.outboxIsFull()) {
                    let error = new Error('Outgoing message queue is full');
                    api.triggerHtmxEvent(elt, "htmx:signalr:error", { error })
                    return;
                }

                let message = await messagePromise;
                if (!message.method) {
                    let error = new Error('Method for message sending is not specified');
                    api.triggerHtmxEvent(elt, "htmx:signalr:error", { error })
                    return;
                }

                let awaitables: Promise<unknown>[] = [];
                let outgoingDetails = {
                    message,
                    connection: controller.buildConnectionDetails(),
                    cancelled: false,
                    waitUntil: (promise: Promise<unknown>) => { awaitables.push(promise); }
                };

                if (!api.triggerHtmxEvent(elt, 'htmx:signalr:before:message:outgoing', outgoingDetails)) {
                    return;
                }

                await Promise.all(awaitables);

                if (outgoingDetails.cancelled) {
                    return;
                }


                message.data ??= { ...message.values, headers: message.headers };

                await controller.send(message.method, message.data, () => {
                    api.triggerHtmxEvent(elt, 'htmx:signalr:after:message:outgoing', {
                        message: outgoingDetails.message,
                        connection: outgoingDetails.connection,
                    })
                });
            })
        }

        api.onTrigger(elt, trigger, sendingHandler);

        let prop = api.htmxProp(elt);
        prop.signalr ??= {};
        prop.signalr.sendInitialized = true;

    }


    let api: HtmxInternalApi;

    function processElement(elt: Element): void {
        if (elt.matches(SELECTOR.CONNECT)) {
            ConnectController.attachIfNeeded(elt);
        }
        if (elt.matches(SELECTOR.SEND)) {
            sendAttachIfNeeded(elt);
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