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
    if (typeof ProxySocket != "undefined") {
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
    this.send({hello: true, isMaster: this.isMaster});
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
    console.log('Sending:', JSON.stringify(data).substr(0, 40));
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
        this.socket.send(JSON.stringify(this.queue[i]));
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
