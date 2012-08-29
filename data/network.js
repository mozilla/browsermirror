function Connection(address) {
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
  this.setupConnection();
}

Connection.prototype = {

  POLL_TIME: 5000,

  setupConnection: function () {
    if (typeof WebSocket != "undefined") {
      console.log('Setup WebSocket connection to', this.address);
      this.socket = new WebSocket(this.address);
      this.socket.onopen = (function () {
        this.flush();
      }).bind(this);
      this.socket.onmessage = (function (event) {
        this.ondata([JSON.parse(event.data)]);
      }).bind(this);
      this.socket.onclose = (function () {
        this.setupConnection();
      }).bind(this);
    } else {
      this.schedulePoll();
      console.log('Setup XHR polling to', this.address);
    }
    this.send({hello: true});
  },

  schedulePoll: function () {
    this.xhrTimeout = setTimeout((function () {
      this.pollXhr((function () {
        this.schedulePoll();
      }).bind(this));
    }).bind(this), this.POLL_TIME);
  },

  send: function (data) {
    console.log('sending data', JSON.stringify(data).length);
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
      console.log('sending items to socket', this.queue.length);
      for (var i=0; i<this.queue.length; i++) {
        console.log('sending', this.socket, JSON.stringify(this.queue[i]).length);
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


/*
var connection = null;

if (typeof self !== "undefined") {
  self.port.on("StartConnection", function (address) {
    connection = new Connection(address);
    connection.ondata = function (datas) {
      self.port.emit("Data", datas);
    };
    connection.onerror = function (error) {
      self.port.emit("Error", error);
    };
  });
}
*/
