/*
SignalR Extension
============================
This extension adds support for SignalR to htmx.
Based on WebSockets extension (https://github.com/bigskysoftware/htmx/blob/master/src/ext/ws.js) by bigskysoftware.
*/

(function () {

	/** @type {import("../htmx").HtmxInternalApi} */
	var api;

	htmx.defineExtension("signalr", {

		/**
		 * init is called once, when this extension is first registered.
		 * @param {import("../htmx").HtmxInternalApi} apiRef
		 */
		init: function (apiRef) {

			// Store reference to internal API
			api = apiRef;

			// Default function for creating new EventSource objects
			if (htmx.createHubConnection == undefined) {
				htmx.createHubConnection = createHubConnection;
			}
		},

		/**
		 * onEvent handles all events passed to this extension.
		 *
		 * @param {string} name
		 * @param {Event} evt
		 */
		onEvent: function (name, evt) {

			switch (name) {

				// Try to remove hub connection when elements are removed
				case "htmx:beforeCleanupElement":

					var internalData = api.getInternalData(evt.target)

					if (internalData.HubConnection != undefined) {
						internalData.HubConnection.stop();
					}
					return;

				// Try to create hub connections when elements are processed
				case "htmx:afterProcessNode":
					var parent = evt.target;

					forEach(queryAttributeOnThisOrChildren(parent, "signalr-hub"), function (child) {
						ensureHubConnection(child)
					});
					forEach(queryAttributeOnThisOrChildren(parent, "signalr-method"), function (child) {
						ensureMethodHandler(child)
					});
					forEach(queryAttributeOnThisOrChildren(parent, "signalr-send"), function (child) {
						ensureMethodHandler(child)
					});
			}
		}
	});

	function splitOnWhitespace(trigger) {
		return trigger.trim().split(/\s+/);
	}

	/**
	 * ensureHubConnection creates a new SignalR Hub Connection on the designated element, using
	 * the element's "signalr-connect" attribute.
	 * @param {HTMLElement} elt
	 * @returns
	 */
	function ensureHubConnection(elt) {

		// If the element containing the connection no longer exists, then
		// do not connect/reconnect the Hub.
		if (!api.bodyContains(elt)) {
			return;
		}
		if (!signalR) {
			logError('SignalR object not found. Make sure to include SignalR script in the page scripts before this extension.');
			return;
		}

		// Get the source straight from the element's value
		var signalrHubUrl = api.getAttributeValue(elt, "signalr-hub")

		// Create a new HubConnection and event handlers
		/** @type {HubConnection} */
		var hubConnection = htmx.createHubConnection(signalrHubUrl);

		// Re-connect any signalr-send commands as well.
		forEach(queryAttributeOnThisOrChildren(elt, "signalr-send"), function (child) {
			processHubConnectionSend(elt, child);
		});

		hubConnection.start();

		// Put the HubConnection into the HTML Element's custom data.
		api.getInternalData(elt).HubConnection = hubConnection;
	}

	/**
	 * ensureSending attaches event listeners to elements with "signalr-send" attribute.
	 * @param {HTMLElement} elt
	 * @returns
	 */
	function ensureSending(elt) {

		// If the element containing the connection no longer exists, then
		// do not connect/reconnect the Hub.
		if (!api.bodyContains(elt)) {
			return;
		}
		if (!signalR) {
			logError('SignalR object not found. Make sure to include SignalR script in the page scripts before this extension.');
			return;
		}

		var hubElement = findParentWithHubConnection(elt);

		if (!hubElement) {
			return;
		}

		var hubConnection = api.getInternalData(hubElement).HubConnection;
		processHubConnectionSend(elt, child);
	}

	/**
	 * ensureMethodHandler creates a listener that handles invocations of a method defined on the element
	 * by "signalr-method" attribute.
	 * @param {HTMLElement} elt
	 * @returns
	 */
	function ensureMethodHandler(elt) {

		// If the element containing the connection no longer exists, then
		// do not subscribe
		if (!api.bodyContains(elt)) {
			return;
		}
		if (!signalR) {
			logError('SignalR object not found. Make sure to include SignalR script in the page scripts before this extension.');
			return;
		}

		var hubElement = findParentWithHubConnection(elt);

		if (!hubElement) {
			return;
		}

		var hubConnection = api.getInternalData(hubElement).HubConnection;

		var signalrMethod = api.getAttributeValue(elt, "signalr-method");
		hubConnection.on(signalrMethod, function handler(response) {
			if (maybeCloseHubConnectionSource(hubElement)) {
				return;
			}

			if (maybeStopListeningForMethod(hubElement, elt, handler)) {
				return;
			}

			api.withExtensions(elt, function (extension) {
				response = extension.transformResponse(response, null, elt);
			});

			var settleInfo = api.makeSettleInfo(elt);
			var fragment = api.makeFragment(response);

			if (fragment.children.length) {
				for (var i = 0; i < fragment.children.length; i++) {
					api.oobSwap(api.getAttributeValue(fragment.children[i], "hx-swap-oob") || "true", fragment.children[i], settleInfo);
				}
			}

			api.settleImmediately(settleInfo.tasks);
		});
	}

	/**
	 * processHubConnectionSend adds event listeners to the <form> element so that
	 * messages can be sent to the HubConnection server when the form is submitted.
	 * @param {HTMLElement} parent
	 * @param {HTMLElement} child
	 */
	function processHubConnectionSend(parent, child) {
		child.addEventListener(api.getTriggerSpecs(child)[0].trigger, function (evt) {
			var HubConnection = api.getInternalData(parent).HubConnection;
			var method = api.getAttributeValue(child, "signalr-send");
			var headers = api.getHeaders(child, parent);
			var results = api.getInputValues(child, 'post');
			var errors = results.errors;
			var rawParameters = results.values;
			var expressionVars = api.getExpressionVars(child);
			var allParameters = api.mergeObjects(rawParameters, expressionVars);
			var filteredParameters = api.filterValues(allParameters, child);
			filteredParameters['HEADERS'] = headers;
			if (errors && errors.length > 0) {
				api.triggerEvent(child, 'htmx:validation:halted', errors);
				return;
			}
			HubConnection.send(method, filteredParameters);
			if (api.shouldCancel(evt, child)) {
				evt.preventDefault();
			}
		});
	}

	/**
	 * maybeCloseHubConnectionSource checks to the if the element that created the HubConnection
	 * still exists in the DOM.  If NOT, then the HubConnection is closed and this function
	 * returns TRUE.  If the element DOES EXIST, then no action is taken, and this function
	 * returns FALSE.
	 *
	 * @param {*} elt
	 * @returns
	 */
	function maybeCloseHubConnectionSource(elt) {
		if (!api.bodyContains(elt)) {
			api.getInternalData(elt).HubConnection.stop();
			return true;
		}
		return false;
	}

	/**
	 * maybeStopListeningForMethod checks to the if the element that created the subscription to method
	 * still exists in the DOM.  If NOT, then the HubConnection is closed and this function
	 * returns TRUE.  If the element DOES EXIST, then no action is taken, and this function
	 * returns FALSE.
	 *
	 * @param {*} elt
	 * @returns
	 */
	function maybeStopListeningForMethod(hubElement, elt, handler) {
		if (!api.bodyContains(elt)) {
			api.getInternalData(hubElement).HubConnection.off(api.getAttributeValue(elt, "signalr-method"), handler);
			return true;
		}
		return false;
	}

	/**
	 * createHubConnection is the default method for creating new HubConnection objects.
	 * it is hoisted into htmx.createHubConnection to be overridden by the user, if needed.
	 *
	 * @param {string} url
	 * @returns HubConnection
	 */
	function createHubConnection(url) {
		return new signalR.HubConnectionBuilder()
			.withUrl(url)
			.withAutomaticReconnect()
			.build()
	}

	/**
	 * queryAttributeOnThisOrChildren returns all nodes that contain the requested attributeName, INCLUDING THE PROVIDED ROOT ELEMENT.
	 *
	 * @param {HTMLElement} elt
	 * @param {string} attributeName
	 */
	function queryAttributeOnThisOrChildren(elt, attributeName) {

		var result = []

		// If the parent element also contains the requested attribute, then add it to the results too.
		if (api.hasAttribute(elt, attributeName)) {
			result.push(elt);
		}

		// Search all child nodes that match the requested attribute
		elt.querySelectorAll("[" + attributeName + "], [data-" + attributeName + "]").forEach(function (node) {
			result.push(node)
		})

		return result
	}

	/**
	 * findParentWithHubConnection returns all nodes that contain the requested attributeName, INCLUDING THE PROVIDED ROOT ELEMENT.
	 *
	 * @param {HTMLElement} elt
	 */
	function findParentWithHubConnection(elt) {

		while (!api.getAttributeValue(elt, "signalr-hub") && elt) {
			elt = elt.parentNode;
		}

		return elt;
	}

	/**
	 * @template T
	 * @param {T[]} arr
	 * @param {(T) => void} func
	 */
	function forEach(arr, func) {
		if (arr) {
			for (var i = 0; i < arr.length; i++) {
				func(arr[i]);
			}
		}
	}

})();