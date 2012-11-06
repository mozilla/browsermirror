function Class(proto) {
  var makeInstance = function () {
    var instance = Object.create(proto);
    instance.constructor.apply(instance, arguments);
    return instance;
  };
  makeInstance.prototype = proto;
  return makeInstance;
}

var Users = Class({
  constructor: function (containerEl) {
    this.data = {};
    this.containerEl = containerEl;
  },

  get: function (clientId) {
    if (! this.data.hasOwnProperty(clientId)) {
      var user = new User(clientId, this);
      user.addToUserList(this.containerEl);
      this.data[clientId] = user;
      return user;
    } else {
      return this.data[clientId];
    }
  },

  checkAll: function () {
    for (var i in this.data) {
      if (! this.data.hasOwnProperty(i)) {
        continue;
      }
      var user = this.data[i];
      user.checkTimeout();
    }
  },

  removeUser: function (user) {
    delete this.data[user.clientId];
  },

  setContainer: function (el) {
    this.containerEl = el;
    for (var i in this.data) {
      if (! this.data.hasOwnProperty(i)) {
        continue;
      }
      this.data[i].addToUserList(el);
    }
  },

  destroy: function () {
    for (var i in this.data) {
      if (! this.data.hasOwnProperty(i)) {
        continue;
      }
      this.data[i].removeUser();
    }
    this.data = {};
  }
});

function User(clientId, users) {
  this.clientId = clientId;
  this.users = users;
  this.lastPing = Date.now();
}

User.prototype = {

  MAX_PING_TIME: 1000 * 60 * 30, // 30 minutes
  BYE_TIMEOUT: 1000, // 1 second until a "bye" is final
  defunct: false,
  timingOut: false,

  processCommand: function (command) {
    this.lastPing = Date.now();
    if (this.timingOut) {
      this.setTimingOut();
    }
    this.timingOut = false;
    if (command.email) {
      // FIXME: this just trusts the user
      this.setEmail(command.email);
    }
    if (command.bye) {
      this.defunct = true;
      // FIXME: show that the user is going?
      this.timingOut = true;
      this.setTimingOut();
      setTimeout(this.checkTimeout.bind(this), this.BYE_TIMEOUT);
    }
  },

  checkTimeout: function () {
    if (this.timingOut) {
      this.removeUser();
    }
    if (this.isExpired()) {
      this.timingOut = true;
      this.setTimingOut();
      setTimeout(this.checkTimeout.bind(this), this.BYE_TIMEOUT);
    }
  },

  setTimingOut: function () {
    if (! this.userElement) {
      return;
    }
    if (this.timingOut) {
      if (this.userElement.className.search(/timing-out/) == -1) {
        this.userElement.className += ' timing-out';
      }
    } else if (this.userElement.className.search(/timing-out/) != -1) {
      this.userElement.className = this.userElement.className.replace(/\s*timing-out/, '');
    }
  },

  setEmail: function (email) {
    if (this.email) {
      this.email = null;
      this.showIcon();
      this.showName();
    }
    this.email = email;
    this.addIcon();
    this.showName();
  },

  showIcon: function () {
    if (! this.userElement) {
      return;
    }
    if (this.email) {
      var img = this.userElement.ownerDocument.createElememnt('img');
      img.src = secureGravatar(this.email, 32, 'retro');
      img.className = 'profile';
      this.userElement.insertBefore(img, this.userElement.childNodes[0]);
    } else {
      var el = this.userElement.querySelector('img.profile');
      if (el) {
        el.parentNode.removeChild(el);
      }
    }
  },

  showName: function () {
    if (! this.userElement) {
      return;
    }
    var el = this.userElement.querySelector('span.username');
    el.innerHTML = '';
    el.appendChild(el.ownerDocument.createTextNode(this.email || 'unknown person'));
    el.className = 'username';
    if (! this.email) {
      el.className += ' unknown';
    }
  },

  isExpired: function () {
    if (this.defunct) {
      return true;
    }
    return Date.now() - this.lastPing > this.MAX_PING_TIME;
  },

  removeUser: function () {
    if (this.userElement) {
      this.userElement.parentNode.removeChild(this.userElement);
    }
    this.userElement = null;
    this.users.removeUser(this);
  },

  addToUserList: function (userListEl) {
    if (this.userElement) {
      this.removeUser();
    }
    if (! userListEl) {
      return;
    }
    var doc = userListEl.ownerDocument;
    this.userElement = doc.createElement('div');
    this.userElement.className = 'user';
    var name = doc.createElement('span');
    name.className = 'username';
    this.userElement.appendChild(name);
    userListEl.appendChild(this.userElement);
  }

};

function secureGravatar(email, size, fallback) {
  email = email.replace(/^\s*/, '');
  email = email.replace(/\s*$/, '');
  email = email.toLowerCase();
  return ('https://secure.gravatar.com/avatar/' +
          hex_md5(email) +
          '?size=' + encodeURIComponent(size) +
          'd=' + encodeURIComponent(fallback));
}


if (typeof require != "undefined") {
  hex_md5 = require("./chrome-md5.js").hex_md5;
  setTimeout = require("timers").setTimeout;
}

if (typeof exports != "undefined") {
  exports.Users = Users;
}
