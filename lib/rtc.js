const { Cu, Ci, Cc } = require("chrome");
Cu.import("resource://gre/modules/Services.jsm");


const windowMediator = Cc['@mozilla.org/appshell/window-mediator;1'].
                       getService(Ci.nsIWindowMediator);

function getBrowser() {
  /*
  FIXME: this is how it's done in webrtcUI.jsm:

  let someWindow = Services.wm.getMostRecentWindow(null);
  let contentWindow = someWindow.QueryInterface(Ci.nsIInterfaceRequestor)
                                .getInterface(Ci.nsIDOMWindowUtils)
                                .getOuterWindowWithId(windowID);
  */
  let contentWindow = windowMediator.getMostRecentWindow("navigator:browser");
  let browser = contentWindow.QueryInterface(Ci.nsIInterfaceRequestor)
                               .getInterface(Ci.nsIWebNavigation)
                               .QueryInterface(Ci.nsIDocShell)
                               .chromeEventHandler;
  return browser;
}

function getUserMedia(options, onsuccess, onerror) {
  let browser = getBrowser();
  let navigator = browser.ownerDocument.defaultView.navigator;
  if (! onerror) {
    onerror = function (error) {
      Cu.reportError(error);
    };
  }
  navigator.mozGetUserMedia(options, onsuccess, onerror);
}

function getPeerConnection() {
  let browser = getBrowser();
  let win = browser.ownerDocument.defaultView;
  return new win.MozRTCPeerConnection();
}

exports.getUserMedia = getUserMedia;
