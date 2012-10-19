var ELEMENT_NODE;

function Master(channel, document) {
  this.channel = channel;
  this.document = document;
  ELEMENT_NODE = this.document.ELEMENT_NODE;
  this.elements = {};
  // FIXME: this is a hacky way of keeping the element list in sync with Freeze:
  Freeze.elementTracker = this;
  setInterval(binder(this.sendDoc, this), 2000);
  //setInterval(this.updateScreenArrowIfScrolled.bind(this), 1200);
  // This gets rid of garbage elements in this.elements:
  setInterval(this.refreshElements.bind(this), 10000);
  this.channel.send({href: location.href});
}

Master.prototype = {

  toString: function () {
    return '[Master channel: ' + this.channel + ']';
  },

  sendDoc: function sendDoc() {
    var docData = Freeze.serializeDocument();
    var data = {};
    var docDataJson = JSON.stringify(docData);
    if ((! this.lastSentDoc) || this.lastSentDoc != docDataJson) {
      // Need to send some doc update
      if (! this.lastSentDoc) {
        // There's no previous doc so we have to send a full document
        data.doc = docData;
        this.lastSentDoc = docDataJson;
        this.lastSentDocData = docData;
      } else {
        var commands = [];
        var result = this.diffDocuments(this.lastSentDocData.head, this.document.head, commands);
        if (result === null) {
          commands = null;
        } else {
          result = this.diffDocuments(this.lastSentDocData.body, this.document.body, commands, false);
          if (result === null) {
            commands = null;
          }
        }
        if (commands === null || ! commands.length) {
          log(DEBUG, "Sending complete document", commands === null ? "fault" : "diff failure");
          data.doc = docData;/*
          log(WARN, '------------------------------------------------------------');
          log(WARN, this.lastSentDoc);
          log(WARN, '============================================================');
          log(WARN, docDataJson);
          log(WARN, '------------------------------------------------------------');*/
          this.lastSentDoc = docDataJson;
          this.lastSentDocData = docData;
        } else if (commands && commands.length) {
          log(DEBUG, 'Diffs:');
          for (var i=0; i<commands.length; i++) {
            log(DEBUG, '...diff', diffRepr([commands[i]]));
          }
          data.diffs = commands;
          this.lastSentDoc = docDataJson;
          this.lastSentDocData = docData;
        } else {
          log(DEBUG, 'No updates to send/should not happen');
        }
      }
    }
    // FIXME: reimplement getRange:
    var range = this.getRange ? this.getRange() : null;
    if (range) {
      range = expandRange(range);
      range.start = range.start.jsmirrorId;
      range.end = range.end.jsmirrorId;
      var rangeJson = JSON.stringify(range);
      if ((! this.sentRange) || rangeJson != this.sentRange) {
        data.range = range;
        this.sentRange = rangeJson;
      }
    } else {
      if (this.sentRange) {
        data.range = null;
        this.sentRange = null;
      }
    }
    if (data.range || data.doc || data.diffs) {
      this.channel.send(data);
    }
  },

  diffDocuments: function (orig, current, commands) {
    if (! current) {
      throw 'Got bad current argument: ' + current;
    }
    if (commands === undefined) {
      commands = [];
    }
    if (! current.jsmirrorId) {
      log(WARN, "Got diffDocuments element without an id", current);
      current.jsmirrorId = Freeze.makeId();
      this.elements[current.jsmirrorId] = current;
    }
    var origTagName = orig[0];
    var origId = orig[1];
    var origAttrs = orig[2];
    var origChildren = orig[3];
    var origInnerHTML = orig[4];
    if (origTagName != current.tagName) {
      // We can't diff a tag that doesn't match
      log(WARN, 'got tag name change', origTagName, current.tagName);
      return null;
    }
    if (! Freeze.compareAttributes(origAttrs, current)) {
      commands.push(['attrs', current.jsmirrorId, Freeze.serializeAttributes(current)]);
    }
    if (origId != current.jsmirrorId) {
      // This shouldn't happen
      log(WARN, "Tag ids don't match", origId, current.jsmirrorId, current);
      return null;
    }
    if (origInnerHTML !== undefined && current.innerHTML == origInnerHTML) {
      // Deep comparison matches
      return commands;
    }
    var curChildren = Freeze.normalChildren(current);
    var curLength = curChildren.length;
    var origLength = origChildren.length;
    if (curLength === 1 && origLength === 1 &&
        typeof curChildren[0] === "string" && typeof origChildren[0] === "string") {
      // A special case of an element with just one string child
      if (origChildren[0] !== curChildren[0]) {
        commands.push(["replace_text", current.jsmirrorId, curChildren[0]]);
      }
      return commands;
    }
    var origPos = 0;
    var curPos = 0;
    while (origPos < origLength || curPos < curLength) {
      // If two equal strings, walk forward
      if (typeof origChildren[origPos] == "string" &&
          origChildren[origPos] === curChildren[curPos]) {
        origPos++;
        curPos++;
        continue;
      }
      var nextPos = this.findNextMatch(origChildren, curChildren, origPos, curPos);
      if (nextPos === null) {
        // No more matches, so we need to add everything up to the end
        nextPos = [origLength, curLength];
      }
      var origNext = nextPos[0];
      var curNext = nextPos[1];
      if (origPos < origNext) {
        // We have to delete some orig children
        if (origPos + 1 == origNext && typeof origChildren[origPos] == "string") {
          // Only a string has changed
          if (origNext >= origLength) {
            commands.push(["delete_last_text", current.jsmirrorId]);
          } else {
            commands.push(["deletetext-", origChildren[origPos+1][1]]);
          }
        } else {
          // Some elements have to be deleted
          var startText = typeof origChildren[origPos] == "string";
          for (var i=origPos; i<origNext; i++) {
            if (typeof origChildren[i] == "string") {
              continue;
            }
            var command = "delete";
            if (i == origPos+1 && startText) {
              command += "-";
            }
            if (i+1 < origChildren && typeof origChildren[i+1] == "string") {
              command += "+";
            }
            commands.push([command, origChildren[i][1]]);
          }
        }
      }
      if (curPos < curNext) {
        // We have to insert some new children
        var pushes = [];
        for (var i=curPos; i<curNext; i++) {
          if (typeof curChildren[i] == "string") {
            pushes.push(curChildren[i]);
          } else {
            if (! curChildren[i].jsmirrorId) {
              curChildren[i].jsmirrorId = Freeze.makeId();
              this.elements[curChildren[i].jsmirrorId] = curChildren[i];
            }
            pushes.push(Freeze.serializeElement(curChildren[i]));
          }
        }
        if (curChildren[curNext]) {
          commands.push(["insert_before", curChildren[curNext], pushes]);
        } else {
          commands.push(["append_to", current.jsmirrorId, pushes]);
        }
      }
      if (origChildren[origNext]) {
        this.diffDocuments(origChildren[origNext], curChildren[curNext], commands);
      }
      curPos = curNext+1;
      origPos = origNext+1;
    }
    return commands;
  },

  findNextMatch: function (origChildren, curChildren, origStart, curStart) {
    if (origStart >= origChildren.length || curStart >= curChildren.length) {
      return null;
    }
    while (typeof curChildren[curStart] == "string" ||
           (! curChildren[curStart].jsmirrorId)) {
      curStart++;
      if (curStart >= curChildren.length) {
        // There's nothing with an id
        return null;
      }
    }
    // First we see if we can find a match for curStart in origChildren
    var check = origStart;
    var checkId = curChildren[curStart].jsmirrorId;
    if (! checkId) { // FIXME: why is this if statement here
      while (check < origChildren.length) {
        if (typeof origChildren[check] != "string" && checkId == origChildren[check][1]) {
          return [check, curStart];
        }
        check++;
      }
    }
    // We didn't find a match, so we'll try to find a match for the origStart in curChildren
    // This should never really go more than one loop
    while (typeof origChildren[origStart] == "string") {
      origStart++;
      if (origStart >= origChildren.length) {
        // There's no more elements
        return null;
      }
    }
    checkId = origChildren[origStart][1];
    check = curStart;
    while (check < curChildren.length) {
      if (typeof curChildren[check] != "string" &&
          checkId == curChildren[check].jsmirrorId) {
        return [origStart, check];
      }
      check++;
    }
    // Fell out of the loop - nothing matched, so we'll try later elements all around
    return this.findNextMatch(origChildren, curChildren, origStart+1, curStart+1);
  },

  processCommand: function (command) {
    if (command.event) {
      this.processEvent(command.event);
    }
    if (command.change) {
      this.processChange(command.change);
    }
    if (command.highlight) {
      this.processHighlight(command.highlight);
    }
    // Skipping screen
    if (command.hello) {
      // Have to send the doc again
      if (command.isMaster) {
        alert('Two computers are sending updates, everything will break!\n' +
              'The other computer is at: ' + (command.href || 'unknown'));
      }
      this.lastSentDoc = this.lastSentDocData = this.sentRange = null;
      this.sendDoc();
    }
  },

  processEvent: function (event) {
    var realEvent = this.deserializeEvent(event);
    if (realEvent.type == 'keypress') {
      event.type = 'keydown';
      var downEvent = this.deserializeEvent(event);
      this.dispatchEvent(downEvent, event.target);
    }
    this.dispatchEvent(realEvent, event.target);
    if (realEvent.type == 'keypress') {
      event.type = 'keyup';
      var upEvent = this.deserializeEvent(event);
      this.dispatchEvent(upEvent, event.target);
    }
  },

  deserializeEvent: function (event) {
    var value;
    var newEvent = this.document.createEvent(event.module);
    for (var i in event) {
      if (! event.hasOwnProperty(i)) {
        continue;
      }
      value = event[i];
      if (value && typeof value == "object" && value.jsmirrorId) {
        var el = this.getElement(value.jsmirrorId) || null;
        console.log('derefing object', i, value.jsmirrorId, el);
        if (! el) {
          log(WARN, "Could not find element", value.jsmirrorId);
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
  },


  initEvent: function (event, data, module) {
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
  },

  eventAliases: {
    UIEvent: 'UIEvents',
    KeyEvents: 'KeyboardEvent',
    Event: 'HTMLEvents',
    Events: 'HTMLEvents',
    MouseScrollEvents: 'MouseEvents',
    MouseEvent: 'MouseEvents',
    HTMLEvent: 'HTMLEvents',
    PopupEvents: 'MouseEvents'
  },

  dispatchEvent: function (event, target) {
    log(INFO, 'Dispatching internal event', event.type, event, target);
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
  },

  doDefaultAction: function (event, target) {
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
          this.channel.send({doc: {hash: hash}});
          return;
        }
        // FIXME: make this a query:
        //this.queryHref(target.href);
        location.href = target.href;
      }
      return;
    }
    target = target.parentNode;
    if (target) {
      this.doDefaultAction(event, target);
    }
  },

  processChange: function (change) {
    var target = this.getElement(change.target);
    target.value = change.value;
    var realEvent = this.document.createEvent("UIEvent");
    realEvent.initUIEvent(
      "change",
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
    // FIXME: should test this with some field that does something special with Return
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
  },

  processHighlight: function (highlight) {
    var el = this.getElement(highlight.target);
    if (el) {
      this.temporaryHighlight(el, highlight.offsetTop, highlight.offsetLeft,
                              highlight.mode || 'remote');
    }
  },

  refreshElements: function () {
    return;
    this.elements = {};
    function recur(elements, el) {
      elements[el.jsmirrorId] = el;
      var l = el.childNodes.length;
      for (var i=0; i<l; i++) {
        var child = el.childNodes[i];
        if (child.nodeType === ELEMENT_NODE) {
          recur(elements, child);
        }
      }
    }
    recur(this.elements, this.document.head);
    recur(this.elements, this.document.body);
  },

  getElement: function (id) {
    if (! this.elements[id]) {
      console.warn("Could not find element", id);
    }
    return this.elements[id] || null;
  }

};


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
      result += '\n    ' + JSON.stringify(data[i][2]);
    }
  }
  return result;
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
