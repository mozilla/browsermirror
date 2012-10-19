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

function doOnLoad(func) {
  /* Runs a function on window load, or immediately if the window has
     already loaded */
  if (this.document.readyState == 'complete') {
    func();
  } else {
    window.addEventListener('load', func, false);
  }
}


function getScreenRange(doc) {
  /* Returns {start, end} where these elements are the closest ones
     to the top and bottom of the currently-visible screen. */
  doc = doc || document;
  var win = doc.defaultView;
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

var TEMPORARY_HIGHLIGHT_DELAY = 10000;

function temporaryHighlight(el, offsetTop, offsetLeft, mode) {
  var doc = el.ownerDocument;
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
  doc.body.appendChild(circle);
  function canceller() {
    if (circle !== null) {
      doc.body.removeChild(circle);
      circle = null;
    }
  }
  setTimeout(canceller, TEMPORARY_HIGHLIGHT_DELAY);
  /*
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
    // FIXME: can't send nodes anymore
    this.displayMessage(message, (mode == 'local'));
  }
  */
  return canceller;
}

function binder(func, bindThis, name) {
  var name = func.name;
  function repl() {
    try {
      var result = func.apply(bindThis || this, arguments);
    } catch (e) {
      console.warn(name + "() raised:", e+'');
      throw e;
    }
    if (result !== undefined) {
      console.log(name + "() returned:", JSON.stringify(result));
    }
    return result;
  }
  return repl;
}
