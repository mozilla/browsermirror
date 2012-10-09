var WebSocketServer = require('websocket').server;
var WebSocketRouter = require('websocket').router;
var http = require('http');
var static = require('node-static');
var parseUrl = require('url').parse;

var dataRoot = new static.Server(__dirname + '/data');

var server = http.createServer(function(request, response) {
    var url = parseUrl(request.url);
    var filename = null;
    if (url.pathname == '/') {
      filename = '/homepage.html';
    } else if (url.pathname.indexOf('/static/') == 0) {
      filename = url.pathname.substr('/static/'.length);
    } else if (url.pathname.search(/^\/[^\/]+\/?$/) == 0) {
      filename = '/view.html';
    }
    if (filename) {
      dataRoot.serveFile(filename, 200, {}, request, response);
      return;
    }
    console.log((new Date()) + ' Received request for ' + request.url);
    response.writeHead(404);
    response.end();
});

function startServer(port) {
  server.listen(port, function() {
    console.log((new Date()) + ' Server is listening on port 8080');
  });
}

var wsServer = new WebSocketServer({
    httpServer: server,
    // You should not use autoAcceptConnections for production
    // applications, as it defeats all standard cross-origin protection
    // facilities built into the protocol and the browser.  You should
    // *always* verify the connection's origin and decide whether or not
    // to accept it.
    autoAcceptConnections: false
});

function originIsAllowed(origin) {
  // Unfortunately the origin will be whatever page you are sharing, which is
  // any possible origin.
  console.log('got origin', origin);
  return true;
}

var allConnections = {};

wsServer.on('request', function(request) {
  if (!originIsAllowed(request.origin)) {
    // Make sure we only accept requests from an allowed origin
    request.reject();
    console.log((new Date()) + ' Connection from origin ' + request.origin + ' rejected.');
    return;
  }

  var id = request.httpRequest.url.replace(/^\/hub\/+/, '').replace(/\/.*/, '');

  // FIXME: we should use a protocol here instead of null, but I can't get it to work
  var connection = request.accept(null, request.origin);
  if (! allConnections[id]) {
    allConnections[id] = [];
  }
  allConnections[id].push(connection);
  console.log((new Date()) + ' Connection accepted to ' + JSON.stringify(id));
  connection.on('message', function(message) {
    console.log('Message on ' + id + ' bytes: '
                + (message.utf8Data && message.utf8Data.length));
    for (var i=0; i<allConnections[id].length; i++) {
      var c = allConnections[id][i];
      if (c == connection) {
        continue;
      }
      if (message.type === 'utf8') {
        c.sendUTF(message.utf8Data);
      } else if (message.type === 'binary') {
        c.sendBytes(message.binaryData);
      }
    }
  });
  connection.on('close', function(reasonCode, description) {
    var index = allConnections[id].indexOf(connection);
    if (index != -1) {
      allConnections[id].splice(index, 1);
    }
    console.log((new Date()) + ' Peer ' + connection.remoteAddress + ' disconnected.');
  });
});

if (require.main == module) {
  startServer(8080);
}

exports.startServer = startServer;
