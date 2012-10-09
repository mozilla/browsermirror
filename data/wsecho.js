/* Acts as a kind of echoing websocket */

function startProxier() {
  var socket = null;
  var closing = false;
  function setupConnection(address, autoReconnect) {
    if (autoReconnect === undefined) {
      autoReconnect = true;
    }
    socket = new WebSocket(address);
    console.log('Connecting to', address);
    if (autoReconnect) {
      socket.onclose = function (event) {
        if (closing) {
          self.port.emit("eventClosed");
          return;
        }
        console.log("WebSocket closed", event.wasClean ? 'clean' : 'unclean',
                    "code:", event.code, "reason:", event.reason || 'none');
        setupConnection(address, autoReconnect);
      };
    }
    socket.onopen = function () {
      console.log("WebSocket connection initiated.");
      self.port.emit("eventOpened");
    };
    socket.onerror = function (event) {
      console.log("WebSocket error:", event.data);
    };
    socket.onmessage = function (event) {
      self.port.emit("dataReceived", event.data);
    };
  }
  self.port.on("openConnection", setupConnection);
  self.port.on("close", function () {
    closing = true;
    socket.close();
    socket = null;
  });
  self.port.on("sendData", function (data) {
    socket.send(data);
  });
}

self.port.on("startProxier", startProxier);

function ProxySocket(address) {
  this.readyState = this.CONNECTING;
  self.port.emit("openConnection", address);
  self.port.on("eventOpened", (function () {
    this.readyState = this.OPEN;
    if (this.onopen) {
      this.onopen();
    }
  }).bind(this));
  self.port.on("dataReceived", (function (data) {
    if (this.onmessage) {
      this.onmessage({data: data});
    }
  }).bind(this));
  self.port.on("eventClosed", (function () {
    this.readyState = this.CLOSED;
    if (this.onclose) {
      this.onclose();
    }
  }).bind(this));
}

ProxySocket.prototype = {
  onopen: null,
  onmessage: null,
  onclose: null,
  send: function (data) {
    self.port.emit("sendData", data);
  },
  close: function () {
    this.readyState = this.CLOSING;
    self.port.emit("close");
  },
  CONNECTING: 0,
  OPEN: 1,
  CLOSING: 2,
  CLOSED: 3
};
