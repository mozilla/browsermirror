var channel = new PostMessageIncomingChannel();
channel.onmessage = function (data) {
  if (data.hello) {
    var el = document.getElementById('browsermirror-waiting');
    if (el) {
      el.innerHTML = 'Connected, waiting for document...';
    }
  }
  client.processCommand(data);
};

var client = new Client(channel);
