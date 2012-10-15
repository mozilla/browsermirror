function Connection(address, isMaster) {
  if (address.search(/^https?:\/\//i) === 0) {
    address = address.replace(/^http/i, 'ws');
  }
  this.address = address;
  this.queue = [];
  this.cancelCounts = {};
  this.ondata = null;
  this.onerror = null;
  this.socket = null;
  this.xhrSince = 0;
  this.isMaster = isMaster;
  console.log('Created Connection');
  this.setupConnection();
}

Connection.prototype = {

  POLL_TIME: 5000,

  setupConnection: function () {
    if (this.address == "iframe") {
      this.socket = new PostMessageSocket();
      this.socket.onopen = (function () {
        this.flush();
      }).bind(this);
      this.socket.onmessage = (function (event) {
        this.ondata([JSON.parse(event.data)]);
      }).bind(this);
    } else if (typeof ProxySocket != "undefined") {
      console.log('Using ProxySocket for connection to', this.address);
      this.socket = new ProxySocket(this.address);
      this.socket.onopen = (function () {
        this.flush();
      }).bind(this);
      this.socket.onmessage = (function (event) {
        this.ondata([JSON.parse(event.data)]);
      }).bind(this);
    } else if (typeof WebSocket != "undefined") {
      log(INFO, 'Setup WebSocket connection to', this.address);
      // Note, this seems to fail when the page is an https page
      // (perhaps when the websocket is ws:, not wss:)
      //
      // FIXME: we'd like to change the Origin of the WebSocket, using
      // magical high-permission powers, but as it stands currently
      // the Origin will be the current page.
      console.log('Setting up new connection to', this.address);
      this.socket = new WebSocket(this.address);
      this.socket.onopen = (function () {
        console.log('WebSocket connection initiated.');
        this.flush();
      }).bind(this);
      this.socket.onmessage = (function (event) {
        this.ondata([JSON.parse(event.data)]);
      }).bind(this);
      this.socket.onerror = (function (event) {
        console.log('WebSocket error:', event.data);
      }).bind(this);
      this.socket.onclose = (function (event) {
        console.log('WebSocket close', event.wasClean ? 'clean' : 'unclean',
                    'code:', event.code, 'reason:', event.reason || 'none');
        this.setupConnection();
      }).bind(this);
    } else {
      this.schedulePoll();
      log(INFO, 'Setup XHR polling to', this.address);
    }
    this.send({hello: true, isMaster: this.isMaster,
               supportsWebRTC: supportsWebRTC()});
  },

  schedulePoll: function () {
    this.xhrTimeout = setTimeout((function () {
      this.pollXhr((function () {
        this.schedulePoll();
      }).bind(this));
    }).bind(this), this.POLL_TIME);
  },

  send: function (data) {
    if (data === undefined) {
      throw 'You cannot send undefined';
    }
    console.log('Sending:', JSON.stringify(data).substr(0, 40), JSON.stringify(data).length);
    this.queue.push(data);
    this.flush();
  },

  close: function () {
    if (this.socket) {
      this.socket.close();
    } else if (this.xhrTimeout) {
      clearTimeout(this.xhrTimeout);
    }
  },

  flush: function () {
    if (! this.queue.length) {
      return;
    }
    if (! this.socket) {
      this.postXhr();
    } else if (this.socket.readyState == this.socket.OPEN) {
      for (var i=0; i<this.queue.length; i++) {
        var data = this.queue[i];
        data = JSON.stringify(data);
        this.socket.send(data);
      }
      this.queue = [];
    }
  },

  postXhr: function () {
    var req = new XMLHttpRequest();
    req.open('POST', this.address + '/xhr?since=' + encodeURIComponent(this.xhrSince));
    req.onreadystatechange = (function () {
      if (req.readyState != 4) {
        return;
      }
      var resp = JSON.parse(req.responseText);
      this.getXhrResponse(resp);
      this.queue = [];
    }).bind(this);
    req.send(JSON.stringify({messages: this.queue}));
  },

  pollXhr: function (callback) {
    var req = new XMLHttpRequest();
    req.open('GET', this.address + '/xhr?since=' + encodeURIComponent(this.xhrSince));
    req.onreadystatechange = (function () {
      if (req.readyState != 4) {
        return;
      }
      var resp = JSON.parse(req.responseText);
      this.getXhrResponse(resp);
      if (callback) {
        callback();
      }
    }).bind(this);
    req.send();
  },

  getXhrResponse: function (data) {
    this.xhrSince = data.since;
    this.ondata(data.messages);
  }

};

function PostMessageSocket() {
  window.addEventListener("message", this._receiveMessage.bind(this), false);
  this._source = null;
  this._sourceOrigin = null;
  this.readyState = this.CONNECTING;
}

PostMessageSocket.prototype = {
  onopen: null,
  onmessage: null,
  onclose: null,
  _receiveMessage: function (event) {
    if (! this._source) {
      this._source = event.source;
      this._sourceOrigin = event.origin;
    } else if (this._sourceOrigin != event.origin) {
      // This shouldn't happen
      console.warn("Origin mismatch; original origin:", this._sourceOrigin,
                   "message origin:", event.origin);
      return;
    }
    if (event.data == "helloPostMessage") {
      // Just a hello/ping
      event.source.postMessage("helloPostMessage", event.origin);
      if (this.onopen) {
        this.onopen();
      }
      this.readyState = this.OPEN;
      return;
    }
    if (this.onmessage) {
      this.onmessage(event);
    }
  },
  send: function (data) {
    if (! this._source) {
      throw 'The postMessage transport has not been initiated';
    }
    this._source.postMessage(data, this._sourceOrigin);
  },
  close: function () {
    this.readyState = this.CLOSING;
    this._source.postMessage("closed", this._sourceOrigin);
  },
  CONNECTING: 0,
  OPEN: 1,
  CLOSING: 2,
  CLOSED: 3
};

function PostMessageOutgoing(iframe, sameOrigin) {
  this._iframe = iframe;
  if (sameOrigin) {
    this._origin = location.protocol + '//' + location.host;
  } else {
    this._origin = null;
  }
  // FIXME: get host here?
  this.readyState = this.OPENING;
  this._iframe.contentWindow.addEventListener("message", this._receiveMessage.bind(this), false);
  this._ping();
}

PostMessageOutgoing.prototype = {
  onopen: null,
  onmessage: null,

  _ping: function () {
    if (this.readyState == this.OPEN) {
      return;
    }
    this._iframe.contentWindow.postMessage("helloPostMessage", "*");
    this._timeout = setTimeout(this._ping.bind(this), 1000);
  },

  _receiveMessage: function (event) {
    if (this._origin === null) {
      this._origin = event.origin;
    }
    if (this._origin != event.origin) {
      console.warn("Bad origin, expected:", this._origin, "got:", event.origin);
      return;
    }
    if (event.data == "helloPostMessage") {
      if (this._timeout) {
        clearTimeout(this._timeout);
        this._timeout = null;
      }
      if (this.onopen) {
        this.onopen();
      }
    } else {
      if (this.onmessage) {
        this.onmessage(event);
      }
    }
  },

  send: function (data) {
    if (typeof data == "object") {
      data = JSON.stringify(data);
    }
    this._iframe.contentWindow.postMessage(data, this._origin || '*');
  },

  CONNECTING: 0,
  OPEN: 1,
  CLOSING: 2,
  CLOSED: 3
};
