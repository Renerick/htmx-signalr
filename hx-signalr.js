/*
SignalR Extension
============================
This extension adds support for SignalR to htmx.
Based on WebSockets extension (https://github.com/bigskysoftware/htmx/blob/master/src/ext/ws.js)
and SSE extension (https://github.com/bigskysoftware/htmx/blob/master/src/ext/sse.js)
by bigskysoftware.
*/

(function () {

	/** @type {import("../htmx").HtmxInternalApi} */
	var api;

	var signalRConnect = "signalr-connect";
	var signalRSubscribe = "signalr-subscribe";
	var signalRSend = "signalr-send";

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

					forEach(queryAttributeOnThisOrChildren(parent, signalRConnect), function (child) {
						ensureHubConnection(child)
					});
					forEach(queryAttributeOnThisOrChildren(parent, signalRSubscribe), function (child) {
						ensureSubscription(child)
					});
					forEach(queryAttributeOnThisOrChildren(parent, signalRSend), function (child) {
						ensureSending(child)
					});
			}
		}
	});

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
		var signalrHubUrl = api.getAttributeValue(elt, signalRConnect)

		// Create a new HubConnection and event handlers
		/** @type {HubConnection} */
		var hubConnection = htmx.createHubConnection(signalrHubUrl);

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

		processHubConnectionSend(hubElement, elt);
	}

	/**
	 * ensureMethodHandler creates a listener that handles invocations of a method defined on the element
	 * by "signalr-method" attribute.
	 * @param {HTMLElement} elt
	 * @returns
	 */
	function ensureSubscription(elt) {

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

		var signalrSubscribeAttribute = api.getAttributeValue(elt, signalRSubscribe);
		var signalrMethodNames = signalrSubscribeAttribute.split(",");

		for (let i = 0; i < signalrMethodNames.length; i++) {
			var method = signalrMethodNames[i].trim();

			hubConnection.on(method, function handler(message) {
				if (maybeCloseHubConnectionSource(hubElement)) {
					hubConnection.off(method, handler)
					return;
				}

				if (maybeUnsubscribe(hubElement, method, elt, handler)) {
					return;
				}

				var target = api.getTarget(elt);
				var settleInfo = api.makeSettleInfo(elt);

				var messageSpec = {
					message: message,
					method: method,
					target: target,
				};
				if (!api.triggerEvent(elt, 'htmx:signalr:message', messageSpec)) {
					return;
				}

				// Other parts of htmx expect to have response object as a string
				// So, we serialize it
				if (typeof (messageSpec.message) === "object") {
					messageSpec.message = JSON.stringify(messageSpec.message);
				}

				api.withExtensions(elt, function (extension) {
					messageSpec.message = extension.transformResponse(messageSpec.message, null, elt);
				});

				var swapSpec = api.getSwapSpecification(elt);
				api.selectAndSwap(swapSpec.swapStyle, messageSpec.target, elt, messageSpec.message, settleInfo);
				settleInfo.elts.forEach(function (elt) {
					if (elt.classList) {
						elt.classList.add(htmx.config.settlingClass);
					}
					api.triggerEvent(elt, 'htmx:beforeSettle');
				});

				// Handle settle tasks (with delay if requested)
				if (swapSpec.settleDelay > 0) {
					setTimeout(doSettle(settleInfo), swapSpec.settleDelay);
				} else {
					doSettle(settleInfo)();
				}
			});
		}
	}

	/**
	 * processHubConnectionSend adds event listeners to the <form> element so that
	 * messages can be sent to the HubConnection server when the form is submitted.
	 * @param {HTMLElement} hubElt
	 * @param {HTMLElement} sendElt
	 */
	function processHubConnectionSend(hubElt, sendElt) {
		var nodeData = api.getInternalData(sendElt);
		var triggerSpecs = api.getTriggerSpecs(sendElt);
		triggerSpecs.forEach(function (ts) {
			api.addTriggerHandler(sendElt, ts, nodeData, function (elt, evt) {
				var HubConnection = api.getInternalData(hubElt).HubConnection;
				var method = api.getAttributeValue(sendElt, signalRSend);
				var headers = api.getHeaders(sendElt, hubElt);
				var results = api.getInputValues(sendElt, 'post');
				var errors = results.errors;
				var rawParameters = results.values;
				var expressionVars = api.getExpressionVars(sendElt);
				var allParameters = api.mergeObjects(rawParameters, expressionVars);
				var filteredParameters = api.filterValues(allParameters, sendElt);
				filteredParameters['HEADERS'] = headers;
				if (errors && errors.length > 0) {
					api.triggerEvent(sendElt, 'htmx:validation:halted', errors);
					return;
				}

				if (!api.triggerEvent(sendElt, 'htmx:signalr:beforeSend', { method: method, headers: headers, allParameters: allParameters, filteredParameters: filteredParameters })) {
					return;
				};

				HubConnection.send(method, filteredParameters);
				if (api.shouldCancel(evt, sendElt)) {
					evt.preventDefault();
				}

				api.triggerEvent(sendElt, 'htmx:signalr:afterSend', { method: method, message: filteredParameters });

			});
		})
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
	 * maybeUnsubscribe checks if the element that created the subscription to method
	 * still has matching subscription attribute. If NOT, then the subscription is removed and this function
	 * returns TRUE.  If the element DOES EXIST, then no action is taken, and this function
	 * returns FALSE.
	 *
	 * @param {*} elt
	 * @returns
	 */
	function maybeUnsubscribe(hubElement, subscription, elt, handler) {
		if (!api.bodyContains(elt)) {
			api.getInternalData(hubElement).HubConnection.off(subscription, handler);
			return true;
		}
		if (api.getAttributeValue(elt, signalRSubscribe).split(",").indexOf(subscription) == -1) {
			api.getInternalData(hubElement).HubConnection.off(subscription, handler);
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
		var match = api.getClosestMatch(elt, hasHubConnection);
		return match;
	}

	function hasHubConnection(node) {
		var internalData = api.getInternalData(node);
		return internalData.HubConnection != null;
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

	/**
	 * doSettle mirrors much of the functionality in htmx that
	 * settles elements after their content has been swapped.
	 * TODO: this should be published by htmx, and not duplicated here
	 * @param {import("../htmx").HtmxSettleInfo} settleInfo
	 * @returns () => void
	 */
	function doSettle(settleInfo) {

		return function () {
			settleInfo.tasks.forEach(function (task) {
				task.call();
			});

			settleInfo.elts.forEach(function (elt) {
				if (elt.classList) {
					elt.classList.remove(htmx.config.settlingClass);
				}
				api.triggerEvent(elt, 'htmx:afterSettle');
			});
		}
	}

})();
