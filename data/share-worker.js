/*
In-content share implementation for the addon
*/

var channel = null;
var master = null;

var myId = parseInt(Math.random()*1000, 10);

console.log('Starting up worker', myId);

self.port.on("StartShare", function () {
  channel = new PortChannel(self.port);
  console.log('Starting channel:', channel.toString());
  channel.send({hello: true, isMaster: true, supportsWebRTC: supportsWebRTC()});
  master = new Master(channel, unsafeWindow.document);
  channel.onmessage = function (data) {
    /*
    if (data.chatMessage) {
      self.port.emit("LocalMessage", data);
    }
    if (data.bye) {
      // FIXME: should sanitize ID
      self.port.emit("LocalMessage", {chatMessage: "Bye!", messageId: "browsermirror-bye-" + data.clientId});
    }
    if (data.hello) {
      self.port.emit("LocalMessage", {connected: data.clientId});
    }
    */
    if (data.rtcOffer || data.rtcAnswer) {
      console.log('Got remote offer');
      self.port.emit("RTC", data);
      return;
    }
    if (data.supportsWebRTC && supportsWebRTC()) {
      self.port.emit("SupportsWebRTC");
    }
    if (data.hello) {
      channel.send({helloBack: true, isMaster: true, supportsWebRTC: supportsWebRTC()});
    }
    master.processCommand(data);
  };
});
