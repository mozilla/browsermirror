VERBOSE = 10; DEBUG = 20; INFO = 30; NOTIFY = 40; ERROR = 50; CRITICAL = 60;
LOG_LEVEL = INFO;

function log(level) {
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
  } else {
    method = 'debug';
  }
  console[method].apply(console, args);
}

function makeId() {
  return 'el' + (arguments.callee.counter++);
}
makeId.counter=0;

function Master(destination) {
  if (this === window) {
    throw 'You forgot new';
  }
  this.destination = destination;
  this.allElements = {};
  this.lastSentDoc = null;
  this.panel = new Panel(this, true);
  this.highlightElementId = null;
}

Master.prototype.notifyMessage = function () {
  // We'll just send it when we get around to it
};

Master.prototype.sendHighlight = function (jsmirrorId) {
  this.highlightElementId = jsmirrorId;
};

Master.prototype.sendDoc = function (onsuccess) {
  var self = this;
  var data = JSON.stringify(this.serializeDocument());
  var req;
  if (data !== this.lastSentDoc) {
    log(DEBUG, 'Sending DOM updates');
    req = new XMLHttpRequest();
    req.open('POST', this.destination);
    req.onreadystatechange = function () {
      if (req.readyState != 4) {
        return;
      }
      var body = JSON.parse(req.responseText || '[]');
      if (body && body.length) {
        self.dispatchEvents(body);
      }
      if (onsuccess) {
        onsuccess();
      }
    };
    req.send(data);
    this.lastSentDoc = data;
  } else {
    // Still pick up updates from clients
    log(DEBUG, 'No new DOM updates to send');
    req = new XMLHttpRequest();
    req.open('GET', this.destination + '?getreturn');
    req.onreadystatechange = function () {
      if (req.readyState != 4) {
        return;
      }
      var body = JSON.parse(req.responseText || '[]');
      if (body && body.length) {
        self.dispatchEvents(body);
      }
      if (onsuccess) {
        onsuccess();
      }
    };
    req.send();
  }
};

Master.prototype.dispatchEvents = function (events) {
  for (var i=0; i<events.length; i++) {
    if (events[i].jsmirrorEvent === 'general') {
      var event = this.deserializeEvent(events[i]);
      log(INFO, 'Received event:', events[i], 'target', event.target);
      this.sendEvent(event, events[i].target);
    } else if (events[i].jsmirrorEvent === 'change') {
      log(INFO, 'Received change:', events[i], 'target', event.target);
      this.sendChange(events[i]);
    } else if (events[i].jsmirrorEvent == 'message') {
      log(INFO, 'Received chat message:', events[i].messages);
      for (var j=0; j<events[i].messages.length; j++) {
        this.panel.displayMessage(events[i].messages[j], false);
      }
    } else if (events[i].jsmirrorEvent == 'highlight') {
      log(INFO, 'Received highlight:', events[i].target.jsmirrorId);
      var el = this.getElement(events[i].target.jsmirrorId);
      temporaryHighlight(el);
    }
  }
};

Master.prototype.poll = function (period) {
  var self = this;
  period = period || 1000;
  function runPoll() {
    self.sendDoc(function () {
      setTimeout(runPoll, period);
    });
  }
  runPoll();
};

Master.prototype.deserializeEvent = function (event) {
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
  return this.allElements[id];
};

Master.prototype.sendEvent = function (event, target) {
  log(INFO, 'Throwing internal event', event.type, event, target);
  window.gt = target;
  if (target && ! target.dispatchEvent) {
    console.log('huh', event, target, target===window);
    target = window;
  }
  if (target) {
    var doDefault = target.dispatchEvent(event);
    if (doDefault && event.type == 'click' && target.tagName == 'A' && target.href) {
      // Dispatching a click event never actually follows the link itself
      location.href = target.href;
    }
  } else {
    return document.dispatchEvent(event);
  }
};

Master.prototype.initEvent = function (event, data, module) {
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

Master.prototype.sendChange = function (event) {
  var target = this.getElement(event.target);
  log(INFO, 'Updating', target, 'to value', event.value);
  target.value = event.value;
};

Master.prototype.skipElement = function (el) {
  if (el.tagName == 'SCRIPT' || el.jsmirrorHide) {
    return true;
  }
  return false;
};

Master.prototype.serializeDocument = function () {
  var result = {
    href: location.href,
    htmlAttrs: this.serializeAttributes(document.childNodes[0]),
    head: this.serializeElement(document.head),
    body: this.serializeElement(document.body),
    hash: location.hash || "",
    chatMessages: this.panel.chatMessages,
    highlightElement: this.highlightElementId
  };
  this.panel.chatMessages = [];
  this.highlightElementId = null;
  return result;
};

Master.prototype.serializeElement = function (el) {
  if (! el.jsmirrorId) {
    el.jsmirrorId = makeId();
    this.allElements[el.jsmirrorId] = el;
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
      // what then?
    }
  }
  return [el.tagName, el.jsmirrorId, attrs, children];
};

Master.prototype.serializeAttributes = function (el) {
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
  return attrs;
};


/*************************************************************
 The mirror/client
 */

function Mirror(source) {
  if (this === window) {
    throw 'You forgot new';
  }
  this.source = source;
  var self = this;
  this._boundCatchEvent = function (event) {
    return self.catchEvent(event);
  };
  this._boundChangeEvent = function (event) {
    return self.changeEvent(event);
  };
  this.lastModified = null;
  this.panel = new Panel(this, false);
}

Mirror.prototype.getDoc = function (onsuccess) {
  var self = this;
  var req = new XMLHttpRequest();
  var source = this.source;
  if (this.lastModified) {
    source += '&if_modified_since=' + this.lastModified;
  }
  req.open('GET', source);
  req.onreadystatechange = function () {
    if (req.readyState != 4) {
      return;
    }
    var data = JSON.parse(req.responseText);
    if (data !== null) {
      self.lastModified = data.lastModified;
      self.setDoc(data);
    }
    if (onsuccess) {
      onsuccess();
    }
  };
  req.send();
};

Mirror.prototype.poll = function (period) {
  var self = this;
  period = period || 1000;
  function runPoll() {
    self.getDoc(function () {
      setTimeout(runPoll, period);
    });
  }
  runPoll();
};

Mirror.prototype.setDoc = function (doc) {
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
  if (doc.highlightElement) {
    var el = this.getElementById(document.body, doc.highlightElement);
    temporaryElementHighlight(el);
  }
};

// FIXME: ugh, so inefficient...
Mirror.prototype.getElementById = function (el, jsmirrorId) {
  if (el.jsmirrorId == jsmirrorId) {
    return el;
  }
  for (var i=0; i<el.childNodes.length; i++) {
    var node = el.childNodes[i];
    if (node.nodeType == document.ELEMENT_NODE) {
      var value = this.getElementById(node, jsmirrorId);
      if (value) {
        return value;
      }
    }
  }
  return null;
};

Mirror.prototype.setElement = function (el, serialized) {
  var tagName = serialized[0];
  var jsmirrorId = serialized[1];
  var attrs = serialized[2];
  var children = serialized[3];
  if (el.tagName != tagName) {
    // Heck with it, do it ane1w
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
    } else if (existing.jsmirrorHide) {
      offset++;
      i--;
      continue;
    } else {
      this.setElement(existing, children[i]);
    }
  }
};

Mirror.prototype.setAttributes = function (el, attrs) {
  for (var i in attrs) {
    if (! attrs.hasOwnProperty(i)) {
      continue;
    }
    el.setAttribute(i, attrs[i]);
  }
  // FIXME: doesn't delete attributes
};

Mirror.prototype.setBase = function (baseHref) {
  var existing = document.getElementsByTagName('base');
  for (var i=0; i<existing.length; i++) {
    existing[i].parentNode.removeChild(existing[i]);
  }
  var base = document.createElement('base');
  base.href = baseHref;
  document.head.appendChild(base);
};

Mirror.prototype.deserializeElement = function (data) {
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
  if ((tagName == 'INPUT' || tagName == 'TEXTAREA' || tagName == 'SELECT')
      && el.id != 'jsmirror-input') {
    el.addEventListener('change', this._boundChangeEvent, false);
  }
  return el;
};

Mirror.prototype.serializeEvent = function (event) {
  var result = {jsmirrorEvent: 'general'};
  for (var i in event) {
    var value = event[i];
    if (i.toUpperCase() === i && typeof value == 'number') {
      // Skip the constants, CLICK, etc.
      continue;
    }
    if (typeof value == 'function' || value === window) {
      continue;
    }
    if (value && typeof value == 'object') {
      try {
        var jsmirrorId = value.jsmirrorId;
        if (jsmirrorId) {
          value = {jsmirrorId: value.jsmirrorId};
        }
      } catch (e) {
        console.log('could not get jsmirrorId', value, i, e);
        continue;
      }
    }
    result[i] = value;
  }
  result.cancelable = event.cancelable;
  result.canBubble = event.canBubble;
  var evName = event+"";
  evName = evName.substr(evName.indexOf(' ')+1, evName.length-evName.indexOf(' ')-2);
  result.module = evName;
  return result;
};

Mirror.prototype.catchEvents = function () {
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
  if (event.target) {
    var p = event.target;
    while (p) {
      if (p.jsmirrorHide) {
        event.target.jsmirrorHide = true;
        return;
      }
      p = p.parentNode;
    }
  }
  if (['keydown', 'keyup', 'keypress'].indexOf(event.type) != -1 && event.ctrlKey
      && ([114, 116].indexOf(event.charCode) != -1
          || [9, 33, 34].indexOf(event.keyCode) != -1)) {
    // Let it propagate: Ctrl+T, Ctrl+R, Tab, PgUp, PgDown
    // FIXME: things like scrolling won't work, and depend on the context
    return;
  }
  if (event.type == 'keypress') {
    log(INFO, 'keypress', event.charCode, event.keyCode, event.target);
  }
  var serialized = this.serializeEvent(event);
  this.sendEvent(serialized);
  // Maybe should check event.cancelable -- stopPropagation doesn't mean anything if
  // that's not true
  var tagName = event.target.tagName;
  if ((event.type == 'click' || event.type == 'keypress') &&
      (tagName == 'INPUT' || tagName == 'TEXTAREA' || tagName == 'SELECT')) {
    // Let the focus happen
    return;
  }
  event.preventDefault();
  event.stopPropagation();
  return true;
};

Mirror.prototype.sendEvent = function (event) {
  var req = new XMLHttpRequest();
  log(INFO, 'Sending event', event);
  req.open('POST', this.source + '&return');
  req.send(JSON.stringify([event]));
};

Mirror.prototype.changeEvent = function (event) {
  var msg = {
    jsmirrorEvent: 'change',
    target: event.target.jsmirrorId,
    value: event.target.value
  };
  this.sendEvent(msg);
};

Mirror.prototype.notifyMessage = function () {
  var msg = {
    jsmirrorEvent: 'message',
    messages: this.panel.chatMessages
  };
  this.panel.chatMessages = [];
  this.sendEvent(msg);
};

Mirror.prototype.sendHighlight = function (jsmirrorId) {
  var msg = {
    jsmirrorEvent: 'highlight',
    target: {jsmirrorId: jsmirrorId}
  };
  this.sendEvent(msg);
};

/************************************************************
 The panel/UI
 */

function Panel(connection, isMaster) {
  if (this === window) {
    throw 'you forgot new';
  }
  this.connection = connection;
  this.isMaster = isMaster;
  this.chatMessages = [];
  var self = this;
  if (! document.body) {
    window.addEventListener('load', function () {
      self.initPanel();
    }, false);
  }
  this._boundHighlightListener = function (event) {
    return self.highlightListener(event);
  };
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
  this.box.innerHTML = '<div style="font-family: sans-serif; font-size: 10px; background-color: #ddf; border: 2px solid #000">'
    + '<span id="jsmirror-hide" style="position: relative; float: right; border: 2px inset #88f; cursor: pointer; width: 1em; text-align: center">&#215;</span>'
    + '<span id="jsmirror-highlight" style="position: relative; float: right; border: 2px inset #88f; cursor: pointer; width: 1em; text-align: center; color: #f00;">&#9675;</span>'
    + '<div id="jsmirror-container">'
    + (this.isMaster ? '<div><a title="Give this link to a friend to let them view your session" href="' + master.destination + '">share</a></div>' : '')
    + 'Chat:<div id="jsmirror-chat"></div>'
    + '<input type="text" id="jsmirror-input" style="width: 100%">'
    + '</div>';
  document.body.appendChild(this.box);
  var hideContainer = document.getElementById('jsmirror-container');
  var hideButton = document.getElementById('jsmirror-hide');
  hideButton.addEventListener('click', function () {
    if (hideContainer.style.display) {
      hideContainer.style.display = "";
      hideButton.innerHTML = '&#215;';
      self.box.style.width = "7em";
    } else {
      hideContainer.style.display = "none";
      hideButton.innerHTML = '+';
      self.box.style.width = "";
    }
  }, false);
  this.highlightButton = document.getElementById('jsmirror-highlight');
  this.highlightButton.addEventListener('click', function () {
    document.addEventListener('click', self._boundHighlightListener, true);
    self.highlightButton.style.backgroundColor = '#f00';
    self.highlightButton.style.color = '#f00';
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

Panel.prototype.highlightListener = function (event) {
  var self = this;
  if (this.highlightedElement) {
    this.removeHighlight();
  }
  this.highlightedElement = event.target;
  this.highlightElement();
  this.connection.sendHighlight(this.highlightedElement.jsmirrorId);
  this.highlightButton.style.backgroundColor = '';
  this.highlightButton.style.color = '#f00';
  setTimeout(function () {
    self.removeHighlight();
  }, 5000);
  document.removeEventListener('click', self._boundHighlightListener);
  event.preventDefault();
  event.stopPropagation();
  return true;
  // FIXME: the click still is sent to master
};

Panel.prototype.highlightElement = function () {
  this.oldBorder = this.highlightedElement.style.border;
  this.highlightedElement.style.border = '3px dotted #f00';
};

Panel.prototype.removeHighlight = function () {
  this.highlightedElement.style.border = this.oldBorder;
};

Panel.prototype.addChatMessage = function (message) {
  this.displayMessage(message, true);
  this.chatMessages.push(message);
  this.connection.notifyMessage();
};

Panel.prototype.displayMessage = function (message, here) {
  var div = document.createElement('div');
  div.style.margin = '0';
  div.style.padding = '2px';
  div.style.borderBottom = '1px solid #aaa';
  if (! here) {
    div.style.backgroundColor = '#fff';
  }
  div.appendChild(document.createTextNode(message));
  this.chatDiv.appendChild(div);
};

function temporaryHighlight(el) {
  var oldBorder = el.style.border;
  el.style.border = '3px dotted #f00';
  setTimeout(function () {
    el.style.border = oldBorder;
  }, 5000);
};

if (window.runBookmarklet) {
  var destination = window.runBookmarklet;
  delete window.runBookmarklet;
  // FIXME: no hardcode:
  var master = new Master(destination + '/foo');
  master.poll();
}

function getNearestElement(pixelOffset, roundDown) {
  var elPos = el.offsetTop;
  if (! roundDown) {
    elPos += el.offsetHeight;
  }
}

function getScreenRange() {
  var start = window.pageYOffset;
  var end = start + document.body.clientHeight;
  var nodes = iterNodes(document.body);
  var atStart = true;
  var startEl = null;
  var endEl = null;
  while (true) {
    var next = nodes();
    if (! next) {
      break;
    }
    if (next.jsmirrorHide) {
      continue;
    }
    if (next.nodeType != document.ELEMENT_NODE) {
      continue;
    }
    if (atStart) {
      if (next.offsetTop > start) {
        startEl = endEl = next;
        atStart = false;
        continue;
      }
    } else {
      if (next.offsetTop + next.clientHeight > end) {
        break;
      } else {
        endEl = next;
      }
    }
  }
  startEl.style.borderTop = '1px dotted #00f';
  endEl.style.borderBottom = '1px dotted #0f0';
  return {start: startEl, end: endEl};
}

function iterNodes(start) {
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
