var channel = new PostMessageIncomingChannel();
channel.onmessage = function (data) {
  if (data.hello) {
    var el = document.getElementById('browsermirror-waiting');
    if (el) {
      el.innerHTML = 'Connected, waiting for document...';
    }
  }
  if (data.local && data.local.setClientId) {
    client.clientId = data.local.setClientId;
  }
  client.processCommand(data);
};

var clientId = null;
// FIXME: this is kind of a hacky way of getting the clientId on load:
if (localStorage.clientId) {
  clientId = localStorage.getItem("clientId");
}

var client = new Client(channel, clientId);

client.ontitlechange = function (title) {
  channel.send({local: {title: title}});
};

client.onfaviconchange = function (href) {
  channel.send({local: {favicon: {href: href}}});
};
