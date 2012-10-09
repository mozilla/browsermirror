var connection = null;
var master = null;

var myId = parseInt(Math.random()*1000, 10);

console.log('Starting up worker', myId);

self.port.on("StartShare", function (address, shareUrl) {
  connection = new Connection(address, true);
  master = new Master(connection, shareUrl);
  connection.ondata = function (datas) {
    datas.forEach(function (data) {
      master.processCommand(data);
    });
  };
});

self.port.on("ChatInput", function (message) {
  master.sendChat([message]);
});
