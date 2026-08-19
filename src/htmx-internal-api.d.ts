import type { HtmxEventMap, HtmxRequestCtx } from 'htmx.org';

export type HtmxHconObject = Record<string, unknown>;

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
