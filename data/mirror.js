/************************************************************
 * Base: base of Master and Mirror
 */

function Base () {
  this.traffic = new TrafficTracker();
  if (typeof unsafeWindow == "undefined") {
    this.document = window.document;
  } else {
    this.document = unsafeWindow.document;
  }
}

Base.prototype.send = function (msg) {
  /* Sends a message to the server */
  if (this.traffic) {
    this.traffic.track(JSON.stringify(msg).length);
  }
  this.connection.send(msg);
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
  var top = getElementPosition(this.getElement(this.lastScreen.start)).top +
            this.lastScreen.startOffsetTop;
  var bottom = getElementPosition(this.getElement(this.lastScreen.end)).top +
               this.lastScreen.endOffsetTop;
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
  var circle = this.document.createElement('div');
  circle.style.backgroundColor = 'transparent';
  circle.style.border = '2px solid #f00';
  circle.style.position = 'absolute';
  circle.style.width = size + 'px';
  circle.style.height = size + 'px';
  circle.style.borderRadius = (size/2) + 'px';
  circle.style.top = (elPos.top + offsetTop - (size/2)) + 'px';
  circle.style.left = (elPos.left + offsetLeft - (size/2)) + 'px';
  circle.jsmirrorHide = true;
  this.document.body.appendChild(circle);
  function canceller() {
    if (circle !== null) {
      this.document.body.removeChild(circle);
      circle = null;
    }
  }
  setTimeout(canceller.bind(this), TEMPORARY_HIGHLIGHT_DELAY);
  if (mode != 'redisplay') {
    var message = this.document.createElement('div');
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
  this.updateScreenArrow();
};

Base.prototype.updateScreenArrowIfScrolled = function () {
  if (! this.lastScrollPosition || this.lastScrollPosition !== window.pageYOffset) {
    this.lastScrollPosition = window.pageYOffset;
    this.updateScreenArrow();
  }
};

Base.prototype.updateScreenArrow = function () {
  // Check if the screen is above or below current screen...
  if ((! this.lastScreen) || (! this.lastScreen.start)) {
    return;
  }
  var top = getElementPosition(this.getElement(this.lastScreen.start)).top +
            this.lastScreen.startOffsetTop;
  var bottom = getElementPosition(this.getElement(this.lastScreen.end)).top +
               this.lastScreen.endOffsetTop;
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
  var el = this.document.getElementById('jsmirror-view');
  if (el && el.status !== arrow) {
    el.status = arrow;
    el.innerHTML = arrow;
  }
};

/************************************************************
 * Master: the browser that is sending the screen
 */

function Master(connection, shareUrl) {
  if (this === window) {
    throw 'You forgot new';
  }
  this.connection = connection;
  this.shareUrl = shareUrl;
  this.elements = {};
  this.lastSentDoc = null;
  this.panel = new MockPanel(this, true);
  this._boundSendDoc = this.sendDoc.bind(this);
  setInterval(this._boundSendDoc, 5000);
  setInterval(this.updateScreenArrowIfScrolled.bind(this), 1200);
  // This gets rid of garbage elements in this.elements:
  setInterval(this.refreshElements.bind(this), 10000);
  var listener = this.modifiedEvent.bind(this);
  //this.document.addEventListener('DOMSubtreeModified', listener, true);
  //this.document.addEventListener('DOMNodeInserted', listener, true);
  //this.document.addEventListener('DOMNodeRemoved', listener, true);
  this.pendingChanges = [];
  this.pendingChangeTimer = null;
  this.send({href: location.href});
}

Master.prototype = new Base();

Master.prototype.isMaster = true;

Master.prototype.modifiedEvent = function (event) {
  var target = event.target;
  if (this.skipElement(target)) {
    return;
  }
  if (event.type != 'DOMSubtreeModified') {
    target = target.parentNode;
  }
  if (this.skipElement(target)) {
    return;
  }
  while (! target.jsmirrorId) {
    target = target.parentNode;
    if (this.skipElement(target)) {
      return;
    }
    if (! target) {
      log(WARN, 'Fell out of page looking for jsmirrorId', event.target, event.target.jsmirrorId);
      this.reconnect();
      return;
    }
  }
  this.pendingChanges.push(target);
  if (this.pendingChangeTimer === null) {
    this.pendingChangeTimer = setTimeout(this.sendUpdates.bind(this), 1000);
  }
};

Master.prototype.sendUpdates = function () {
  // We have an expansive set of updated elements, but we must trim it down to
  // just a minimal set
  this.pendingChangeTimer = null;
  var toSend = trimToParents(this.pendingChanges);
  var message = {};
  for (var i=0; i<toSend.length; i++) {
    var el = toSend[i];
    message[el.jsmirrorId] = this.serializeElement(el);
  }
  this.pendingChanges = [];
  this.send({updates: message});
};

function trimToParents(elements) {
  /* Given a list of elements, return just those elements that are not contained
     by other elements, and remove duplicates. */
  var result = [];
  for (var i=0; i<elements.length; i++) {
    var el = elements[i];
    if (result.indexOf(el) != -1) {
      // Already in list
      continue;
    }
    var parent = el.parentNode;
    var skip = false;
    while (parent) {
      if (elements.indexOf(parent) != -1) {
        skip = true;
        break;
      }
      parent = parent.parentNode;
    }
    if (! skip) {
      result.push(el);
    }
  }
  return result;
}

Master.prototype.sendDoc = function (onsuccess) {
  /* Sends a complete copy of the current document to the server */
  var self = this;
  var docData = this.serializeDocument();
  var data;
  var cacheData = JSON.stringify(docData);
  if (! this.lastSentDoc) { //(! this.lastSentDoc) && cacheData != this.lastSentDoc) {
    data = {doc: docData};
    this.lastSentDoc = cacheData;
    this.lastSentDocData = docData;
  } else {
    data = {};
    var commands = [];
    var result = this.diffDocuments(this.lastSentDocData.head, this.document.head, commands);
    if (result === null) {
      data.doc = docData;
      commands = [];
    } else {
      result = this.diffDocuments(this.lastSentDocData.body, this.document.body, commands, false);
      if (result === null) {
        data.doc = docData;
        commands = [];
      }
    }
    if (commands.length) {
      log(DEBUG, 'Diffs:');
      for (var i=0; i<commands.length; i++) {
        log(DEBUG, '...diff', diffRepr([commands[i]]));
      }
      data.diffs = commands;
      this.lastSentDocData = docData;
      this.lastSentDoc = cacheData;
    }// else console.log('no diff');
  }
  var range = this.getRange();
  if (range) {
    // Sometimes everything is the same, and doesn't really represent
    // a useful range...
    range = expandRange(range);
    range.start = range.start.jsmirrorId;
    range.end = range.end.jsmirrorId;
  }
  if ((! this.lastRange) || (this.lastRange !== JSON.stringify(range))) {
    data.range = range;
    this.lastRange = range;
  }
  // FIXME: should probably shortcut case where the pixel position of the screen
  // hasn't changed (rather than find element anchors each time)
  var screen = getScreenRange(this.document);
  screen.start = screen.start && screen.start.jsmirrorId;
  screen.end = screen.end && screen.end.jsmirrorId;
  if ((! this.lastScreen) || (this.lastScreen !== JSON.stringify(screen))) {
    data.screen = screen;
    this.lastScreen = JSON.stringify(screen);
  }
  cacheData = JSON.stringify(data);
  if (cacheData != this.lastSentMessage) {
    // There are cases when other changes need to be fixed up by resending
    // the entire document; kind of a shot-gun fix for these:
    //data.doc = docData;
    if (data.doc && this.traffic) {
      this.traffic.track(0, 'send doc');
    } else if (data.diffs && this.traffic) {
      this.traffic.track(0, 'send diff');
    }
    this.send(data);
    this.lastSentMessage = cacheData;
  }
};

Master.prototype.reconnect = function () {
  this.lastSentMessage = null;
  this.lastSentDoc = null;
};

Master.prototype.processCommand = function (event) {
  //log(DEBUG, 'got', typeof event, event, !!event.chatMessages);
  log(DEBUG, 'got', JSON.stringify(event).substr(0, 40));
  if (event.event) {
    var realEvent = this.deserializeEvent(event.event);
    log(WARN, 'got event', event.event.type, event.event.target, realEvent.target);
    // FIXME: should handle a cancel during keydown/keypress
    if (realEvent.type == 'keypress') {
      event.event.type = 'keydown';
      var downEvent = this.deserializeEvent(event.event);
      this.dispatchEvent(downEvent, event.event.target);
    }
    this.dispatchEvent(realEvent, event.event.target);
    if (realEvent.type == 'keypress') {
      event.event.type = 'keyup';
      var upEvent = this.deserializeEvent(event.event);
      this.dispatchEvent(upEvent, event.event.target);
    }
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
    log(VERBOSE, 'Received screen:', event.screen);
    this.updateScreen(event.screen);
  }
  if (event.hello) {
    // Make sure to send the doc again:
    if (event.supportsWebRTC && supportsWebRTC()) {
      this.send({supportsWebRTC: true});
    }
    if (event.isMaster) {
      alert('Two computers are sending updates, everything will break!\n' +
            'The other computer is at: ' + event.href);
    }
    this.lastSentDoc = null;
    this.lastSentMessage = null;
    this.lastRange = null;
    this.lastScreen = null;
    this.sendDoc();
  }
};

Master.prototype.deserializeEvent = function (event) {
  /* Takes an actual event (e.g., mouse click) that was sent
     over the wire, and turns it into a native event */
  var value;
  var newEvent = this.document.createEvent(event.module);

  for (var i in event) {
    if (! event.hasOwnProperty(i)) {
      continue;
    }
    value = event[i];
    if (value && typeof value == 'object' && value.jsmirrorId) {
      var el = this.getElement(value.jsmirrorId) || null;
      if (! el) {
        log(WARN, 'Could not find element', value.jsmirrorId);
      }
      value = el;
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

Master.prototype.refreshElements = function () {
  this.elements = {};
  function recur(elements, el) {
    elements[el.jsmirrorId] = el;
    for (var i=0; i<el.childNodes.length; i++) {
      var child = el.childNodes[i];
      if (child.nodeType === this.document.ELEMENT_NODE) {
        recur(elements, child);
      }
    }
  }
  recur(this.elements, this.document.head);
  recur(this.elements, this.document.body);
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
      // FIXME: how do you cancel this?
      target['on'+event.type](event);
    }
    if (doDefault) {
      if (event.type == 'click') {
        this.doDefaultAction(event, target);
      }
    }
  } else {
    // FIXME: do other default actions
    this.document.dispatchEvent(event);
  }
};

Master.prototype.doDefaultAction = function (event, target) {
  if (target.tagName === 'A') {
    if (target.href) {
      var base = target.href;
      var hash = '';
      if (base.indexOf('#') != -1) {
        hash = base.substr(base.indexOf('#'), base.length);
        base = base.substr(0, base.indexOf('#'));
      }
      var hereBase = location.href;
      if (hereBase.indexOf('#') != -1) {
        hereBase = hereBase.substr(0, hereBase.indexOf('#'));
      }
      if (base === hereBase) {
        // Not a remote link, so it's okay
        location.hash = hash;
        this.send({doc: {hash: hash}});
        return;
      }
      this.queryHref(target.href);
    }
    return;
  }
  target = target.parentNode;
  if (target) {
    this.doDefaultAction(event, target);
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
      view:this.document.defaultView,
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
      this.document.defaultView,
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
    var method = event.initKeyboardEvent ? 'initKeyboardEvent' : 'initKeyEvent';
    event[method](
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
  var realEvent = this.document.createEvent('UIEvent');
  realEvent.initUIEvent(
    'change',
    true, // canBubble
    true, // cancelable
    window, // view
    {} // detail
  );
  var doDefault = target.dispatchEvent(realEvent);
  if (doDefault && target.onchange) {
    target.onchange(realEvent);
  }
  // FIXME: if not doDefault, should I set the target.value?
  // FIXME: and should I set value after or before firing events?
  // A normal change event will also fire lots of keydown and keyup events
  // which sometimes are caught instead of a change event.  We'll trigger
  // a keyup event just to make sure...
  realEvent = this.document.createEvent('KeyboardEvent');
  // FIXME: is it okay to leave both keyCode and charCode as 0?
  // FIXME: probably should only fire on text fields
  var method = realEvent.initKeyboardEvent ? 'initKeyboardEvent' : 'initKeyEvent';
  realEvent[method](
    'keyup',
    true, // canBubble
    true, // cancelable
    window, // view
    false, // ctrlKey
    false, // altKey
    false, // shiftKey
    false, // metaKey
    0, // keyCode
    0 // charCode
    );
  doDefault = target.dispatchEvent(realEvent);
  if (doDefault && target.onkeyup) {
    target.onkeyup(realEvent);
  }
};

// These elements can have e.g., clientWidth of 0 but still be relevant:
Master.prototype.skipElementsOKEmpty = {
  LINK: true,
  STYLE: true,
  HEAD: true,
  META: true,
  BODY: true,
  APPLET: true,
  BASE: true,
  BASEFONT: true,
  BDO: true,
  BR: true,
  OBJECT: true,
  TD: true,
  TR: true,
  TH: true,
  THEAD: true,
  TITLE: true
  // COL, COLGROUP?
};

// These elements are never sent:
Master.prototype.skipElementsBadTags = {
  SCRIPT: true,
  NOSCRIPT: true
};

Master.prototype.skipElement = function (el) {
  /* true if this element should be skipped when sending to the mirror */
  var tag = el.tagName;
  if (this.skipElementsBadTags[tag] || el.jsmirrorHide ||
      el.id == 'webSocketContainer') {
    return true;
  }
  // Skip elements that can't be seen, and have no children, and are potentially
  // "visible" elements (e.g., not STYLE)
  // Note elements with children might have children with, e.g., absolute
  // positioning -- so they might not make the parent have any width, but
  // may still need to be displayed.
  if ((el.style && el.style.display == 'none') ||
      ((el.clientWidth === 0 && el.clientHeight === 0) &&
       (! this.skipElementsOKEmpty[tag]) &&
       (! el.childNodes.length))) {
    return true;
  }
  return false;
};

Master.prototype.serializeDocument = function () {
  /* Serializes a complete document to JSON object */
  // FIXME: should I clear this.elements here?
  var doc = unsafeWindow.document;
  var result = {
    href: location.href,
    htmlAttrs: this.serializeAttributes(doc.childNodes[0]),
    head: this.serializeElement(doc.head),
    body: this.serializeElement(doc.body),
    hash: location.hash || ""
  };
  return result;
};

Master.prototype.serializeElement = function (el, includeHTML) {
  /* Serializes a single element to a JSON object.
     The object looks like:
       [tagName, localId, {attrs}, [children...]]

     If includeHTML is true then an additional innerHTML argument will be added
   */
  if (! el.jsmirrorId) {
    el.jsmirrorId = makeId();
    this.elements[el.jsmirrorId] = el;
  }
  if (el.tagName == 'CANVAS') {
    return ['IMG', el.jsmirrorId, {src: el.toDataURL('image/png')}, []];
  }
  var attrs = this.serializeAttributes(el);
  var children = this.normalChildren(el);
  var length = children.length;
  for (var i=0; i<length; i++) {
    var child = children[i];
    if (typeof child != 'string') {
      children[i] = this.serializeElement(children[i]);
    }
  }
  var result = [el.tagName, el.jsmirrorId, attrs, children];
  if (includeHTML) {
    result.push(el.innerHTML);
  }
  return result;
};

Master.prototype.filterInnerHTML = function (doc) {
  var result = [doc[0], doc[1], doc[2], []];
  for (var i=0; i<doc[3].length; i++) {
    if (typeof doc[3][i] == 'string') {
      result[3].push(doc[3][i]);
    } else {
      result[3].push(this.filterInnerHTML(doc[3][i]));
    }
  }
  return result;
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
        attrs[attrName] = el.attributes[i].value;
      }
    }
  }
  if (el.tagName == 'TEXTAREA') {
    attrs.value = el.value;
  }
  return attrs;
};

Master.prototype.serializeToHtml = function (el) {
  /* Serializes a document to static HTML (not a JSON structure).  For use with iframes */
  // FIXME: create
};

Master.prototype.diffDocuments = function (orig, current, commands, logit) {
  var logitOrig = logit;
  if (typeof logit == 'string') {
    logit = current.id == logit;
    if (logit) logitOrig = true;
  }
  if (logit === undefined) {
    logit = current.tagName == 'BODY';
  }
  if (! current) {
    throw 'Got bad current argument: '+current;
  }
  if (commands === undefined) {
    commands = [];
  }
  if (! current.jsmirrorId) {
    log(WARN, 'Got diffDocuments element without an id', current);
    current.jsmirrorId = makeId();
    this.elements[current.jsmirrorId] = current;
  }
  var origTagName = orig[0];
  var origId = orig[1];
  var origAttrs = orig[2];
  var origChildren = orig[3];
  var origInnerHTML = orig[4];
  if (origTagName != current.tagName) {
    // We can't do any diff if the tags don't match
    if (logit) log(INFO, "Failing match because tags don't match", origTagname, current.tagName);
    return null;
  }
  var curAttrs = this.serializeAttributes(current);
  if (! this.compareObjectsUnsafe(origAttrs, curAttrs)) {
    if (logit) log(INFO, 'change attrs', current);
    commands.push(['attrs', current.jsmirrorId, this.serializeAttributes(current)]);
  }
  if (origId !== current.jsmirrorId) {
    // This shouldn't happen really
    log(WARN, "Tag ids don't match", origId, current.jsmirrorId, current);
    return null;
  }
  if (origInnerHTML !== undefined && current.innerHTML === origInnerHTML) {
    // Nothing here is changed
    if (logit) log(INFO, 'innerHTML matches', current);
    return commands;
  }
  var curChildren = this.normalChildren(current);
  var curLength = curChildren.length;
  var origLength = origChildren.length;
  if (curLength === 1 && origLength === 1 &&
      typeof curChildren[0] === 'string' && typeof origChildren[0] === 'string') {
    // A special case of an element that only has a single string child
    if (origChildren[0] !== curChildren[0]) {
      commands.push(['replace_text', current.jsmirrorId, curChildren[0]]);
    }
    return commands;
  }
  var origPos = 0;
  var curPos = 0;
  while (origPos < origLength || curPos < curLength) {
    // If two equal strings, just walk forward
    if (typeof origChildren[origPos] == 'string' &&
        origChildren[origPos] == curChildren[curPos]) {
      if (logit) log(INFO, 'Matching strings', origPos, curPos, origChildren[origPos]);
      origPos++;
      curPos++;
      continue;
    }
    var nextPos = this.findNextMatch(origChildren, curChildren, origPos, curPos);
    if (nextPos === null) {
      // No more matches, so we need to add everything up to the end
      nextPos = [origLength, curLength];
    }
    if (logit) log(INFO, 'Got next match', current, [origPos, curPos], nextPos, origChildren[origPos] && origChildren[origPos][0]);
    var origNext = nextPos[0];
    var curNext = nextPos[1];
    if (origPos < origNext) {
      // We have to delete some orig children
      if (origPos+1 == origNext && typeof origChildren[origPos] == 'string') {
        // Only a string has changed
        if (logit) log(INFO, 'Delete preceding text', origPos);
        if (origNext >= origLength) {
          commands.push(['delete_last_text', current.jsmirrorId]);
        } else {
          commands.push(['deletetext-', origChildren[origPos+1][1]]);
        }
      } else {
        // Some elements have to be deleted
        var startText = typeof origChildren[origPos] == 'string';
        for (var i=origPos; i<origNext; i++) {
          if (typeof origChildren[i] == 'string') {
            continue;
          }
          var command = 'delete';
          if (i == origPos+1 && startText) {
            command += '-';
          }
          if (i+1 < origChildren && typeof origChildren[i+1] == 'string') {
            command += '+';
          }
          if (logit) log(INFO, 'delete orig', command, origChildren[i][1]);
          commands.push([command, origChildren[i][1]]);
        }
      }
    }
    if (curPos < curNext) {
      // We have to insert some new children
      var pushes = [];
      for (var i=curPos; i<curNext; i++) {
        if (typeof curChildren[i] == 'string') {
          pushes.push(curChildren[i]);
        } else {
          if (! curChildren[i].jsmirrorId) {
            curChildren[i].jsmirrorId = makeId();
            this.elements[curChildren[i].jsmirrorId] = curChildren[i];
          }
          pushes.push(this.serializeElement(curChildren[i]));
        }
      }
      if (logit) log(INFO, 'Do insertions', curChildren[curNext], pushes);
      if (curChildren[curNext]) {
        commands.push(['insert_before', curChildren[curNext].jsmirrorId, pushes]);
      } else {
        commands.push(['append_to', current.jsmirrorId, pushes]);
      }
    }
    if (origChildren[origNext]) {
      if (logit) log(INFO, 'Doing diff on subdocuments', origChildren[origNext][0], curChildren[curNext].tagName);
      var origLen = commands.length;
      if (logitOrig && typeof logitOrig == 'number') {
        logitOrig--;
      }
      this.diffDocuments(origChildren[origNext], curChildren[curNext], commands, logitOrig);
      if (logit && origLen != commands.length) {
        log(INFO, 'Element had diff commands', (commands.length-origLen), curChildren[curNext]);
      }
    } else {
      if (logit) log(INFO, 'Nothing left to compare');
    }
    curPos = curNext+1;
    origPos = origNext+1;
  }
  return commands;
};

Master.prototype.findNextMatch = function (origChildren, curChildren, origStart, curStart) {
  /* Return [origPos, curPos] or null if there's no match */
  if (origStart >= origChildren.length || curStart >= curChildren.length) {
    return null;
  }
  while (typeof curChildren[curStart] == 'string' || (! curChildren[curStart].jsmirrorId)) {
    curStart++;
    if (curStart >= curChildren.length) {
      // There's nothing with an id
      return null;
    }
  }
  // First we see if we can find a match for curStart in origChildren
  var check = origStart;
  var checkId = curChildren[curStart].jsmirrorId;
  if (! checkId)
  while (check < origChildren.length) {
    if (typeof origChildren[check] != 'string' && checkId == origChildren[check][1]) {
      return [check, curStart];
    }
    check++;
  }
  // We didn't find a match, so we'll try to find a match for the origStart in curChildren
  // This should never really go more than one loop
  while (typeof origChildren[origStart] == 'string') {
    origStart++;
    if (origStart >= origChildren.length) {
      // There's no more elements
      return null;
    }
  }
  checkId = origChildren[origStart][1];
  check = curStart;
  while (check < curChildren.length) {
    if (typeof curChildren[check] != 'string' && checkId == curChildren[check].jsmirrorId) {
      return [origStart, check];
    }
    check++;
  }
  // Fell out of the loop -- nothing matched, so we'll try later elements all around
  return this.findNextMatch(origChildren, curChildren, origStart+1, curStart+1);
};


Master.prototype.normalChildren = function (el) {
  // Returns a normalized representation of a set of children, as
  // as a list of text and elements, with no two adjacent text elements
  // and no empty text strings.  Ignorable elements are omitted.
  var result = [];
  var children = el.childNodes;
  var length = children.length;
  for (var i=0; i<length; i++) {
    var child = children[i];
    if (this.skipElement(child)) {
      continue;
    }
    if (child.nodeType == this.document.TEXT_NODE) {
      var value = child.nodeValue;
      if (! value) {
        continue;
      }
      if (i && typeof result[result.length-1] == 'string') {
        // Append this text to the last
        result[result.length-1] += value;
      } else {
        result.push(value);
      }
    } else if (child.nodeType == this.document.ELEMENT_NODE) {
      result.push(child);
    }
  }
  return result;
};

Master.prototype.compareObjectsUnsafe = function (orig, clobber) {
  /* Compares the orig and clobber object, seeing that both objects have
     the same attributes with the same values.  clobber will be modified
     by the comparison. */
  for (var i in orig) {
    if (orig[i] !== clobber[i]) {
      return false;
    } else {
      delete clobber[i];
    }
  }
  for (i in clobber) {
    if (orig[i] !== clobber[i]) {
      return false;
    }
  }
  return true;
};

Master.prototype.queryHref = function (href) {
  /* Called when the mirror clicks a link that will go to a new page.
     This asks the user if they want to follow the link, and warns them
     about reactivating the bookmarklet. */
  if (this.queryHrefCancel) {
    this.queryHrefCancel();
  }
  var div = this.document.createElement('div');
  div.style.position = 'fixed';
  div.style.zIndex = '10002';
  div.style.top = parseInt((window.innerHeight - 50)/2, 10) + 'px';
  div.style.height = '100px';
  div.style.left = '50px';
  div.style.width = (window.innerWidth - 200) + 'px';
  div.style.backgroundColor = '#444';
  div.style.color = '#fff';
  div.style.padding = '1em';
  div.style.borderRadius = '3px';
  div.style.border = '2px solid #999';
  div.jsmirrorHide = true;
  // FIXME: quote href
  div.innerHTML = 'The other person has clicked on a link.  That link will take you to:<br>' +
    '<a style="margin-left: 1em; color: #99f; text-decoration: underline" href="' + href + '" target="_blank">' + href + '</a><br>' +
    'Do you want to go? <button id="jsmirror-yes">Go!</button>  <button id="jsmirror-no">Cancel</button><br>' +
    'Note: you must re-activate the bookmarklet once you get to the new page!';
  this.document.body.appendChild(div);
  var yes = this.document.getElementById('jsmirror-yes');
  var no = this.document.getElementById('jsmirror-no');
  var self = this;
  function cancel() {
    this.document.body.removeChild(div);
    this.document.removeEventListener('click', maybeCancel, true);
    self.sendChat(["The other person cancelled your attempt to visit " + href]);
    self.queryHrefCancel = null;
  }
  function maybeCancel(event) {
    if (event.target == yes) {
      location.href = href;
    }
    if (event.target != no) {
      // See if they clicked somewhere on the dialog
      var el = event.target;
      while (el) {
        if (el == div) {
          return;
        }
        el = el.parentNode;
      }
    }
    // Otherwise cancel
    event.preventDefault();
    event.stopPropagation();
    cancel();
  }
  this.document.addEventListener('click', maybeCancel, true);
  this.queryHrefCancel = cancel;
  // FIXME: not sure these will ever happen given maybeCancel:
  yes.addEventListener('click', function () {
    location.href = href;
  });
  no.addEventListener('click', cancel);
};


/*************************************************************
 The mirror/client
 */

function Mirror(connection) {
  if (this === window) {
    throw 'You forgot new';
  }
  this.connection = connection;
  var self = this;
  this._boundCatchEvent = this.catchEvent.bind(this);
  this._boundChangeEvent = this.changeEvent.bind(this);
  this.panel = new Panel(this, false);
  this.lastHref = null;
  this._boundSendStatus = this.sendStatus.bind(this);
  this.rangeElements = [];
  setInterval(this._boundSendStatus, 1000);
  setInterval(this.updateScreenArrow.bind(this), 1200);
}

Mirror.prototype = new Base();

Mirror.prototype.isMaster = false;

Mirror.prototype.sendEvent = function (event) {
  this.send({event: event});
};

Mirror.prototype.sendChange = function (change) {
  this.send({change: change});
};

Mirror.prototype.processCommand = function (event) {
  log(DEBUG, 'got message', JSON.stringify(event).substr(0, 70));
  var href = event.href || (event.doc ? event.doc.href : null);
  if (href && this.lastHref !== null && href != this.lastHref) {
    location.reload();
    return;
  }
  if (event.hello && event.isMaster) {
    var waitingEl = this.document.getElementById('jsmirror-waiting');
    if (waitingEl) {
      waitingEl.innerHTML = 'Connected, receiving document...';
    }
    // Since we need the page right away, we'll ask for it:
    this.send({hello: true, supportsWebRTC: supportsWebRTC()});
  }
  if (event.doc) {
    this.setDoc(event.doc);
  }
  if (event.updates) {
    for (var id in event.updates) {
      if (! event.updates.hasOwnProperty(id)) {
        continue;
      }
      var replaceEl = this.getElement(id);
      if (! replaceEl) {
        log(WARN, 'Got unknown element in update:', id);
        continue;
      }
      this.setElement(replaceEl, event.updates[id]);
    }
  }
  if (event.diffs) {
    this.removeRange();
    this.applyDiff(event.diffs);
    if (this.lastRange && (! event.range)) {
      this.showRange(this.lastRange);
    }
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
    this.removeRange();
    if ((! event.range.start) || (! event.range.end)) {
      log(WARN, 'Bad range');
    } else {
      this.showRange(event.range);
      this.lastRange = event.range;
    }
  } else if (event.range === null) {
    this.removeRange();
    this.lastRange = null;
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
  data.screen = getScreenRange(this.document);
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

Mirror.prototype.removeRange = function () {
  var els = this.rangeElements;
  if (! els || (! els.length)) {
    return;
  }
  var flatten = [];
  for (var i=0; i<els.length; i++) {
    var el = els[i];
    if (el.artificialRangeElement) {
      flatten.push(el);
      continue;
    }
    if (el.oldBackgroundColor) {
      el.style.backgroundColor = el.oldBackgroundColor;
    } else {
      el.style.backgroundColor = null;
    }
  }
  for (var i=0; i<flatten.length; i++) {
    var el = flatten[i];
    while (el.childNodes.length) {
      el.parentNode.insertBefore(el.childNodes[0], el);
    }
    el.parentNode.removeChild(el);
  }
  this.rangeElements = [];
};

Mirror.prototype.showRange = function (range) {
  var self = this;
  showRange(range, function (el) {
    if (el.nodeType == this.document.ELEMENT_NODE && (! el.jsmirrorHide)) {
      el.oldBackgroundColor = el.style.backgroundColor;
      // FIXME: not always a good default highlight:
      el.style.backgroundColor = '#ff9';
      self.rangeElements.push(el);
    }
  });
};

Mirror.prototype.setDoc = function (doc) {
  if (doc.href) {
    this.lastHref = doc.href;
  }
  if (doc.htmlAttrs) {
    this.setAttributes(this.getHTMLTag(), doc.htmlAttrs);
  }
  if (doc.head) {
    this.setElement(this.document.head, doc.head);
  }
  if (doc.href) {
    this.setBase(doc.href);
  }
  if (doc.body) {
    this.setElement(this.document.body, doc.body);
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

Mirror.prototype.getHTMLTag = function () {
  return this.document.getElementsByTagName('HTML')[0];
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
    if (node.nodeType == this.document.ELEMENT_NODE) {
      var value = this.getElementInside(node, jsmirrorId);
      if (value) {
        return value;
      }
    }
  }
  return null;
};

Mirror.prototype.getElement = function (jsmirrorId) {
  return this.getElementInside(this.document.body, jsmirrorId);
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
      if (existing.nodeType != this.document.TEXT_NODE) {
        existing.parentNode.replaceChild(this.document.createTextNode(children[i]), existing);
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
  if (! el.attributes) {
    console.trace();
    console.log('el.attributes?', el, el.tagName);
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
  var existing = this.document.getElementsByTagName('base');
  for (var i=0; i<existing.length; i++) {
    existing[i].parentNode.removeChild(existing[i]);
  }
  var base = this.document.createElement('base');
  base.href = baseHref;
  this.document.head.appendChild(base);
};

Mirror.prototype.deserializeElement = function (data) {
  /* Creates an element to match the given data */
  if (typeof data == 'string') {
    return this.document.createTextNode(data);
  }
  var tagName = data[0];
  var jsmirrorId = data[1];
  var attrs = data[2];
  var children = data[3];
  var el;
  var text;
  if (tagName == '<!--COMMENT-->') {
    if (children && children.length) {
      text = children[0];
    } else {
      text = "";
    }
    el = this.document.createComment(text);
    el.jsmirrorId = jsmirrorId;
    return el;
  }
  el = this.document.createElement(tagName);
  try {
  for (var i in attrs) {
    if (attrs.hasOwnProperty(i)) {
      el.setAttribute(i, attrs[i]);
    }
  } } catch (e) {
    log(WARN, 'bad attrs', attrs, JSON.stringify(attrs));
  }
  if (children === undefined) {
    log(WARN, 'Bad children', data);
    throw 'Bad children list';
  }
  for (var i=0; i<children.length; i++) {
    var o = children[i];
    if (typeof o == "string") {
      el.appendChild(this.document.createTextNode(o));
    } else {
      el.appendChild(this.deserializeElement(o));
    }
  }
  el.jsmirrorId = jsmirrorId;
  if ((tagName == 'INPUT' || tagName == 'TEXTAREA' || tagName == 'SELECT' || tagName == 'OPTION') &&
      el.id != 'jsmirror-input') {
    var eventType;
    if (tagName == 'TEXTAREA' || (tagName == 'INPUT' && tagName.type && tagName.type.toLowerCase() == 'text')) {
      eventType = 'keyup';
    } else {
      eventType = 'change';
    }
    el.addEventListener(eventType, this._boundChangeEvent, false);
  }
  return el;
};

Mirror.prototype.applyDiff = function (commands) {
  for (var i=0; i<commands.length; i++) {
    var command = commands[i];
    var name = command[0];
    var el = this.getElement(command[1]);
    if (! el) {
      log(WARN, 'Got diff command for element that does not exist', command);
      continue;
    }
    if (name === 'attrs') {
      this.setAttributes(el, command[2]);
    }
    if (name === 'deletetext-' || name === 'delete-' || name == 'delete-+') {
      while (el.previousSibling && el.previousSibling.nodeType == this.document.TEXT_NODE) {
        el.parentNode.removeChild(el.previousSibling);
      }
    }
    if (name === 'delete+') {
      while (el.nextSibling && el.nextSibling.nodeType == this.document.TEXT_NODE) {
        el.parentNode.removeChild(el.nextSibling);
      }
    }
    if (name === 'delete' || name === 'delete-' || name === 'delete+' || name === 'delete-+') {
      el.parentNode.removeChild(el);
    }
    if (name === 'delete_last_text') {
      if (el.childNodes.length) {
        var lastEl = el.childNodes[el.childNodes.length-1];
        if (lastEl.nodeType != this.document.TEXT_NODE) {
          log(WARN, "Got command that deletes something that isn't text", command, lastEl);
          continue;
        } else {
          el.removeChild(lastEl);
        }
      } else {
        log(WARN, "Tried to delete_last_text of element with no children", command);
        continue;
      }
    }
    if (name === 'replace_text') {
      if (el.childNodes.length !== 1 || el.childNodes[0].nodeType !== this.document.TEXT_NODE) {
        while (el.childNodes) {
          el.removeChild(el.childNodes[0]);
        }
        el.appendChild(this.document.createTextNode(command[2]));
      } else {
        el.childNodes[0].nodeValue = command[2];
      }
    }
    if (name === 'insert_before') {
      var pushes = command[2];
      for (var j=pushes.length-1; j>=0; j--) {
        var child;
        if (typeof pushes[j] == 'string') {
          child = this.document.createTextNode(pushes[j]);
        } else {
          child = this.deserializeElement(pushes[j]);
        }
        el.parentNode.insertBefore(child, el);
      }
    }
    if (name === 'append_to') {
      var pushes = command[2];
      for (var j=0; j<pushes.length; j++) {
        var child;
        if (typeof pushes[j] == 'string') {
          child = this.document.createTextNode(pushes[j]);
        } else {
          child = this.deserializeElement(pushes[j]);
        }
        el.appendChild(child);
      }
    }
  }
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
        } else {
          continue;
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
    this.document.addEventListener(this.docEvents[i], this._boundCatchEvent, true);
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
  {ctrlKey: true, charCode: 110}, // Ctrl+N
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
  this.document = controller.document;
  /*
  if (! this.document.body) {
    // We have to defer the actual creation
    window.addEventListener('load', this.initPanel.bind(this), false);
  } else {
    this.initPanel();
  }*/
}

Panel.prototype.initPanel = function () {
  var self = this;
  this.box = this.document.createElement('div');
  this.box.jsmirrorHide = true;
  this.box.style.position = 'fixed';
  this.box.style.top = '0.5em';
  this.box.style.right = '0.5em';
  this.box.style.height = '10em';
  this.box.style.width = this.width;
  this.box.style.zIndex = '10001';
  // Note: if you change anything here, be sure to change the example in homepage.html too
  this.box.innerHTML = '<div style="font-family: sans-serif; font-size: 10px; background-color: #444; border: 2px solid #999; color: #fff; padding: 3px; border-radius: 3px; text-align: left">' +
    '<div style="position: relative; float: right; display: inline">' +
    '<span id="jsmirror-view" style="border: 1px outset #999; cursor: pointer; display: inline-block; width: 1em; text-align: center; color: #0f0;" title="Turn this on to show where the remote user is scrolled to">&#8597;</span>' +
    '<span id="jsmirror-highlight" style="border: 1px outset #999; margin-left: 1px; cursor: pointer; display: inline-block; width: 1em; text-align: center; color: #f00; font-weight: bold;" title="Press this button and click on the page to highlight a position on the page">&#10132;</span>' +
    '<span id="jsmirror-hide" style="border: 1px outset #999; margin-left: 1px; cursor: pointer; display: inline-block; width: 1em; text-align: center">&#215;</span>' +
    '</div>' +
    '<div id="jsmirror-container">' +
    (this.isMaster ? '<div><span id="jsmirror-share-text" style="display: none"><label for="jsmirror-share-field">copy this link:</label></span><input type="text" id="jsmirror-share-field" value="' + this.controller.connection.shareUrl + '" style="padding: 0; margin: 0; border: 1px solid #000; width: 8em; display: none"><a id="jsmirror-share-url" title="Give this link to a friend to let them view your session" href="' + this.controller.shareUrl + '" style="text-decoration: underline; color: #99f;">share</a></div>' : '') +
    'Chat:<div id="jsmirror-chat"></div>' +
    '<input type="text" id="jsmirror-input" style="width: 100%; font-size: 10px; background-color: #999; color: #000; border: 1px solid #000;">' +
    '</div>';
  this.document.body.appendChild(this.box);
  var hideContainer = this.document.getElementById('jsmirror-container');
  var hideButton = this.document.getElementById('jsmirror-hide');
  hideButton.addEventListener('click', function () {
    var borderBox = self.box.getElementsByTagName('div')[0];
    var buttonBox = borderBox.getElementsByTagName('div')[0];
    if (hideContainer.style.display) {
      hideContainer.style.display = "";
      hideButton.innerHTML = '&#215;';
      self.box.style.width = this.width;
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
  this.highlightButton = this.document.getElementById('jsmirror-highlight');
  this.highlightButton.addEventListener('click', function () {
    this.document.addEventListener('click', self._boundHighlightListener, true);
    inHighlighting = true;
    self.highlightButton.style.backgroundColor = '#f00';
    self.highlightButton.style.color = '#fff';
  }, false);
  this.viewButton = this.document.getElementById('jsmirror-view');
  this.viewing = false;
  this.viewButton.addEventListener('click', function () {
    self.viewing = !self.viewing;
    if (self.viewing) {
      self.viewButton.style.backgroundColor = '#0f0';
      self.viewButton.style.color = '#000';
      self.controller.showScreen(true);
    } else {
      self.viewButton.style.backgroundColor = 'transparent';
      self.viewButton.style.color = '#0f0';
      self.controller.hideScreen();
    }
  }, false);
  this.chatDiv = this.document.getElementById('jsmirror-chat');
  var chatInput = this.document.getElementById('jsmirror-input');
  chatInput.addEventListener('keypress', function (event) {
    if (event.keyCode == 13) { // Enter
      var message = chatInput.value;
      if (message == '/traffic') {
        self.controller.traffic.show(self);
      } else {
        self.addChatMessage(message);
      }
      chatInput.value = '';
      return false;
    }
  }, false);
  if (this.isMaster) {
    var shareUrl = this.document.getElementById('jsmirror-share-url');
    var shareField = this.document.getElementById('jsmirror-share-field');
    var shareText = this.document.getElementById('jsmirror-share-text');
    shareUrl.addEventListener('click', function (event) {
      event.preventDefault();
      event.stopPropagation();
      shareUrl.style.display = 'none';
      shareField.style.display = '';
      shareText.style.display = '';
      shareField.focus();
      shareField.select();
      if (window.clipboardData) {
        window.clipboardData.setData('text', shareField.value);
      }
    }, false);
    shareField.addEventListener('blur', function () {
      shareField.style.display = 'none';
      shareText.style.display = 'none';
      shareUrl.style.display = '';
    }, false);
    shareText.addEventListener('click', function (event) {
      // We don't want clicking the label to cause a blur
      // FIXME: doesn't work, I guess the blur happens first
      shareField.focus();
      shareField.select();
      event.preventDefault();
      event.stopPropagation();
    }, false);
  }
};

Panel.prototype.width = '16em';

// Flag that we are currently highlighting something
var inHighlighting = false;

Panel.prototype.highlightListener = function (event) {
  var self = this;
  this.document.removeEventListener('click', self._boundHighlightListener, true);
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
  this.document.removeEventListener('click', self._boundHighlightListener, true);
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
    div = this.document.createElement('div');
    div.style.margin = '0';
    div.style.padding = '2px';
    div.style.borderBottom = '1px solid #888';
    if (! here) {
      div.style.backgroundColor = '#666';
    }
    div.appendChild(this.document.createTextNode(message));
  } else {
    div = message;
    if (! here) {
      div.style.backgroundColor = '#666';
    }
  }
  this.chatDiv.appendChild(div);
};

function MockPanel(controller, isMaster) {
  this.controller = controller;
  this.isMaster = isMaster;
}

MockPanel.prototype = {

  displayMessage: function (message, here) {
    self.port.emit("ChatMessage", message, here);
  }

};

function createVisualFrame(top, bottom) {
  function createElement(left) {
    var div = this.document.createElement('div');
    div.style.position = 'absolute';
    div.style.height = (bottom-top) + 'px';
    div.style.width = '1px';
    div.style.left = left + 'px';
    div.style.top = top + 'px';
    div.style.borderLeft = '3px solid #f00';
    div.style.zIndex = '10000';
    div.jsmirrorHide = true;
    this.document.body.appendChild(div);
    return div;
  }
  return {
    left: createElement(window.pageXOffset + 20),
    right: createElement(window.pageXOffset + window.innerWidth - 40)
  };
}

function removeVisualFrame(frame) {
  this.document.body.removeChild(frame.left);
  this.document.body.removeChild(frame.right);
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
  if (this.document.readyState == 'complete') {
    func();
  } else {
    window.addEventListener('load', func, false);
  }
}

function getScreenRange(document) {
  /* Returns {start, end} where these elements are the closest ones
     to the top and bottom of the currently-visible screen. */
  var win;
  if (typeof unsafeWindow == "undefined") {
    win = window;
  } else {
    win = unsafeWindow;
  }
  var start = win.pageYOffset;
  var end = start + win.innerHeight;
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
      if (result.nodeType == this.document.ELEMENT_NODE && result.childNodes.length) {
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
      if (result.nodeType == this.document.ELEMENT_NODE && result.childNodes.length) {
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

function messageFromJson(data, permissive) {
  var messageClass = Message[data.type];
  var message = new messageClass(data, permissive);
}

var Message = {};

function v_bool(name, value, permissive) {
  if ((! permissive) && value === undefined) {
    throw 'Message ' + name + ' must be defined as a bool';
  }
  return !!value;
}

function v_id(name, value, permissive) {
  if ((! permissive) && (value === undefined || typeof value != "string")) {
    // FIXME: could also test the content of the string
    throw 'Message ' + name + ' must be defined as a bool';
  }
}

function v_number(name, value, permissive) {
  if ((! permissive) && typeof value != "number") {
    throw 'Message ' + name + ' must be a number';
  }
}

function v_list(subValidator) {
  return function v_lister(name, value, permissive) {
    if ((! permissive) && value === undefined) {
      throw 'Message ' + name + ' must be defined';
    }
    if (typeof value != "object" || typeof value.length != "number") {
      throw 'Message ' + name + ' must be an array';
    }
    if (subValidator) {
      for (var i=0; i<value.length; i++) {
        var n = name + '[' + i + ']';
        value[i] = subValidator(n, value[i], permissive);
      }
    }
    return value;
  };
}

Message.prototype = {
  bind: function (data, permissive, spec) {
    for (var name in spec) {
      if (! spec.hasOwnProperty(name)) {
        continue;
      }
      var value = spec[name](this.type + '.' + name, data[name], permissive);
      this[name] = value;
    }
    if (! permissive) {
      for (name in data) {
        if (name != "type" && data.hasOwnProperty(name) && (! spec.hasOwnProperty(name))) {
          throw 'Message ' + this.type + ' property ' + name + ' not expected';
        }
      }
    }
  }
};

Message.hello = function (data, permissive) {
  this.type = 'hello';
  this.bind(data, permissive, {
    isMaster: v_bool
  });
};

Message.hello.prototype = Message.prototype;
Message.hello.prototype.toJson = function () {
  return {type: this.type, isMaster: !!this.isMaster};
};

Message.chat = function (data, permissive) {
  this.type = "chat";
  this.bind(data, permissive, {
    messages: v_list(v_string)
  });
};

Message.chat.prototype = Message.prototype;
Message.chat.toJson = function () {
  return {type: this.type, messages: this.messages};
};

Message.highlight = function (data, permissive) {
  this.type = "highlight";
  this.bind(data, permissive, {
    target: v_id,
    offsetTop: v_number,
    offsetLeft: v_number
  });
};

Message.highlight.prototype = Message.prototype;
Message.highlight.toJson = function () {
  return {
    type: this.type,
    target: this.target,
    offsetTop: this.offsetTop,
    offsetLeft: this.offsetLeft
  };
};

Message.document = function (data, permissive) {
  this.type = "document";
  this.bind(data, permissive, {
    href: v_url
  });
};

Message.document.prototype = Message.prototype;
Message.document.prototype.toJson = function () {
  return {type: this.type, href: this.href};
};

Message.updates = function (data, permissive) {
  this.type = "updates";
  this.bind(data, permissive, {
    updates: v_list(v_element)
  });
};

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

var TOKEN_CHARS = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';

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
// This makes it more sortable:
makeId.counter=1000;

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
    if (result[name].nodeType == this.document.TEXT_NODE) {
      while (true) {
        var prev = result[name].previousSibling;
        if (prev === null) {
          result[name] = result[name].parentNode;
          result[name+'Text'] = 'inner';
          break;
        } else if (prev.nodeType == this.document.ELEMENT_NODE) {
          result[name] = prev;
          result[name+'Text'] = 'after';
          break;
        } else if (prev.nodeType == this.document.TEXT_NODE) {
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
  if (container.nodeType != this.document.ELEMENT_NODE) {
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
  var span = this.document.createElement('span');
  span.artificialRangeElement = true;
  var text = '';
  if (el.nodeType != this.document.TEXT_NODE) {
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
  span.appendChild(this.document.createTextNode(text));
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
    if (el.nextSibling) {
      el = el.nextSibling;
    } else {
      log(WARN, 'Could not get ' + offset + 'chars from element', el);
      break;
    }
  }
  var rest = el.nodeValue.substr(offset, el.nodeValue.length-offset);
  el.nodeValue = el.nodeValue.substr(0, offset);
  var last = this.document.createElement('span');
  last.artificialRangeElement = true;
  var span = last;
  last.appendChild(this.document.createTextNode(rest));
  el.parentNode.insertBefore(last, el.nextSibling);
  var pos = last.nextSibling;
  while (pos) {
    if (pos.nodeType == this.document.TEXT_NODE) {
      if (last) {
        var here = pos;
        pos = pos.nextSibling;
        last.appendChild(here);
      } else {
        last = this.document.createElement('span');
        last.artificialRangeElement = true;
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
    if (node.nodeType != this.document.TEXT_NODE) {
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
  var startNode = this.document.createTextNode(startText);
  var endNode = this.document.createTextNode(endText);
  var innerNode = this.document.createElement('span');
  innerNode.artificialRangeElement = true;
  innerNode.appendChild(this.document.createTextNode(innerText));
  for (i=0; i<textNodes.length; i++) {
    el.removeChild(textNodes[i]);
  }
  el.insertBefore(endNode, el.childNodes[0]);
  el.insertBefore(innerNode, endNode);
  el.insertBefore(startNode, innerNode);
  return innerNode;
}

function keys(obj, sort) {
  var result = [];
  for (var i in obj) {
    result.push(i);
  }
  if (sort) {
    result.sort();
  }
  return result;
}

function diffRepr(data) {
  /* Gives a string representation of a diff */
  var result = '';
  for (var i=0; i<data.length; i++) {
    if (result) {
      result += '\n';
    }
    var name = data[i][0];
    var elId = data[i][1];
    if (window.master || window.mirror) {
      var el = (window.master || window.mirror).getElement(elId);
      if (el) {
        elId = el.tagName+':'+elId;
      }
    }
    if (name === 'attrs') {
      result += 'attrs('+elId+')='+keys(data[i][2], true).join(',');
    } else if (name.substr(0, 6) == 'delete') {
      result += name + '(' + elId + ')';
    } else {
      result += name + '(' + elId + ')=' + data[i][2].length + '/' + parseInt(JSON.stringify(data[i][2]).length, 10);
    }
  }
  return result;
}

function markup(name) {
  var ob = window.mirror || window.master;
  var el = ob.getElement(name);
  if (! el) {
    log(WARN, 'No element', name);
  } else {
    el.style.border = '2px dotted #f00';
  }
}

function TrafficTracker(checkTime) {
  if (this === window) {
    throw 'You forgot new';
  }
  this.total = 0;
  this.started = (new Date()).getTime();
  this.marks = [];
  this.lastTime = 0;
  this.checkTime = checkTime || 5000;
  this.div = null;
}

TrafficTracker.prototype.track = function (chars, reason) {
  var now = (new Date()).getTime();
  if (reason ||
      (now - this.lastTime > this.checkTime &&
       (! this.marks.length || this.marks[this.marks.length-1][0]))) {
    this.lastTime = now;
    this.marks.push([0, now, reason]);
    this.updateDisplay();
  }
  this.marks[this.marks.length-1][0] += chars;
  this.total += chars;
};

TrafficTracker.prototype.show = function (panel) {
  var box = panel.box;
  this.div = this.document.createElement('div');
  this.div.innerHTML = 'Traffic:<br><div id="jsmirror-traffic-tracking"></div>';
  box.appendChild(this.div);
  this.updateDisplay();
};

TrafficTracker.prototype.updateDisplay = function () {
  if (! this.div) {
    return;
  }
  var container = this.document.getElementById('jsmirror-traffic-tracking');
  var totalTime = (new Date()).getTime() - this.started;
  var rest = '';
  var secs;
  for (var i=0; i<this.marks.length; i++) {
    var nextTime = this.marks[i+1] ? this.marks[i+1][1] : (new Date()).getTime();
    var time = nextTime - this.marks[i][1];
    var chars = this.marks[i][0];
    var reason = this.marks[i][2] || '@' + parseInt(((new Date()).getTime() - this.started) / 1000, 10);
    rest += reason + '<br>\n';
    rest += '&nbsp;Data: ' + this.size(chars) + '<br>\n';
    secs = time / 1000;
    rest += '&nbsp;Rate: ' + this.size(chars / secs) + '/s <br>\n';
  }
  secs = totalTime / 1000;
  container.innerHTML = (
    '&nbsp;Data: ' + this.size(this.total) + '<br>\n' +
    '&nbsp;Time: ' + parseInt(totalTime/1000, 10) + 'secs <br>\n' +
    '&nbsp;Rate: ' + this.size(this.total / secs) + '/s <br>\n' +
    rest);
};

TrafficTracker.prototype.size = function (s) {
  if (! s) {
    return '0';
  }
  if (s < 2000) {
    return parseInt(s, 10) + 'b';
  }
  return parseInt(s/1000, 10) + 'kb';
};
