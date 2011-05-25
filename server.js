if (process.argv[2] == '-h') {
  console.log('Usage:');
  console.log('  node server.js [PORT [HOSTNAME]]');
  console.log('Set $IO_BASE to the path of Socket.IO-node (version 0.6.18)');
  process.exit();
}

var http = require('http');
var url = require('url');
var fs = require('fs');
IO_BASE = process.env.IO_BASE;
if (! IO_BASE) {
  console.error('You must set $IO_BASE to the path of Socket.IO-node');
  process.exit(2);
}
var io = require(IO_BASE);

var SERVER_ADDRESS = null;

var server = http.createServer(function(req, res){
  var path = url.parse(req.url).pathname;
  if (path == '/') {
    sendPage(req, res, 'homepage.html');
  } else if (path.search(/^\/view\//) != -1) {
    var channelName = path.substr(6);
    sendPage(req, res, 'view.html', {_CHANNEL_: channelName});
  } else if (path == '/jsmirror.js') {
    fs.readFile(__dirname + '/jsmirror.js', 'utf8', function (err, data) {
      fs.readFile(IO_BASE + '/support/socket.io-client/socket.io.js', 'utf8', function (err, data2) {
        res.writeHead(200, {'Content-Type': 'text/javascript'});
        res.end(data + data2 + extra_js);
      });
    });
  }
});

// We can't run this until after the socket.io.js code is loaded:
var extra_js = '\ncheckBookmarklet();\n';

function sendPage(req, res, filename, vars) {
  vars = vars || {};
  vars._SERVER_ = SERVER_ADDRESS;
  vars._JSMIRROR_ = SERVER_ADDRESS + '/jsmirror.js';
  vars._SOCKET_IO_ = SERVER_ADDRESS + '/socket.io/socket.io.js';
  vars._WEB_SOCKET_ = SERVER_ADDRESS + '/socket.io/lib/vendor/web-socket-js/WebSocketMain.swf';
  vars._TOKEN_ = generateToken();
  vars['Content-Type'] = vars['Content-Type'] || 'text/html';
  filename = __dirname + '/' + filename;
  fs.readFile(filename, 'utf8', function (err, data) {
    if (err) {
      console.log('Error loading file:', filename, err);
      res.writeHead(404);
      res.end();
      return;
    }
    res.writeHead(200, {'Content-Type': vars['Content-Type']});
    for (var i in vars) {
      data = data.replace(i, vars[i]);
    }
    res.end(data);
  });
}

io = io.listen(server);

var channels = {};
var channelsBySessionId = {};

io.on('connection', function (client) {
  console.log('got new client', client.sessionId);
  if (client.sessionId in channelsBySessionId) {
    client.channel = channelsBySessionId[client.sessionId];
  }

  client.on('message', function (msg) {
    // FIXME: crazy overencoding:
    while (typeof msg == 'string') {
      msg = JSON.parse(msg);
    }
    var displayMsg = JSON.stringify(msg).substr(0, 70);
    console.info('received message', client.sessionId, displayMsg);
    if (msg.subscribe && ! client.channel) {
      // FIXME: check if already subscribed
      client.channel = msg.subscribe;
      channelsBySessionId[client.sessionId] = client.channel;
      if (! (client.channel in channels)) {
        channels[client.channel] = [];
      }
      console.info('subscribing', client.sessionId, msg.subscribe, channels[msg.subscribe].length);
      channels[client.channel].push(client);
    }
    if (! client.channel) {
      console.warn('client has no channel', displayMsg);
      return;
    }
    msg.sessionId = client.sessionId;
    var channelName = client.channel;
    console.log('message on channel', channelName, channels[channelName].length);
    var clientList = channels[channelName];
    for (var i=0; i<clientList.length; i++) {
      if (clientList[i] !== client) {
        console.info('Sending to socket', clientList[i].sessionId);
        clientList[i].send(JSON.stringify(msg));
      }
    }
  });

  client.on('disconnect', function () {
    console.info('saying goodbye', client.sessionId);
    var channelName = client.channel;
    var channelList = channels[channelName];
    if (! channelList) {
      console.warn('Disconnect from unknown channel:', channelName);
      return;
    }
    for (var i=0; i<channelList.length; i++) {
      if (channelList[i] === client) {
        channelList.splice(i, 1);
      }
    }
    if (! channelList.length) {
      delete channels[channelName];
    }
  });

});

var TOKEN_CHARS = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';

function generateToken() {
  var s = '';
  for (var i=0; i<10; i++) {
    s += TOKEN_CHARS.charAt(Math.random() * TOKEN_CHARS.length);
  }
  return s;
}

var port = 8080;
var hostname = 'localhost';

if (process.argv[2]) {
  port = parseInt(process.argv[2]);
}
if (process.argv[3]) {
  hostname = process.argv[3];
}

server.listen(port);
SERVER_ADDRESS = 'http://' + hostname;
if (port != 80) {
  SERVER_ADDRESS += ':' + port;
}
console.log('Serving on', SERVER_ADDRESS);
