/*
In-content share implementation for the addon
*/

var channel = null;
var master = null;

var myId = parseInt(Math.random()*1000, 10);

console.log('Starting up worker', myId);

self.port.on("StartShare", function () {
  channel = new PortProxyChannel();
  channel.send({hello: true, isMaster: true, supportsWebRTC: supportsWebRTC()});
  master = new Master(channel);
  channel.onmessage = function (data) {
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

self.port.on("ChatInput", function (message) {
  channel.send({chatMessages: [message]});
});
