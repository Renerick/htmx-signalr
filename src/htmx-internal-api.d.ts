import type { HtmxEventMap, HtmxRequestCtx } from 'htmx.org';

export type HtmxHconObject = {};

export interface HtmxHcon {
    parse<T extends HtmxHconObject = HtmxHconObject>(source: string): T;
    split(source: string): string[];
    merge<T extends object>(source: string | object, target: T): T;
}

export interface HtmxTriggerSpec extends Record<string, unknown> {
    name: string;
}

export interface HtmxListener {
    fromElt: EventTarget;
    eventName: string;
    handler: EventListener;
    capture: boolean;
    passive: boolean;
}

export interface HtmxElementData extends Record<string, unknown> {
    listeners: HtmxListener[];
    triggerSpecs: HtmxTriggerSpec[];
    initialized?: boolean;
    eventHandler?: EventListener;
}

export interface HtmxSwapSpec extends Record<string, unknown> {
    style?: string;
    swap?: string | number;
    settle?: string | number;
    target?: string | Element;
    transition?: boolean;
    strip?: boolean;
}

export interface HtmxSwapTask {
    fragment: DocumentFragment;
    target: string | Element | null;
    swapSpec: string | HtmxSwapSpec;
    sourceElement?: Element;
    transition?: boolean;
}

export interface HtmxTrustedTypesPolicy {
    createHTML(source: string): unknown;
    createScript(source: string): unknown;
}

export type HtmxFunctionConstructor = new (...parameters: string[]) => Function;

/**
 * The private API passed to an extension's `init` hook by htmx 4.
 *
 * This is not part of htmx's published TypeScript declarations. Keep this
 * interface synchronized with `Htmx.#internalAPI` in the installed htmx source.
 */
export interface HtmxInternalApi {
    HCON: HtmxHcon;

    attributeValue<T = undefined>(
        element: Element,
        name: string,
        defaultValue?: T,
        elementCollector?: (value: string, source: Element) => unknown,
    ): string | T;

    parseTriggerSpecs(specification: string): HtmxTriggerSpec[];

    determineMethodAndAction(
        element: Element,
        event: Event,
    ): { action: string | undefined; method: string };

    createRequestContext(element: Element, event: Event): HtmxRequestCtx;

    collectFormData(
        element: Element,
        form?: HTMLFormElement | null,
        submitter?: HTMLElement | null,
        validate?: boolean,
        isGet?: boolean,
    ): FormData | undefined;

    getAttributeObject<T extends object = HtmxHconObject>(
        element: Element,
        name: string,
        callback: (value: T) => void,
        scope?: Record<string, unknown>,
    ): null | void | Promise<void>;

    insertContent(task: HtmxSwapTask, cssTransition?: boolean): Promise<void>;
    morph(oldNode: Node, fragment: DocumentFragment, innerHTML: boolean): void;
    isSoftMatch(oldNode: Node, newNode: Node): boolean;

    initSecurity(
        trustedTypesPolicy?: HtmxTrustedTypesPolicy | null,
        synchronousFunction?: HtmxFunctionConstructor | null,
        asynchronousFunction?: HtmxFunctionConstructor | null,
    ): void;

    onTrigger(
        element: Element,
        specification: string,
        handler: (event: Event) => void | Promise<void>,
    ): void;

    htmxProp(element: Element): HtmxElementData;
    htmxProp<T extends object>(element: Element): HtmxElementData & T;

    triggerHtmxEvent<K extends keyof HtmxEventMap>(
        element: Element,
        name: K,
        detail: HtmxEventMap[K],
        bubbles?: boolean,
    ): boolean;

    triggerHtmxEvent(
        element: Element,
        name: string,
        detail?: unknown,
        bubbles?: boolean,
    ): boolean;

    executeJavaScript<T = unknown>(
        thisArg: Element,
        values: Record<string, unknown>,
        code: string,
        expression?: boolean,
        isAsync?: boolean,
        compile?: boolean,
    ): T | Promise<T> | (() => T | Promise<T>);
}

export interface HtmxExtension {
    init(internalApi: HtmxInternalApi): void;

    htmx_before_init?(elt: Element, detail: HtmxEventMap['htmx:before:init']): void;
    htmx_after_init?(elt: Element, detail: HtmxEventMap['htmx:after:init']): void;
    htmx_before_process?(elt: Element, detail: HtmxEventMap['htmx:before:process']): void;
    htmx_after_process?(elt: Element, detail: HtmxEventMap['htmx:after:process']): void;
    htmx_before_cleanup?(elt: Element, detail: HtmxEventMap['htmx:before:cleanup']): void;
    htmx_after_cleanup?(elt: Element, detail: HtmxEventMap['htmx:after:cleanup']): void;

    htmx_config_request?(elt: Element, detail: HtmxEventMap['htmx:config:request']): void;
    htmx_before_request?(elt: Element, detail: HtmxEventMap['htmx:before:request']): void;
    htmx_before_response?(elt: Element, detail: HtmxEventMap['htmx:before:response']): void;
    htmx_after_request?(elt: Element, detail: HtmxEventMap['htmx:after:request']): void;
    htmx_finally_request?(elt: Element, detail: HtmxEventMap['htmx:finally:request']): void;

    htmx_error?(elt: Element, detail: HtmxEventMap['htmx:error']): void;

    htmx_before_swap?(elt: Element, detail: HtmxEventMap['htmx:before:swap']): void;
    htmx_after_swap?(elt: Element, detail: HtmxEventMap['htmx:after:swap']): void;
    htmx_finally_swap?(elt: Element, detail: HtmxEventMap['htmx:finally:swap']): void;
    htmx_before_settle?(elt: Element, detail: HtmxEventMap['htmx:before:settle']): void;
    htmx_after_settle?(elt: Element, detail: HtmxEventMap['htmx:after:settle']): void;

    handle_swap?(swapStyle: string, target: Element, fragment: Element, swapSpec: HtmxSwapSpec): void;

    htmx_before_history_update?(elt: Element, detail: HtmxEventMap['htmx:before:history:update']): void;
    htmx_after_history_update?(elt: Element, detail: HtmxEventMap['htmx:after:history:update']): void;
    htmx_after_history_push?(elt: Element, detail: HtmxEventMap['htmx:after:history:push']): void;
    htmx_after_history_replace?(elt: Element, detail: HtmxEventMap['htmx:after:history:replace']): void;
    htmx_before_history_restore?(elt: Element, detail: HtmxEventMap['htmx:before:history:restore']): void;
}

declare module 'htmx.org' {
    export interface Htmx {
        registerExtension(name: string, ext: HtmxExtension): void;
    }
}

declare global {
    interface Element {
        _htmx?: HtmxElementData
    }
}