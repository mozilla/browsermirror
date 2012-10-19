VERBOSE = 10; DEBUG = 20; INFO = 30; NOTIFY = 40; WARN = ERROR = 50; CRITICAL = 60;
LOG_LEVEL = DEBUG;

function log(level) {
  if (level > WARN && console.trace) {
    console.trace();
  }
  if (typeof console == 'undefined') {
    return;
  }
  if (level < LOG_LEVEL) {
    return;
  }
  var args = [];
  for (var i=1; i<arguments.length; i++) {
    args.push(arguments[i]);
  }
  var method = 'log';
  if (level >= ERROR && console.error) {
    method = 'error';
  } else if (level >= INFO && console.info) {
    method = 'info';
  } else if (console.debug) {
    method = 'debug';
  }
  if (! console[method]) {
    method = 'log';
  }
  if (! console[method].apply) {
    // On Fennec I'm getting problems with console[method].apply
    console.log(args);
  } else {
    try {
      console[method].apply(console, args);
    } catch (e) {
      console[method].apply(console, ["Could not log: " + e]);
    }
  }
}
