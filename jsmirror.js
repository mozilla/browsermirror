/************************************************************
 * Channel: connection to the server
 */

function Channel(server, channel, receiver) {
  if (this === window) {
    throw 'You forgot new';
  }
  server = parseUrl(server);
  this.receiver = receiver;
  var transports = ['websocket', 'flashsocket', 'htmlfile', 'xhr-multipart',
                    'xhr-polling', 'jsonp-polling'];
  if (io.Socket.prototype.isXDomain()) {
    // This does not seem to work cross-domain:
    transports.splice(transports.indexOf('flashsocket'), 1);
  }
  if (transports.indexOf('flashsocket') != -1) {
    WebSocket.__initialize();
  }
  this.socket = new io.Socket(server.hostname, {
    rememberTransport: false,
    connectTimeout: 5000,
    reconnect: true,
    reconnectionDelay: 500,
    transports: transports,
    port: server.port
  });
  this.socket.on('connect', this.receiver.reconnect.bind(this.receiver));
  this.socket.on('reconnect', this.receiver.reconnect.bind(this.receiver));
  this.socket.connect();
  this.channel = channel;
  console.log('saying hello');
  this.send({subscribe: channel, hello: true});
  log(DEBUG, 'created socket', this.socket);
  var self = this;
  // FIXME: some sort of queue?
  // FIXME: handle reconnect_failed event
  this.socket.on('message', function (msg) {
    // FIXME: for some reason I'm getting multi-encoding strings?
    while (typeof msg == 'string') {
      msg = JSON.parse(msg);
    }
    self.receiver.message(msg);
  });
  this.shareUrl = server.url + '/view/' + channel;
}

Channel.prototype.send = function (message) {
  message.subscribe = this.channel;
  message = JSON.stringify(message);
  log(INFO, 'sending message', message.substr(0, 70));
  this.socket.send(message);
};

/************************************************************
 * Base: base of Master and Mirror
 */

function Base () {
};

Base.prototype.send = function (msg) {
  /* Sends a message to the server */
  this.channel.send(msg);
};

Base.prototype.sendChat = function (msgs) {
  /* Sends a chat to the server */
  this.send({chatMessages: msgs});
};

Base.prototype.sendHighlight = function (jsmirrorId, offsetTop, offsetLeft) {
  this.send({highlight: {target: jsmirrorId, offsetTop: offsetTop, offsetLeft: offsetLeft}});
};

Base.prototype.getRange = function () {
  var range = window.getSelection();
  if ((! range) || (! range.rangeCount)) {
    return null;
  }
  range = range.getRangeAt(0);
  if (! range) {
    return null;
  }
  if (range.end == range.start && range.startOffset == range.endOffset) {
    // Not a useful range
    return null;
  }
  return {startContainer: range.startContainer,
          endContainer: range.endContainer,
          startOffset: range.startOffset,
          endOffset: range.endOffset};
};

Base.prototype.message = function (msg) {
  /* Called when the server sends a message to us */
  this.processCommand(msg);
};

Base.prototype.showScreen = function (alsoScroll) {
  if ((! this.lastScreen) || this.lastScreen.element) {
    return;
  }
  var top = getElementPosition(this.getElement(this.lastScreen.start)).top
            + this.lastScreen.startOffsetTop;
  var bottom = getElementPosition(this.getElement(this.lastScreen.end)).top
               + this.lastScreen.endOffsetTop;
  this.lastScreen.element = createVisualFrame(top, bottom);
  if (alsoScroll) {
    if (bottom-top < window.innerHeight) {
      // The remote screen is smaller than ours, so put their screen in the middle
      window.scrollBy(0, top - window.pageYOffset - (window.innerHeight - (bottom-top)) / 2);
    } else {
      window.scrollBy(0, top - window.pageYOffset);
    }
  }
};

Base.prototype.hideScreen = function () {
  if (this.lastScreen && this.lastScreen.element) {
    removeVisualFrame(this.lastScreen.element);
    delete this.lastScreen.element;
  }
};

var TEMPORARY_HIGHLIGHT_DELAY = 10000;

Base.prototype.temporaryHighlight = function (el, offsetTop, offsetLeft, mode) {
  offsetTop = offsetTop || 0;
  offsetLeft = offsetLeft || 0;
  var size = 100;
  var elPos = getElementPosition(el);
  var circle = document.createElement('div');
  circle.style.backgroundColor = 'transparent';
  circle.style.border = '2px solid #f00';
  circle.style.position = 'absolute';
  circle.style.width = size + 'px';
  circle.style.height = size + 'px';
  circle.style.borderRadius = (size/2) + 'px';
  circle.style.top = (elPos.top + offsetTop - (size/2)) + 'px';
  circle.style.left = (elPos.left + offsetLeft - (size/2)) + 'px';
  circle.jsmirrorHide = true;
  document.body.appendChild(circle);
  function canceller() {
    if (circle !== null) {
      document.body.removeChild(circle);
      circle = null;
    }
  };
  setTimeout(canceller, TEMPORARY_HIGHLIGHT_DELAY);
  if (mode != 'redisplay') {
    var message = document.createElement('div');
    message.innerHTML = '<a href="#" style="color: #99f; text-decoration: underline">place noted</a>';
    var anchor = message.getElementsByTagName('a')[0];
    anchor.setAttribute('data-place', JSON.stringify({
      element: el.jsmirrorId,
      offsetTop: offsetTop,
      offsetLeft: offsetLeft
    }));
    var self = this;
    // FIXME: this is a closure, but almost doesn't need to be.
    // If it matters at all?
    anchor.addEventListener('click', function (event) {
      var anchor = event.target;
      var data = JSON.parse(anchor.getAttribute('data-place'));
      var el = self.getElement(data.element);
      self.temporaryHighlight(el, data.offsetTop, data.offsetLeft, 'redisplay');
      event.preventDefault();
      event.stopPropagation();
    }, false);
    this.panel.displayMessage(message, (mode == 'local'));
  }
  return canceller;
};

Base.prototype.updateScreen = function (newScreen) {
  if (this.lastScreen && this.lastScreen.element) {
    removeVisualFrame(this.lastScreen.element);
    this.lastScreen = null;
  }
  this.lastScreen = newScreen;
  if (this.panel.viewing) {
    this.showScreen();
  }
};

Base.prototype.updateScreenArrow = function () {
  // Check if the screen is above or below current screen...
  if ((! this.lastScreen) || (! this.lastScreen.start)) {
    return;
  }
  var top = getElementPosition(this.getElement(this.lastScreen.start)).top
            + this.lastScreen.startOffsetTop;
  var bottom = getElementPosition(this.getElement(this.lastScreen.end)).top
               + this.lastScreen.endOffsetTop;
  var myTop = window.pageYOffset;
  var myBottom = window.pageYOffset + window.innerHeight;
  var myHeight = window.innerHeight;
  var arrow = String.fromCharCode(8597);
  if (top < myTop && bottom < myBottom) {
    // Up
    if ((myTop - top) > myHeight) {
      arrow = String.fromCharCode(8607);
    } else {
      // Single up arrow
      arrow = String.fromCharCode(8593);
    }
  } else if (top > myTop && bottom > myBottom) {
    // Down
    if ((top - myTop) > myHeight) {
      arrow = String.fromCharCode(8609);
    } else {
      // Single down arrow
      arrow = String.fromCharCode(8595);
    }
  }
  document.getElementById('jsmirror-view').innerHTML = arrow;
};

/************************************************************
 * Master: the browser that is sending the screen
 */

function Master(server, channel) {
  if (this === window) {
    throw 'You forgot new';
  }
  this.channel = new Channel(server, channel, this);
  this.elements = {};
  this.lastSentDoc = null;
  this.panel = new Panel(this, true);
  this._boundSendDoc = this.sendDoc.bind(this);
  setInterval(this._boundSendDoc, 1000);
  setInterval(this.updateScreenArrow.bind(this), 1200);
}

Master.prototype = new Base();

Master.prototype.sendDoc = function (onsuccess) {
  /* Sends a complete copy of the current document to the server */
  var self = this;
  var docData = this.serializeDocument();
  var data;
  var cacheData = JSON.stringify(docData);
  if (cacheData != this.lastSentDoc) {
    data = {doc: docData};
    this.lastSentDoc = cacheData;
  } else {
    data = {};
  }
  var range = this.getRange();
  if (range) {
    // Sometimes everything is the same, and doesn't really represent
    // a useful range...
    range = expandRange(range);
    range.start = range.start.jsmirrorId;
    range.end = range.end.jsmirrorId;
    data.range = range;
  }
  data.screen = getScreenRange();
  data.screen.start = data.screen.start.jsmirrorId;
  data.screen.end = data.screen.end.jsmirrorId;
  cacheData = JSON.stringify(data);
  if (cacheData != this.lastSentMessage) {
    // There are cases when other changes need to be fixed up by resending
    // the entire document; kind of a shot-gun fix for these:
    data.doc = docData;
    this.send(data);
    this.lastSentMessage = cacheData;
  }
};

Master.prototype.reconnect = function () {
  this.lastSentMessage = null;
  this.lastSentDoc = null;
};

Master.prototype.processCommand = function (event) {
  log(DEBUG, 'got', typeof event, event, !!event.chatMessages);
  if (event.event) {
    var realEvent = this.deserializeEvent(event.event);
    log(WARN, 'got event', event.event.type, event.event.target, realEvent.target);
    this.dispatchEvent(realEvent, event.event.target);
  }
  if (event.change) {
    log(INFO, 'Received change:', event.change, 'target', event.change.target);
    this.processChange(event.change);
  }
  if (event.chatMessages) {
    log(INFO, 'Received chat message:', event.chatMessages);
    for (var j=0; j<event.chatMessages.length; j++) {
      this.panel.displayMessage(event.chatMessages[j], false);
    }
  }
  if (event.highlight) {
    log(INFO, 'Received highlight:', event.highlight);
    var el = this.getElement(event.highlight.target);
    if (el) {
      this.temporaryHighlight(el, event.highlight.offsetTop, event.highlight.offsetLeft, 'remote');
    }
  }
  if (event.screen) {
    log(INFO, 'Received screen:', event.screen);
    this.updateScreen(event.screen);
  }
  if (event.hello) {
    // Make sure to send the doc again:
    this.lastSentDoc = null;
    this.lastSentMessage = null;
  }
};

Master.prototype.deserializeEvent = function (event) {
  /* Takes an actual event (e.g., mouse click) that was sent
     over the wire, and turns it into a native event */
  var value;
  var newEvent = document.createEvent(event.module);

  for (var i in event) {
    if (! event.hasOwnProperty(i)) {
      continue;
    }
    value = event[i];
    if (value && typeof value == 'object' && value.jsmirrorId) {
      value = this.getElement(value.jsmirrorId) || null;
    }
    event[i] = value;
  }
  this.initEvent(newEvent, event, event.module);
  // This might be redundant:
  for (i in event) {
    if (! event.hasOwnProperty(i)) {
      continue;
    }
    newEvent[i] = event[i];
  }
  return newEvent;
};

Master.prototype.getElement = function (id) {
  return this.elements[id];
};

Master.prototype.dispatchEvent = function (event, target) {
  log(INFO, 'Throwing internal event', event.type, event, target);
  if (target && ! target.dispatchEvent) {
    log(WARN, 'huh', event, target, target===window);
    target = window;
  }
  if (target) {
    var doDefault = target.dispatchEvent(event);
    log(DEBUG, 'should do default', doDefault, event.type, target.tagName, target.href);
    if (doDefault && target['on'+event.type]) {
      target['on'+event.type](event);
    }
    if (doDefault && event.type == 'click' && target.tagName == 'A' && target.href) {
      // Dispatching a click event never actually follows the link itself
      location.href = target.href;
    }
  } else {
    // FIXME: do other default actions
    document.dispatchEvent(event);
  }
};

Master.prototype.initEvent = function (event, data, module) {
  /* Instantiates an actual native event object */
  if (module in this.eventAliases) {
    module = this.eventAliases[module];
  }
  if (module === 'UIEvents') {
    event.initUIEvent(
      data.type,
      data.canBubble || true,
      data.cancelable || true,
      data.view || window,
      data.detail);
  } else if (module == 'MouseEvents') {
    log(INFO, {
      type:data.type,
      canBubble:data.canBubble || true,
      cancelable:data.cancelable || true,
      view:document.defaultView,
      detail:data.detail === undefined ? 1 : this.detail,
      screenX:data.screenX,
      screenY:data.screenY,
      clientX:data.clientX,
      clientY:data.clientY,
      ctrlKey:data.ctrlKey,
      altKey:data.altKey,
      shiftKey:data.shiftKey,
      metaKey:data.metaKey,
      button:data.button,
      relatedTraget:data.relatedTarget || null});
    event.initMouseEvent(
      data.type,
      data.canBubble || true,
      data.cancelable || true,
      document.defaultView,
      1,//data.detail,
      data.screenX,
      data.screenY,
      data.clientX,
      data.clientY,
      data.ctrlKey,
      data.altKey,
      data.shiftKey,
      data.metaKey,
      data.button,
      data.relatedTarget || null);
  } else if (module == 'HTMLEvents') {
    event.initEvent(
      data.type,
      data.canBubble || true,
      data.cancelable || true);
  } else if (module == 'KeyboardEvent') {
    event.initKeyEvent(
      data.type,
      data.canBubble || true,
      data.cancelable || true,
      data.view || window,
      data.ctrlKey,
      data.altKey,
      data.shiftKey,
      data.metaKey,
      data.keyCode,
      data.charCode);
  }
};

Master.prototype.eventAliases = {
  UIEvent: 'UIEvents',
  KeyEvents: 'KeyboardEvent',
  Event: 'HTMLEvents',
  Events: 'HTMLEvents',
  MouseScrollEvents: 'MouseEvents',
  MouseEvent: 'MouseEvents',
  HTMLEvent: 'HTMLEvents',
  PopupEvents: 'MouseEvents'
};

Master.prototype.processChange = function (event) {
  /* Processes a change event that came from the server */
  var target = this.getElement(event.target);
  log(INFO, 'Updating', target, 'to value', event.value);
  target.value = event.value;
  var realEvent = document.createEvent('UIEvent');
  realEvent.initUIEvent(
    'change',
    true, // canBubble
    true, // cancelable
    window, // view
    {} // detail
  );
  target.dispatchEvent(realEvent);
  if (target.onchange) {
    target.onchange(realEvent);
  }
};

Master.prototype.skipElement = function (el) {
  /* true if this element should be skipped when sending to the mirror */
  if (el.tagName == 'SCRIPT' || el.jsmirrorHide || el.id == 'webSocketContainer') {
    return true;
  }
  return false;
};

Master.prototype.serializeDocument = function () {
  /* Serializes a complete document to JSON object */
  var result = {
    href: location.href,
    htmlAttrs: this.serializeAttributes(document.childNodes[0]),
    head: this.serializeElement(document.head),
    body: this.serializeElement(document.body),
    hash: location.hash || ""
  };
  return result;
};

Master.prototype.serializeElement = function (el) {
  /* Serializes a single element to a JSON object.
     The object looks like:
       [tagName, localId, {attrs}, [children...]]
   */
  if (! el.jsmirrorId) {
    el.jsmirrorId = makeId();
    this.elements[el.jsmirrorId] = el;
  }
  if (el.tagName == 'CANVAS') {
    return ['IMG', el.jsmirrorId, {src: el.toDataURL('image/png')}, []];
  }
  var attrs = this.serializeAttributes(el);
  // FIXME: I don't understand this, but there's a div that is hidden on Facebook
  // but isn't hidden at the top of the mirrored page
  if (el.clientHeight === 0 && (! el.style.height) && (! el.style.display)) {
    if (attrs.style) {
      attrs.style += '; height: 0';
    } else {
      attrs.style = 'height: 0';
    }
  }
  var childNodes = el.childNodes;
  var nodesLength = childNodes.length;
  var children = [];
  for (var i=0; i<nodesLength; i++) {
    var child = childNodes[i];
    if (child.nodeType == document.CDATA_SECTION_NODE ||
        child.nodeType == document.TEXT_NODE) {
      children.push(child.nodeValue);
    } else if (child.nodeType == document.COMMENT_NODE) {
      children.push(['<!--COMMENT-->', {}, [child.textContent]]);
    } else if (child.nodeType == document.ELEMENT_NODE) {
      if (! this.skipElement(child)) {
        children.push(this.serializeElement(child));
      }
    } else {
      // FIXME: what then?
      log(DEBUG, 'not sure how to serialize this element', child);
    }
  }
  return [el.tagName, el.jsmirrorId, attrs, children];
};

Master.prototype.serializeAttributes = function (el) {
  /* Serialize the attributes of an element into a JSON object */
  var attrs = {};
  if (el.attributes) {
    for (var i=0; i<el.attributes.length; i++) {
      var attrName = el.attributes[i].name;
      if (attrName.substr(0, 2).toLowerCase() == "on") {
        // Don't keep any event-based attributes
        continue;
      } else if (attrName == 'href' || attrName == 'src' || attrName == 'value') {
        attrs[attrName] = el[attrName];
      } else {
        attrs[attrName] = el.attributes[i].nodeValue;
      }
    }
  }
  if (el.tagName == 'TEXTAREA') {
    attrs.value = el.value;
  }
  return attrs;
};


/*************************************************************
 The mirror/client
 */

function Mirror(server, channel) {
  if (this === window) {
    throw 'You forgot new';
  }
  this.channel = new Channel(server, channel, this);
  var self = this;
  this._boundCatchEvent = this.catchEvent.bind(this);
  this._boundChangeEvent = this.changeEvent.bind(this);
  this.panel = new Panel(this, false);
  this.lastHref = null;
  this._boundSendStatus = this.sendStatus.bind(this);
  setInterval(this._boundSendStatus, 1000);
  setInterval(this.updateScreenArrow.bind(this), 1200);
}

Mirror.prototype = new Base();

Mirror.prototype.sendEvent = function (event) {
  this.send({event: event});
};

Mirror.prototype.sendChange = function (change) {
  this.send({change: change});
};

Mirror.prototype.processCommand = function (event) {
  log(DEBUG, 'got message', JSON.stringify(event).substr(0, 70));
  if (event.doc) {
    this.setDoc(event.doc);
  }
  if (event.chatMessages) {
    log(INFO, 'Received chat message:', event.chatMessages);
    for (var j=0; j<event.chatMessages.length; j++) {
      this.panel.displayMessage(event.chatMessages[j], false);
    }
  }
  if (event.highlight) {
    log(INFO, 'Received highlight:', event.highlight);
    var el = this.getElement(event.highlight.target);
    if (el) {
      this.temporaryHighlight(el, event.highlight.offsetTop, event.highlight.offsetLeft, 'remote');
    }
  }
  if (event.range && event.range.start) {
    log(INFO, 'Received range:', event.range);
    event.range.start = this.getElement(event.range.start);
    event.range.end = this.getElement(event.range.end);
    if ((! event.range.start) || (! event.range.end)) {
      log(WARN, 'Bad range');
    } else {
      showRange(event.range, function (el) {
        if (el.nodeType == document.ELEMENT_NODE && (! el.jsmirrorHide)) {
          el.style.backgroundColor = '#ff9';
          //el.style.borderLeft = '1px solid #f00';
          //el.style.borderRight = '1px solid #0f0';
          //el.style.borderTop = '1px solid #00f';
          //el.style.borderBottom = '1px solid #f0f';
        }
      });
    }
  }
  if (event.screen) {
    log(INFO, 'Received screen:', event.screen);
    this.updateScreen(event.screen);
  }
};

Mirror.prototype.reconnect = function () {
  this.send({hello: true});
};

Mirror.prototype.sendStatus = function () {
  var data = {};
  var range = this.getRange();
  if (range) {
    data.range = range;
  }
  data.screen = getScreenRange();
  if ((! data.screen) || (! data.screen.start) || (! data.screen.start.jsmirrorId)) {
    // Screen is rearranging...
    delete data.screen;
  } else {
    data.screen.start = data.screen.start.jsmirrorId;
    data.screen.end = data.screen.end.jsmirrorId;
  }
  var cacheData = JSON.stringify(data);
  if (cacheData != this.lastSentMessage) {
    this.send(data);
    this.lastSentMessage = cacheData;
  }
};

Mirror.prototype.setDoc = function (doc) {
  if (doc.href && this.lastHref !== null && doc.href != this.lastHref) {
    location.reload();
    return;
  }
  if (doc.href) {
    this.lastHref = doc.href;
  }
  if (doc.head) {
    this.setElement(document.head, doc.head);
  }
  if (doc.body) {
    this.setElement(document.body, doc.body);
  }
  if (doc.htmlAttrs) {
    this.setAttributes(document.childNodes[0], doc.htmlAttrs);
  }
  if (doc.href) {
    this.setBase(doc.href);
  }
  if (doc.hash || doc.hash === "") {
    location.hash = doc.hash;
  }
  if (doc.chatMessages && doc.chatMessages.length) {
    for (var i=0; i<doc.chatMessages.length; i++) {
      this.panel.displayMessage(doc.chatMessages[i], false);
    }
  }
};

// FIXME: ugh, so inefficient...
Mirror.prototype.getElementInside = function (el, jsmirrorId) {
  /* Retrieves an element given its internal ID */
  if (jsmirrorId === undefined) {
    throw 'Bad jsmirrorId (undefined) for getElement()';
  }
  if (el.jsmirrorId == jsmirrorId) {
    return el;
  }
  for (var i=0; i<el.childNodes.length; i++) {
    var node = el.childNodes[i];
    if (node.nodeType == document.ELEMENT_NODE) {
      var value = this.getElementInside(node, jsmirrorId);
      if (value) {
        return value;
      }
    }
  }
  return null;
};

Mirror.prototype.getElement = function (jsmirrorId) {
  return this.getElementInside(document.body, jsmirrorId);
};

Mirror.prototype.setElement = function (el, serialized) {
  /* Takes an element and changes it to match the serialized (JSON) version of
     that element */
  var tagName = serialized[0];
  var jsmirrorId = serialized[1];
  var attrs = serialized[2];
  var children = serialized[3];
  if (el.tagName != tagName) {
    // Heck with it, recreate the element entirely
    el.parentNode.replaceChild(this.deserializeElement(serialized), el);
    return;
  }
  this.setAttributes(el, attrs);
  el.jsmirrorId = jsmirrorId;
  var offset = 0;
  for (var i=0; i<children.length; i++) {
    var childIndex = i + offset;
    var existing = el.childNodes[childIndex];
    if (! existing) {
      el.appendChild(this.deserializeElement(children[i]));
    } else if (existing.jsmirrorHide || existing.id == 'webSocketContainer') {
      offset++;
      i--;
      continue;
    } else if (typeof children[i] == 'string') {
      if (existing.nodeType != document.TEXT_NODE) {
        existing.parentNode.replaceChild(document.createTextNode(children[i]), existing);
      } else {
        existing.nodeValue = children[i];
      }
    } else {
      this.setElement(existing, children[i]);
    }
  }
  while (el.childNodes.length - offset > children.length) {
    var node = el.childNodes[children.length + offset];
    if (node.jsmirrorHide || node.id == 'webSocketContainer') {
      offset++;
      continue;
    }
    el.removeChild(node);
  }
};

Mirror.prototype.setAttributes = function (el, attrs) {
  /* Makes an element's attributes match the given JSON attributes */
  var attrLength = 0;
  for (var i in attrs) {
    if (! attrs.hasOwnProperty(i)) {
      continue;
    }
    attrLength++;
    el.setAttribute(i, attrs[i]);
    if (i == 'value') {
      el.value = attrs[i];
    }
  }
  if (el.attributes.length > attrLength) {
    // There must be an extra attribute to be deleted
    var toDelete = [];
    for (i=0; i<el.attributes.length; i++) {
      if (! attrs.hasOwnProperty(el.attributes[i].name)) {
        toDelete.push(el.attributes[i].name);
      }
    }
    for (i=0; i<toDelete.length; i++) {
      log(DEBUG, 'removing attr', toDelete[i]);
      el.removeAttribute(toDelete[i]);
    }
  }
};

Mirror.prototype.setBase = function (baseHref) {
  /* Sets the <base href> of the document */
  var existing = document.getElementsByTagName('base');
  for (var i=0; i<existing.length; i++) {
    existing[i].parentNode.removeChild(existing[i]);
  }
  var base = document.createElement('base');
  base.href = baseHref;
  document.head.appendChild(base);
};

Mirror.prototype.deserializeElement = function (data) {
  /* Creates an element to match the given data */
  if (typeof data == 'string') {
    return document.createTextNode(data);
  }
  var tagName = data[0];
  var jsmirrorId = data[1];
  var attrs = data[2];
  var children = data[3];
  var el;
  if (tagName == '<!--COMMENT-->') {
    if (children && children.length) {
      var text = children[0];
    } else {
      var text = "";
    }
    el = document.createComment(text);
    el.jsmirrorId = jsmirrorId;
    return el;
  }
  el = document.createElement(tagName);
  for (var i in attrs) {
    if (attrs.hasOwnProperty(i)) {
      el.setAttribute(i, attrs[i]);
    }
  }
  for (i=0; i<children.length; i++) {
    var o = children[i];
    if (typeof o == "string") {
      el.appendChild(document.createTextNode(o));
    } else {
      el.appendChild(this.deserializeElement(o));
    }
  }
  el.jsmirrorId = jsmirrorId;
  if ((tagName == 'INPUT' || tagName == 'TEXTAREA' || tagName == 'SELECT' || tagName == 'OPTION')
      && el.id != 'jsmirror-input') {
    el.addEventListener('change', this._boundChangeEvent, false);
  }
  return el;
};

Mirror.prototype.serializeEvent = function (event) {
  /* Serializes an event to JSON */
  var result = {};
  for (var i in event) {
    var value = event[i];
    if (i.toUpperCase() === i && typeof value == 'number') {
      // Skip the constants, CLICK, etc.
      continue;
    }
    if (typeof value == 'function' || value === window) {
      // Skip methods, view
      continue;
    }
    if (value && typeof value == 'object') {
      // Serialize references to elements using their internal ID
      try {
        var jsmirrorId = value.jsmirrorId;
        if (jsmirrorId) {
          value = {jsmirrorId: value.jsmirrorId};
        }
      } catch (e) {
        log(WARN, 'could not get jsmirrorId', value, i, e);
        continue;
      }
    }
    result[i] = value;
  }
  // Some default attributes don't show up in iteration:
  result.cancelable = event.cancelable;
  result.canBubble = event.canBubble;
  // Hack to figure out what "module" or class of events this belongs to
  // (Probably not portable across browsers)
  var evName = event+"";
  evName = evName.substr(evName.indexOf(' ')+1, evName.length-evName.indexOf(' ')-2);
  result.module = evName;
  return result;
};

Mirror.prototype.catchEvents = function () {
  /* Catches all events in docEvents */
  var self = this;
  for (var i=0; i<this.docEvents.length; i++) {
    document.addEventListener(this.docEvents[i], this._boundCatchEvent, true);
  }
};

// Not sure, include? mousedown, mouseup, keydown, keyup?
Mirror.prototype.docEvents = [
  'click', 'dblclick', 'keypress', 'submit'
];

Mirror.prototype.catchEvent = function (event) {
  if (inHighlighting && event.type == 'click') {
    // Don't get in the way of the highlighter
    return false;
  }
  if (event.target) {
    // Ignore anything under a jsmirrorHide element (generally the panel)
    var p = event.target;
    while (p) {
      if (p.jsmirrorHide) {
        event.target.jsmirrorHide = true;
        return false;
      }
      p = p.parentNode;
    }
  }
  if (['keydown', 'keyup', 'keypress'].indexOf(event.type) != -1) {
    for (var i=0; i<this.IGNORE_KEYPRESSES.length; i++) {
      var k = this.IGNORE_KEYPRESSES[i];
      if (((!k.ctrlKey) || event.ctrlKey) &&
          ((!k.shiftKey) || event.shiftKey) &&
          ((!k.charCode) || k.charCode == event.charCode) &&
          ((!k.keyCode) || k.keyCode == event.keyCode)) {
        // There's a match
        return false;
      }
    }
  }
  //if (event.type == 'keypress') {
  //  log(INFO, 'keypress', event.charCode, event.keyCode, event.target);
  //}
  var serialized = this.serializeEvent(event);
  this.sendEvent(serialized);
  // Maybe should check event.cancelable -- stopPropagation doesn't mean anything if
  // that's not true
  var tagName = event.target.tagName;
  if ((event.type == 'click' || event.type == 'keypress') &&
      (tagName == 'INPUT' || tagName == 'TEXTAREA' || tagName == 'SELECT')) {
    // Let the focus happen
    return false;
  }
  event.preventDefault();
  event.stopPropagation();
  return true;
};

Mirror.prototype.IGNORE_KEYPRESSES = [
  {ctrlKey: true, charCode: 116}, // Ctrl+T
  {ctrlKey: true, charCode: 114}, // Ctrl+R
  {ctrlKey: true, charCode: 119}, // Ctrl+W
  {ctrlKey: true, keyCode: 9}, // Ctrl+Tab
  {ctrlKey: true, keyCode: 33}, // Ctrl+PgUp
  {ctrlKey: true, keyCode: 34}, // Ctrl+PgDown
  {ctrlKey: true, shiftKey: true, charCode: 75}, // Ctrl+Shift+K
  {keyCode: 33}, // PgUp
  {keyCode: 34} // pgDown
];

// FIXME: this should batch changes with a delay, so typing doesn't create an excessive
// number of events
Mirror.prototype.changeEvent = function (event) {
  log(DEBUG, 'got change', event, event.target, event.target.value);
  this.sendChange(
    {target: event.target.jsmirrorId, value: event.target.value});
};

/************************************************************
 The panel/UI
 */

function Panel(controller, isMaster) {
  if (this === window) {
    throw 'you forgot new';
  }
  this.controller = controller;
  this.isMaster = isMaster;
  var self = this;
  this._boundHighlightListener = this.highlightListener.bind(this);
  if (! document.body) {
    // We have to defer the actual creation
    window.addEventListener('load', this.initPanel.bind(this), false);
  } else {
    this.initPanel();
  }
}

Panel.prototype.initPanel = function () {
  var self = this;
  this.box = document.createElement('div');
  this.box.jsmirrorHide = true;
  this.box.style.position = 'fixed';
  this.box.style.top = '0.5em';
  this.box.style.right = '0.5em';
  this.box.style.height = '10em';
  this.box.style.width = '7em';
  this.box.style.zIndex = '10001';
  // Note: if you change anything here, be sure to change the example in homepage.html too
  this.box.innerHTML = '<div style="font-family: sans-serif; font-size: 10px; background-color: #444; border: 2px solid #999; color: #fff; padding: 3px; border-radius: 3px;">'
    + '<div style="position: relative; float: right; display: inline">'
    + '<span id="jsmirror-view" style="border: 1px outset #999; cursor: pointer; width: 1em; text-align: center; color: #0f0;" title="Turn this on to show where the remote user is scrolled to">&#8597;</span>'
    + '<span id="jsmirror-highlight" style="border: 1px outset #999; margin-left: 1px; cursor: pointer; width: 1em; text-align: center; color: #f00; font-weight: bold;" title="Press this button and click on the page to highlight a position on the page">&#10132;</span>'
    + '<span id="jsmirror-hide" style="border: 1px outset #999; margin-left: 1px; cursor: pointer; width: 1em; text-align: center">&#215;</span>'
    + '</div>'
    + '<div id="jsmirror-container">'
    + (this.isMaster ? '<div><a title="Give this link to a friend to let them view your session" href="' + this.controller.channel.shareUrl + '" style="text-decoration: underline; color: #99f;">share</a></div>' : '')
    + 'Chat:<div id="jsmirror-chat"></div>'
    + '<input type="text" id="jsmirror-input" style="width: 100%; font-size: 10px; background-color: #999; color: #000; border: 1px solid #000;">'
    + '</div>';
  document.body.appendChild(this.box);
  var hideContainer = document.getElementById('jsmirror-container');
  var hideButton = document.getElementById('jsmirror-hide');
  hideButton.addEventListener('click', function () {
    var borderBox = self.box.getElementsByTagName('div')[0];
    var buttonBox = borderBox.getElementsByTagName('div')[0];
    if (hideContainer.style.display) {
      hideContainer.style.display = "";
      hideButton.innerHTML = '&#215;';
      self.box.style.width = "7em";
      borderBox.style.border = '2px solid #999';
      borderBox.style.backgroundColor = '#444';
      buttonBox.style.backgroundColor = 'transparent';
      buttonBox.style.padding = '';
      buttonBox.style.borderRadius = '';
    } else {
      hideContainer.style.display = "none";
      hideButton.innerHTML = '+';
      self.box.style.width = "";
      borderBox.style.border = '';
      borderBox.style.backgroundColor = 'transparent';
      buttonBox.style.backgroundColor = '#444';
      buttonBox.style.padding = '3px';
      buttonBox.style.borderRadius = '3px';
    }
  }, false);
  this.highlightButton = document.getElementById('jsmirror-highlight');
  this.highlightButton.addEventListener('click', function () {
    document.addEventListener('click', self._boundHighlightListener, true);
    inHighlighting = true;
    self.highlightButton.style.backgroundColor = '#f00';
    self.highlightButton.style.color = '#fff';
  }, false);
  this.viewButton = document.getElementById('jsmirror-view');
  this.viewing = false;
  this.viewButton.addEventListener('click', function () {
    self.viewing = !self.viewing;
    if (self.viewing) {
      self.viewButton.style.backgroundColor = '#0f0';
      self.viewButton.style.color = '#fff';
      self.controller.showScreen(true);
    } else {
      self.viewButton.style.backgroundColor = '#ddf';
      self.viewButton.style.color = '#0f0';
      self.controller.hideScreen();
    }
  }, false);
  this.chatDiv = document.getElementById('jsmirror-chat');
  var chatInput = document.getElementById('jsmirror-input');
  chatInput.addEventListener('keypress', function (event) {
    if (event.keyCode == 13) { // Enter
      self.addChatMessage(chatInput.value);
      chatInput.value = '';
      return false;
    }
  }, false);
};

// Flag that we are currently highlighting something
var inHighlighting = false;

Panel.prototype.highlightListener = function (event) {
  var self = this;
  document.removeEventListener('click', self._boundHighlightListener, true);
  if (! inHighlighting) {
    // This shouldn't happen
    log(INFO, 'highlightListener got event, but should not have');
    return;
  }
  inHighlighting = false;
  if (this.cancelHighlight) {
    this.cancelHighlight();
    this.cancelHighlight = null;
  }
  this.highlightedElement = event.target;
  var elPos = getElementPosition(event.target);
  var offsetLeft = event.pageX - elPos.left;
  var offsetTop = event.pageY - elPos.top;
  this.cancelHighlight = this.controller.temporaryHighlight(event.target, offsetTop, offsetLeft, 'local');
  this.controller.sendHighlight(this.highlightedElement.jsmirrorId, offsetTop, offsetLeft);
  this.highlightButton.style.backgroundColor = '';
  this.highlightButton.style.color = '#f00';
  document.removeEventListener('click', self._boundHighlightListener);
  event.preventDefault();
  event.stopPropagation();
  return true;
};

Panel.prototype.addChatMessage = function (message) {
  this.displayMessage(message, true);
  this.controller.sendChat([message]);
};

Panel.prototype.displayMessage = function (message, here) {
  /* Displays a chat message; if here is true then it's a local message,
     otherwise remote */
  var div;
  if (typeof message == 'string') {
    div = document.createElement('div');
    div.style.margin = '0';
    div.style.padding = '2px';
    div.style.borderBottom = '1px solid #888';
    if (! here) {
      div.style.backgroundColor = '#666';
    }
    div.appendChild(document.createTextNode(message));
  } else {
    div = message;
    if (! here) {
      div.style.backgroundColor = '#666';
    }
  }
  this.chatDiv.appendChild(div);
};

function createVisualFrame(top, bottom) {
  function createElement(left) {
    var div = document.createElement('div');
    div.style.position = 'absolute';
    div.style.height = (bottom-top) + 'px';
    div.style.width = '1px';
    div.style.left = left + 'px';
    div.style.top = top + 'px';
    div.style.borderLeft = '3px solid #f00';
    div.style.zIndex = '10000';
    div.jsmirrorHide = true;
    document.body.appendChild(div);
    return div;
  }
  return {
    left: createElement(window.pageXOffset + 20),
    right: createElement(window.pageXOffset + window.innerWidth - 40)
  };
}

function removeVisualFrame(frame) {
  document.body.removeChild(frame.left);
  document.body.removeChild(frame.right);
}

function getElementPosition(el) {
  var top = 0;
  var left = 0;
  while (el) {
    if (el.offsetTop) {
      top += el.offsetTop;
    }
    if (el.offsetLeft) {
      left += el.offsetLeft;
    }
    el = el.offsetParent;
  }
  return {top: top, left: left};
}

function checkBookmarklet() {
  if (window.runBookmarklet) {
    doOnLoad(function () {
      var destination = window.runBookmarklet.app;
      var token = window.runBookmarklet.token || makeSessionToken();
      delete window.runBookmarklet;
      window.master = new Master(destination, token);
    });
  }
}

function doOnLoad(func) {
  /* Runs a function on window load, or immediately if the window has
     already loaded */
  if (document.readyState == 'complete') {
    func();
  } else {
    window.addEventListener('load', func, false);
  }
}

function getScreenRange() {
  /* Returns {start, end} where these elements are the closest ones
     to the top and bottom of the currently-visible screen. */
  var start = window.pageYOffset;
  var end = start + window.innerHeight;
  var nodes = iterNodes(document.body);
  var atStart = true;
  var startEl = null;
  var endEl = null;
  var startOffsetTop = 0;
  var endOffsetTop = 0;
  while (true) {
    var next = nodes();
    if (! next) {
      break;
    }
    if (next.jsmirrorHide || (! next.jsmirrorId)) {
      continue;
    }
    if (next.nodeType != document.ELEMENT_NODE) {
      continue;
    }
    var offsetTop = 0;
    var el = next;
    while (el) {
      if (el.offsetTop) {
        offsetTop += el.offsetTop;
      }
      el = el.offsetParent;
    }
    if (atStart) {
      if (offsetTop > start) {
        startEl = endEl = next;
        atStart = false;
        startOffsetTop = start - offsetTop;
        continue;
      }
    } else {
      if (offsetTop + next.clientHeight > end) {
        break;
      } else {
        endOffsetTop = end - (offsetTop + next.clientHeight);
        endEl = next;
      }
    }
  }
  return {start: startEl, end: endEl,
          startOffsetTop: startOffsetTop, endOffsetTop: endOffsetTop};
}

function iterNodes(start) {
  /* Iterates, in order (depth-first) all elements in the document.
     Returns a callback that yields these elements. */
  var stack = [[start, null]];
  var cursor = 0;
  return function () {
    if (! stack[cursor]) {
      // Finished
      return null;
    }
    var item = stack[cursor];
    if (item[1] === null) {
      // We should return the item directly
      var result = item[0];
      if (! result) {
        throw 'weird item in stack';
      }
      if (result.nodeType == document.ELEMENT_NODE && result.childNodes.length) {
        // Put the children into the item's place
        stack[cursor] = [result.childNodes, 0];
      } else {
        // Otherwise just pop this item from the stack
        stack[cursor] = null;
        cursor--;
      }
    } else {
      var result = item[0][item[1]];
      if (! result) {
        throw 'weird item in stack';
      }
      if (result.nodeType == document.ELEMENT_NODE && result.childNodes.length) {
        // Add this new element's child to the stack
        if (item[1] >= (item[0].length - 1)) {
          stack[cursor] = [result.childNodes, 0];
        } else {
          item[1]++;
          cursor++;
          stack[cursor] = [result.childNodes, 0];
        }
      } else {
        if (item[1] >= (item[0].length - 1)) {
          // We've finished with this element's children entirely
          stack[cursor] = null;
          cursor--;
        } else {
          // We have more to do, so just go to the next child
          item[1]++;
        }
      }
    }
    return result;
  };
}

function makeSessionToken() {
  var name = window.name;
  var match = (/^view-([a-zA-Z0-9]+)$/).exec(name || '');
  if (match) {
    return match[1];
  }
  var token = generateToken();
  window.name = 'view-' + token;
  return token;
}

TOKEN_CHARS = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';

function generateToken() {
  var s = '';
  for (var i=0; i<10; i++) {
    s += TOKEN_CHARS.charAt(Math.random() * TOKEN_CHARS.length);
  }
  return s;
}

function parseUrl(url) {
  var result = {url: url};
  if (url.indexOf('//') != -1) {
    result.hostname = url.substr(url.indexOf('//')+2);
  } else {
    result.hostname = url;
    result.url = 'http://' + url;
  }
  if (result.hostname.indexOf(':') != -1) {
    result.port = result.hostname.substr(result.hostname.indexOf(':')+1);
    result.hostname = result.hostname.substr(0, result.hostname.indexOf(':'));
  } else {
    result.port = 80;
  }
  return result;
}

function makeId() {
  return 'el' + (arguments.callee.counter++);
}
makeId.counter=0;

VERBOSE = 10; DEBUG = 20; INFO = 30; NOTIFY = 40; WARN = ERROR = 50; CRITICAL = 60;
LOG_LEVEL = DEBUG;

function log(level) {
  if (typeof console == 'undefined') {
    return;
  }
  if (level < LOG_LEVEL) {
    return;
  }
  var args = [];
  for (var i=1; i<arguments.length; i++) {
    args.push(arguments[i]);
  }
  var method = 'log';
  if (level >= ERROR && console.error) {
    method = 'error';
  } else if (level >= INFO && console.info) {
    method = 'info';
  } else if (console.debug) {
    method = 'debug';
  }
  if (! console[method]) {
    method = 'log';
  }
  if (! console[method].apply) {
    // On Fennec I'm getting problems with console[method].apply
    console.log(args);
  } else {
    console[method].apply(console, args);
  }
}

function expandRange(range) {
  /* Given a range object, return
       {start: el, startOffset: int, startSibling: bool,
        end: el, endOffset: int, endSibling: bool}
     The standard range object (https://developer.mozilla.org/en/DOM/range) tends to
     point to text nodes which are not referencable for us.  If *Sibling is true, then the
     offset is after/before the element; if false then it is *interior to* the element.
  */
  var result = {start: range.startContainer, end: range.endContainer,
                startOffset: range.startOffset, endOffset: range.endOffset,
                startText: false, endText: false};
  function doit(name) {
    if (result[name].nodeType == document.TEXT_NODE) {
      while (true) {
        var prev = result[name].previousSibling;
        if (prev === null) {
          result[name] = result[name].parentNode;
          result[name+'Text'] = 'inner';
          break;
        } else if (prev.nodeType == document.ELEMENT_NODE) {
          result[name] = prev;
          result[name+'Text'] = 'after';
          break;
        } else if (prev.nodeType == document.TEXT_NODE) {
          result[name] = prev;
          result[name+'Offset'] += prev.nodeValue.length;
        }
      }
    }
  }
  doit('start'); doit('end');
  return result;
}

function showRange(range, elCallback) {
  var inner;
  if (range.start == range.end && range.startText == 'inner' && range.endText == 'inner') {
    // A special case, when the range is entirely within one element
    var el = splitTextBetween(range.start, range.startOffset, range.endOffset);
    elCallback(el);
    return;
  }
  if (range.startText == 'inner') {
    range.start = splitTextAfter(range.start.childNodes[0], range.startOffset);
  } else if (range.startText == 'after') {
    range.start = splitTextAfter(range.start.nextSibling, range.startOffset);
  } else if (range.startOffset) {
    inner = range.start.childNodes[range.startOffset];
    // While the spec says these offsets specify children, they don't always, and sometimes
    // the "container" is the element selected.
    if (inner) {
      range.start = inner;
    }
  }
  if (range.endText == 'inner') {
    range.end = splitTextBefore(range.end.childNodes[0], range.endOffset);
  } else if (range.endText == 'after') {
    range.end = splitTextBefore(range.end.nextSibling, range.endOffset);
  } else if (range.endOffset) {
    inner = range.end.childNodes[range.endOffset];
    if (inner) {
      range.end = inner;
    }
  }
  // Now we strictly need to go from the start element to the end element (inclusive!)
  var pos = range.start;
  while (true) {
    elCallback(pos);
    pos = getNextElement(pos);
    if (pos === null) {
      log(WARN, 'pos fell out to null', range.start);
      break;
    }
    while (containsElement(pos, range.end)) {
      // FIXME: at some point pos might be a TextNode that needs to be wrapped in
      // a span.
      pos = pos.childNodes[0];
    }
    if (pos == range.end) {
      elCallback(pos);
      break;
    }
  }
}

function containsElement(container, subelement) {
  /* Returns true if subelement is inside container
     Does not return true if subelement == container */
  if (container == subelement) {
    return false;
  }
  if (container.nodeType != document.ELEMENT_NODE) {
    return false;
  }
  for (var i=0; i<container.childNodes.length; i++) {
    var node = container.childNodes[i];
    if (node == subelement) {
      return true;
    }
    if (containsElement(container.childNodes[i], subelement)) {
      return true;
    }
  }
  return false;
}

function getNextElement(el) {
  if (el.childNodes && el.childNodes.length) {
    return el.childNodes[0];
  }
  while (! el.nextSibling) {
    el = el.parentNode;
    if (! el) {
      log(WARN, 'no parent');
      return null;
    }
  }
  return el.nextSibling;
}

function splitTextBefore(el, offset) {
  /* Creates a node that emcompasses all the text starting at el
     and going offset characters */
  var span = document.createElement('span');
  var text = '';
  if (el.nodeType != document.TEXT_NODE) {
    throw 'Unexpected node: ' + el;
  }
  while (el.nodeValue.length < offset) {
    text += el.nodeValue;
    offset -= el.nodeValue.length;
    var remove = el;
    el = el.nextSibling;
    remove.parentNode.removeChild(remove);
  }
  text += el.nodeValue.substr(0, offset);
  var rest = el.nodeValue.substr(offset, el.nodeValue.length-offset);
  el.nodeValue = rest;
  span.appendChild(document.createTextNode(text));
  el.parentNode.insertBefore(span, el);
  return span;
}

function splitTextAfter(el, offset) {
  /* Creates a node *after* offset characters, encompassing all
     text that follows it.  Also all other text siblings will be
     encompassed by spans. */
  var text = '';
  while (el.nodeValue.length < offset) {
    text += el.nodeValue;
    offset -= el.nodeValue.length;
    el = el.nextSibling;
  }
  var rest = el.nodeValue.substr(offset, el.nodeValue.length-offset);
  el.nodeValue = el.nodeValue.substr(0, offset);
  var last = document.createElement('span');
  var span = last;
  last.appendChild(document.createTextNode(rest));
  el.parentNode.insertBefore(last, el.nextSibling);
  var pos = last.nextSibling;
  while (pos) {
    if (pos.nodeType == document.TEXT_NODE) {
      if (last) {
        var here = pos;
        pos = pos.nextSibling;
        last.appendChild(here);
      } else {
        last = document.createElement('span');
        var here = pos;
        pos = pos.nextSibling;
        here.parentNode.insertBefore(last, here);
        last.appendChild(here);
      }
    } else {
      last = null;
      pos = pos.nextSibling;
    }
  }
  return span;
}

function splitTextBetween(el, start, end) {
  /* Creates a span that encompasses the text within el, between start and
     end character offsets */
  if (start > end) {
    throw 'Unexpected range: '+start+' to '+end;
  }
  var innerLength = end-start;
  var startText = '';
  var endText = '';
  var innerText = '';
  var inStart = true;
  var inEnd = false;
  var textNodes = [];
  for (var i=0; i<el.childNodes.length; i++) {
    var node = el.childNodes[i];
    if (node.nodeType != document.TEXT_NODE) {
      if (inEnd) {
        break;
      }
      log(WARN, 'Unexpected element', node);
      continue;
    }
    textNodes.push(node);
    var text = node.nodeValue;
    if (inStart && text.length < start) {
      startText += text;
      start -= text.length;
    } else if (inStart) {
      startText += text.substr(0, start);
      inStart = false;
      text = text.substr(start, text.length-start);
    }
    if ((! inStart) && (! inEnd)) {
      if (text.length < innerLength) {
        innerText += text;
        innerLength -= text.length;
      } else {
        innerText += text.substr(0, innerLength);
        text = text.substr(innerLength, text.length-innerLength);
        inEnd = true;
      }
    }
    if (inEnd) {
      endText += text;
    }
  }
  var startNode = document.createTextNode(startText);
  var endNode = document.createTextNode(endText);
  var innerNode = document.createElement('span');
  innerNode.appendChild(document.createTextNode(innerText));
  for (i=0; i<textNodes.length; i++) {
    el.removeChild(textNodes[i]);
  }
  el.insertBefore(endNode, el.childNodes[0]);
  el.insertBefore(innerNode, endNode);
  el.insertBefore(startNode, innerNode);
  return innerNode;
}
