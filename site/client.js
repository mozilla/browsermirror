/* Implements the client that displays all the content.  This happens
in the view-iframe.html frame. */

var ELEMENT_NODE = document.ELEMENT_NODE;
var TEXT_NODE = document.TEXT_NODE;

function Client(channel, clientId) {
  this.clientId = clientId;
  this.channel = channel;
  this.lastHref = null;
  this._changeEvent = this._changeEvent.bind(this);
  this._catchEvent = this._catchEvent.bind(this);
  this._sendStatusInterval = setInterval(this.sendStatus.bind(this), 1000);
  window.addEventListener("unload", this.onunload.bind(this), false);
  this._catchEvents();
}

Client.prototype = {

  send: function (msg) {
    msg.clientId = this.clientId;
    this.channel.send(msg);
  },

  processCommand: function (command) {
    var href = command.href || (command.doc && command.doc.href);
    var docChange = false;
    if (href && this.lastHref && href != this.lastHref) {
      this.send({local: {restart: true, queueMessages: [command]}});
      this.channel.close();
      this._reloading = true;
      clearTimeout(this._sendStatusInterval);
      location.reload();
      return;
    }
    if (command.hello && command.isMaster) {
      this.updateWaiting('Connected, receiving document...');
      this.send({helloBack: true, supportsWebRTC: supportsWebRTC()});
    }
    if (command.doc) {
      docChange = true;
      this.processDoc(command.doc);
    }
    if (command.updates) {
      docChange = true;
      this.processUpdates(command.updates);
    }
    if (command.diffs) {
      docChange = true;
      this.removeRange();
      this.processDiffs(command.diffs);
      if (this.lastRange && (! command.range)) {
        this.showRange(this.lastRange);
      }
    }
    if (command.highlight) {
      var el = this.getElement(command.highlight.target);
      if (el) {
        temporaryHighlight(el, command.highlight.offsetTop, command.highlight.offsetLeft,
                           command.mode || 'remote');
      }
    }
    if (command.range && command.range.start) {
      this.processRange(command.range);
    }
    if (command.range === null) {
      this.removeRange();
      this.lastRange = null;
    }
    if (command.screen) {
      // FIXME: implement
      if (this.updateScreen) {
        this.updateScreen(command.screen);
      }
    }
    if (docChange) {
      this.processDocChange();
    }
  },

  processDocChange: function () {
    var title = document.title;
    if (title != this._lastTitle && this.ontitlechange) {
      this._lastTitle = title;
      this.ontitlechange(title);
    }
    var links = document.getElementsByTagName('link');
    var linkLen = links.length;
    var linkHref = null;
    for (var i=0; i<linkLen; i++) {
      if (links[i].getAttribute("rel").indexOf("icon") != -1) {
        var linkhref = links[i].href;
        break;
      }
    }
    if (linkHref != this._lastLinkHref && this.onfaviconchange) {
      this._lastLinkHref = linkHref;
      this.onfaviconchange(linkHref);
    }
  },

  updateWaiting: function (message) {
    var el = document.getElementById('jsmirror-waiting');
    if (el) {
      el.innerHTML = '';
      el.appendChild(document.createTextNode(message));
    }
  },

  processUpdates: function (updates) {
    for (var id in updates) {
      if (! updates.hasOwnProperty(id)) {
        continue;
      }
      var replaceEl = this.getElement(id);
      if (! replaceEl) {
        log(WARN, 'Got unknown element in update:', id);
        continue;
      }
      this.setElement(replaceEl, updates[id]);
    }
  },

  processRange: function (range) {
    range.start = this.getElement(command.range.start);
    range.end = this.getElement(command.range.end);
    this.removeRange();
    if ((! range.start) || (! range.end)) {
      log(WARN, 'Bad range');
      return;
    }
    this.showRange(range);
    this.lastRange = range;
  },

  sendStatus: function () {
    var data = {};
    // FIXME: implement getRange
    var range = this.getRange ? this.getRange() : null;
    var rangeJson = JSON.stringify(range);
    if ((range && this.sentRange && this.sentRange != rangeJson) ||
        (range && ! this.sentRange) ||
        ((! range) && this.sentRange)) {
      data.range = range;
      this.sentRange = rangeJson;
    }
    var screen = getScreenRange(document);
    if (screen && screen.start && screen.start.jsmirrorId) {
      // When the screen is rearranging the result might be incomplete
      screen.start = screen.start.jsmirrorId;
      screen.end = screen.end.jsmirrorId;
      var screenJson = JSON.stringify(screen);
      if ((! this.sentScreen) || this.sentScreen != screenJson) {
        data.screen = screen;
        this.sentScreen = screenJson;
      }
    }
    if (data.screen || data.range) {
      this.send(data);
    }
  },

  removeRange: function () {
    var els = this.rangeElements;
    if ((! els) || ! els.length) {
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
        delete el.oldBackgroundColor;
      } else {
        el.style.backgroundColor = null;
      }
    }
    for (var i=0; i<flatten.length; i++) {
      var el = flatten[i];
      while (el.childNodes.length) {
        el.parentNode.insertBefore(el.childNodes[0], el);
      }
      el.parentNode.remoteChild(el);
    }
    this.rangeElements = [];
  },

  showRange: function (range) {
    showRange(range, (function (el) {
      if (el.nodeType == ELEMENT_NODE && ! el.jsmirrorHide) {
        el.oldBackgroundColor = el.style.backgroundColor;
        el.style.backgroundColor = "#ff9";
        this.rangeElements.push(el);
      }
    }).bind(this));
  },

  processDoc: function (doc) {
    this._elements = {};
    if (doc.href) {
      this.lastHref = doc.href;
    }
    if (doc.htmlAttrs) {
      this.setAttributes(this.getHTMLTag(), doc.htmlAttrs);
    }
    if (doc.head) {
      this.setElement(document.head, doc.head);
    }
    if (doc.href) {
      this.setBase(doc.href);
    }
    if (doc.body) {
      this.setElement(document.body, doc.body);
    }
    if (doc.hash || doc.hash === "") {
      location.hash = doc.hash;
    }
  },

  processDiffs: function (commands) {
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
        while (el.previousSibling && el.previousSibling.nodeType == TEXT_NODE) {
          el.parentNode.removeChild(el.previousSibling);
        }
      }
      if (name === 'delete+') {
        while (el.nextSibling && el.nextSibling.nodeType == TEXT_NODE) {
          el.parentNode.removeChild(el.nextSibling);
        }
      }
      if (name === 'delete' || name === 'delete-' || name === 'delete+' || name === 'delete-+') {
        el.parentNode.removeChild(el);
      }
      if (name === 'delete_last_text') {
        if (el.childNodes.length) {
          var lastEl = el.childNodes[el.childNodes.length-1];
          if (lastEl.nodeType != TEXT_NODE) {
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
        if (el.childNodes.length !== 1 || el.childNodes[0].nodeType !== TEXT_NODE) {
          while (el.childNodes) {
            el.removeChild(el.childNodes[0]);
          }
          el.appendChild(document.createTextNode(command[2]));
        } else {
          el.childNodes[0].nodeValue = command[2];
        }
      }
      if (name === 'insert_before') {
        var pushes = command[2];
        for (var j=pushes.length-1; j>=0; j--) {
          var child;
          if (typeof pushes[j] == 'string') {
            child = document.createTextNode(pushes[j]);
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
            child = document.createTextNode(pushes[j]);
          } else {
            child = this.deserializeElement(pushes[j]);
          }
          el.appendChild(child);
        }
      }
    }
  },

  getHTMLTag: function () {
    return document.documentElement;
  },

  getElement: function (jsmirrorId) {
    var el = this._elements[jsmirrorId] || null;
    if (el) {
      return el;
    }
    // In case _elements is incomplete...
    return this._getElementInside(document.body, jsmirrorId);
  },

  _getElementInside: function (el, jsmirrorId) {
    if (el.jsmirrorId == jsmirrorId) {
      return el;
    }
    var l = el.childNodes.length;
    for (var i=0; i<l; i++) {
      var node = el.childNodes[i];
      if (node.nodeType == ELEMENT_NODE) {
        var value = this._getElementInside(node, jsmirrorId);
        if (value) {
          return value;
        }
      }
    }
    return null;
  },

  setElement: function (el, serialized) {
    var tagName = serialized[0];
    var jsmirrorId = serialized[1];
    var attrs = serialized[2];
    var children = serialized[3];
    if (el.tagName != tagName) {
      // Just recreate the entire element
      el.parentNode.replaceChild(this.deserializeElement(serialized), el);
      return;
    }
    this.setAttributes(el, attrs);
    el.jsmirrorId = jsmirrorId;
    this._elements[jsmirrorId] = el;
    var offset = 0;
    for (var i=0; i<children.length; i++) {
      var childIndex = i + offset;
      var existing = el.childNodes[childIndex];
      if (! existing) {
        el.appendChild(this.deserializeElement(children[i]));
      } else if (existing.jsmirrorHide) {
        // try this again, but ignoring this element
        offset++;
        i--;
        continue;
      } else if (typeof children[i] == "string") {
        if (existing.nodeType != TEXT_NODE) {
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
      if (node.jsmirrorHide) {
        offset++;
        continue;
      }
      el.removeChild(node);
    }
  },

  setAttributes: function (el, attrs) {
    var attrLength = 0;
    for (var i in attrs) {
      if (! attrs.hasOwnProperty(i)) {
        continue;
      }
      attrLength++;
      try {
        el.setAttribute(i, attrs[i]);
      } catch (e) {
        // Sometimes this can cause an error, like:
        //   INVALID_CHARACTER_ERR: DOM Exception 5
        // Usually this is an invalid upstream HTML, but so be it - nothing
        // we can do about it here.
        console.warn("Attribute setting error:", i, attrs[i], e);
      }
      if (i == 'value') {
        el.value = attrs[i];
      }
    }
    if (el.attributes.length > attrLength) {
      // Something needs to be deleted
      var toDelete = [];
      for (i=0; i<el.attributes.length; i++) {
        var name = el.attributes[i].name;
        if (! attrs.hasOwnProperty(name)) {
          toDelete.push(name);
        }
      }
      for (i=0; i<toDelete.length; i++) {
        el.removeAttribute(toDelete[i]);
      }
    }
  },

  setBase: function (baseHref) {
    var existing = document.getElementsByTagName('base');
    for (var i=0; i<existing.length; i++) {
      existing[i].parentNode.removeChild(existing[i]);
    }
    var base = document.createElement('base');
    base.href = baseHref;
    document.head.appendChild(base);
  },

  _inputTags: {
    INPUT: true,
    TEXTAREA: true,
    SELECT: true,
    OPTION: true
  },

  deserializeElement: function (data) {
    if (typeof data == "string") {
      return document.createTextNode(data);
    }
    var tagName = data[0];
    var jsmirrorId = data[1];
    var attrs = data[2];
    var children = data[3];
    var el;
    if (tagName == '<!--COMMENT-->') {
      var text = (children && children[0]) || "";
      el = document.createComment(text);
      el.jsmirrorId = jsmirrorId;
      this._elements[jsmirrorId] = el;
      return el;
    }
    el = document.createElement(tagName);
    for (var i in attrs) {
      if (attrs.hasOwnProperty(i)) {
        try {
          el.setAttribute(i, attrs[i]);
        } catch (e) {
          // Sometimes this can cause an error, like:
          //   INVALID_CHARACTER_ERR: DOM Exception 5
          // Usually this is an invalid upstream HTML, but so be it - nothing
          // we can do about it here.
          console.warn("Attribute setting error:", i, attrs[i], e);
        }
      }
    }
    for (var i=0; i<children.length; i++) {
      var c = children[i];
      if (typeof c == "string") {
        el.appendChild(document.createTextNode(c));
      } else {
        el.appendChild(this.deserializeElement(c));
      }
    }
    el.jsmirrorId = jsmirrorId;
    this._elements[jsmirrorId] = el;
    if (this._inputTags[tagName]) {
      var eventType;
      if (tagName == 'TEXTAREA' || (tagName == 'INPUT' && tagName.type && tagName.type.toLowerCase() == 'text')) {
        eventType = 'keyup';
      } else {
        eventType = 'change';
      }
      el.addEventListener(eventType, this._changeEvent, false);
    }
    return el;
  },

  serializeEvent: function (event) {
    var result = {};
    for (var i in event) {
      var value = event[i];
      if ((i.toUpperCase() == i && typeof value == 'number') ||
          typeof value == 'function' ||
          value === window) {
        // Skip constants like CLICK, etc
        continue;
      }
      if (value && typeof value == 'object') {
        // Try to change some things to jsmirrorId's
        try {
          var jsmirrorId = value.jsmirrorId;
          if (jsmirrorId) {
            value = {jsmirrorId: jsmirrorId};
          } else {
            continue;
          }
        } catch (e) {
          log(WARN, "could not get jsmirrorId", value, i, e);
          continue;
        }
      }
      result[i] = value;
    }
    // Some attribtues don't show up in iteration:
    result.cancelable = event.cancelable;
    result.canBubble = event.canBubble;
    // Hack to figure out what "module" or class of events this belongs to
    // (probably not portable)
    var evName = event+"";
    evName = evName.substr(evName.indexOf(' ')+1, evName.length-evName.indexOf(' ')-2);
    result.module = evName;
    return result;
  },

  // Not sure, include? mousedown, mouseup, keydown, keyup?
  _eventsToCatch: ['click', 'dblclick', 'keypress', 'submit'],

  _catchEvents: function () {
    for (var i=0; i<this._eventsToCatch.length; i++) {
      var name = this._eventsToCatch[i];
      document.addEventListener(name, this._catchEvent, true);
    }
  },

  _catchEvent: function (event) {
    if (this.inHighlighting && event.type == 'click') {
      // Don't get in the way of the highligher
      return false;
    }
    var keys = {keydown: true, keyup: true, keypress: true};
    if (keys[event.type]) {
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
    console.log('sending event', serialized);
    this.send({event: serialized});
    var tagName = event.target.tagName;
    if ((event.type == 'click' || event.type == 'keypress') &&
        (tagName == 'INPUT' || tagName == 'TEXTAREA' || tagName == 'SELECT')) {
      // Let the focus happen
      // Also get rid of placeholder text if there is any
      var placeholder = event.target.getAttribute('placeholder');
      console.log('focus on el', event.target, placeholder, event.target.value);
      if (placeholder && placeholder === event.target.value) {
        event.target.value = '';
      }
      return false;
    }
    // Maybe should check event.cancelable; stopPropagation doesn't
    // mean anything if that's not true.
    event.preventDefault();
    event.stopPropagation();
    return true;
  },

  IGNORE_KEYPRESSES: [
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
  ],

  _changeEvent: function (event) {
    this.send({
      change: {
        target: event.target.jsmirrorId,
        value: event.target.value
      }
    });
  },

  onunload: function (event) {
    if (this._reloading) {
      // When we are expecting to unload, it's fine and we needn't tell the parent
      return;
    }
    this.send({local: {unload: true}});
    this.channel.close();
  }

};
