// console messages don't show up in this context:
console = {
  log: function () {
    var s = "";
    for (var i=0; i<arguments.length; i++) {
      if (s) {
        s += " ";
      }
      if (typeof arguments[i] == "string") {
        s += arguments[i];
      } else {
        s += JSON.stringify(arguments[i]);
      }
    }
    alert(s);
  }
};
console.warn = console.error = console.info = console.debug = console.log;

var channel = new ChromePostMessageIncomingChannel();
channel.onmessage = function (data) {
  if (data.logout) {
    navigator.id.logout();
  }
};

window.addEventListener("load", function () {
  var el = document.getElementById('login');
  el.addEventListener('click', function (event) {
    event.preventDefault();
    event.stopPropagation();
    navigator.id.request();
  }, false);
}, false);

// Set loggedInUser using the channel?
navigator.id.watch({
  onlogin: function (assertion) {
    channel.send({
      assertion: assertion,
      audience: location.protocol + '//' + location.host
    });
  },
  onlogout: function () {
    channel.send({logout: true});
  }
});
