var connection = null;

var hub = location.pathname.replace(/\/*$/, '');
var address = 'ws';
if (location.href.toLowerCase().indexOf('https') == 0) {
  address += 's';
}
address += '://' + location.host + '/hub' + hub;

//address = 'wss://browsermirror.ianbicking.org/hub' + hub;

connection = new Connection(address, false);
var mirror = new Mirror(connection);
connection.ondata = function (datas) {
  datas.forEach(function (data) {
    mirror.processCommand(data);
  });
};
