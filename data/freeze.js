if (! window.Freeze) {
  var Freeze = {};
}

Freeze.makeId = function () {
  return 'el' + (arguments.callee.counter++);
};

// This makes it more sortable:
Freeze.makeId.counter=1000;

// These elements can have e.g., clientWidth of 0 but still be relevant:
Freeze.skipElementsOKEmpty = {
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

// These are elements that are empty, i.e., have no closing tag:
Freeze.voidElements = {
  AREA: true,
  BASE: true,
  BR: true,
  COL: true,
  COMMAND: true,
  EMBED: true,
  HR: true,
  IMG: true,
  INPUT: true,
  KEYGEN: true,
  LINK: true,
  META: true,
  PARAM: true,
  SOURCE: true,
  TRACK: true,
  WBR: true
};

// These elements are never sent:
Freeze.skipElementsBadTags = {
  SCRIPT: true,
  NOSCRIPT: true
};

Freeze.skipElement = function (el) {
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

Freeze.serializeDocument = function () {
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

// FIXME: this is hacky:
Freeze.elementTracker = {};

Freeze.trackElement = function (el) {
  var id = this.makeId();
  el.jsmirrorId = id;
  this.elementTracker.elements[id] = el;
};

Freeze.serializeElement = function (el, includeHTML) {
  /* Serializes a single element to a JSON object.
     The object looks like:
       [tagName, localId, {attrs}, [children...]]

     If includeHTML is true then an additional innerHTML item will be added to the end of each list
   */
  if (! el.jsmirrorId) {
    this.trackElement(el);
  }
  if (el.tagName == 'CANVAS') {
    return ['IMG', el.jsmirrorId, {src: el.toDataURL('image/png')}, []];
  }
  var attrs = this.serializeAttributes(el);
  var children;
  if (el.tagName == 'IFRAME') {
    children = [];
    try {
      var html = this.staticHTML(el.contentWindow.document.documentElement);
    } catch (e) {
      console.warn('Had to skip iframe for permission reasons:', e+'', 'src:', el.src);
      // A placeholder for the iframe:
      return ['SPAN', el.jsmirrorId, {}, []];
    }
    attrs.src = this.encodeData('text/html', html);
  } else {
    children = this.normalChildren(el);
    var length = children.length;
    for (var i=0; i<length; i++) {
      var child = children[i];
      if (typeof child !== 'string') {
        children[i] = this.serializeElement(children[i]);
      }
    }
  }
  var result = [el.tagName, el.jsmirrorId, attrs, children];
  if (includeHTML) {
    result.push(el.innerHTML);
  }
  return result;
};

Freeze.normalChildren = function (el) {
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
    if (child.nodeType == this.TEXT_NODE) {
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
    } else if (child.nodeType == this.ELEMENT_NODE) {
      result.push(child);
    }
  }
  return result;
};

/* Remove innerHTML from the document (if serializeElement was used
with innerHTML true) */
Freeze.filterInnerHTML = function (doc) {
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

Freeze.serializeAttributes = function (el) {
  /* Serialize the attributes of an element into a JSON object */
  var attrs = {};
  if (el.attributes) {
    var length = el.attributes.length;
    for (var i=0; i<length; i++) {
      var attrName = el.attributes[i].name;
      if (attrName.substr(0, 2).toLowerCase() == "on") {
        // Don't keep any event-based attributes
        continue;
      } else if (attrName == 'href' || attrName == 'src' || attrName == 'value') {
        // Dereference these fancy-like, which should make them absolute
        attrs[attrName] = el[attrName];
      } else {
        attrs[attrName] = el.attributes[i].nodeValue;
      }
    }
  }
  if (el.tagName == 'TEXTAREA') {
    // This doesn't show up as an attribute
    // FIXME: Perhaps all INPUT elements should get this treatment?
    attrs.value = el.value;
  }
  return attrs;
};

Freeze.compareAttributes = function (attrs, el) {
  /* Returns true if serializeAttributes(el) would produce attrs */
  var count = 0;
  var tagName = el.tagName;
  for (var i in attrs) {
    if (! attrs.hasOwnProperty(i)) {
      continue;
    }
    count++;
    var value;
    if (i == 'href' || i == 'src' || i == 'value') {
      value = el[i];
      if (! el.hasAttribute(i)) {
        // This happens in particularly with a virtual "value" attribute
        count--;
      }
    } else {
      value = el.getAttribute(i);
    }
    if (value != attrs[i]) {
      console.log('got diff in attributes', i);
      return false;
    }
  }
  var elAttrsLength = el.attributes.length;
  if (elAttrsLength == count) {
    return true;
  }
  // There might be "blocked" attributes
  for (i=0; i<elAttrsLength; i++) {
    var attr = el.attributes[i];
    if (attr.name.substr(0, 2).toLowerCase() == 'on') {
      count++;
    }
  }
  return count == elAttrsLength;
};

Freeze.compareAttributes2 = function (attrs, el) {
  var elAttrs = this.serializeAttributes(el);
  var result = true;
  for (var i in attrs) {
    if (attrs[i] != elAttrs[i]) {
      result = false;
    }
  }
  for (var i in elAttrs) {
    if (attrs[i] != elAttrs[i]) {
      result = false;
    }
  }
  var otherResult = this.compareAttributes(attrs, el);
  if (result != otherResult) {
    console.log('Disagreement', el.tagName, result, otherResult);
  }
  return result;
};


Freeze.htmlQuote = function (s) {
  /* Does minimal quoting of a string for embedding as a literal in HTML */
  if (! s) {
    return s;
  }
  if (s.search(/[&<"]/) == -1) {
    return s;
  }
  return s.replace(/&/g, "&amp;").replace(/</g, '&lt;').replace(/"/g, "&quot;");
};

Freeze.encodeData = function (content_type, data) {
  /* Encodes the given data as a data: URL */
  // FIXME: utf8?
  return 'data:' + content_type + ';base64,' + btoa(data);
};

Freeze.staticHTML = function (el) {
  /* Converts the element to static HTML, dropping anything that isn't static */
  if (el.tagName == 'CANVAS') {
    return '<IMG SRC="' + this.htmlQuote(el.toDataURL('image/png')) + '">';
  }
  var replSrc = null;
  if (el.tagName == 'IFRAME') {
    // FIXME: need to add <base> element
    try {
      var html = this.staticHTML(el.contentWindow.document.documentElement);
      replSrc = this.encodeData('text/html', html);
    } catch (e) {
      console.warn('Had to skip iframe for permission reasons:', e+'');
    }
  }
  var s = '<' + el.tagName;
  var attrs = el.attributes;
  var l;
  if (attrs && (l = attrs.length)) {
    for (var i=0; i<l; i++) {
      var name = attrs[i].name;
      if (name.substr(0, 2).toLowerCase() == "on") {
        continue;
      }
      if (name == 'src' && replSrc) {
        var value = replSrc;
      } else if (name == "href" || name == "src" || name == "value") {
        var value = el[name];
      } else {
        var value = attrs[i].nodeValue;
      }
      // FIXME: should the name be quoted in any fashion?
      s += ' ' + name + '="' + this.htmlQuote(value) + '"';
    }
  }
  s += '>';
  if (! this.voidElements[el.tagName]) {
    s += this.staticChildren(el);
    s += '</' + el.tagName + '>';
  }
  return s;
};

Freeze.getAttributes = function (el) {
  var result = [];
  var attrs = el.attributes;
  if (attrs && attrs.length) {
    var l = attrs.length;
    for (var i=0; i<l; i++) {
      var name = attrs[i].name;
      if (name.substr(0, 2).toLowerCase() == "on") {
        continue;
      }
      if (name == "href" || name == "src" || name == "value") {
        var value = el[name];
      } else {
        var value = attrs[i].nodeValue;
      }
      result.push([name, value]);
    }
  }
  return result;
};

Freeze.TEXT_NODE = document.TEXT_NODE;
Freeze.ELEMENT_NODE = document.ELEMENT_NODE;

Freeze.staticChildren = function (el) {
  /* Converts all the children of the given element to static HTML */
  var s = '';
  var children = el.childNodes;
  var l = children.length;
  for (var i=0; i<l; i++) {
    var child = children[i];
    if (this.skipElement(child)) {
      continue;
    }
    if (child.nodeType == this.TEXT_NODE) {
      var value = child.nodeValue;
      s += this.htmlQuote(value);
    } else if (child.nodeType == this.ELEMENT_NODE) {
      s += this.staticHTML(child);
    }
  }
  return s;
};
