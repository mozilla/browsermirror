from webob.dec import wsgify
from webob import Response
try:
    import simplejson as json
except ImportError:
    import json
import urlparse
import time


class Application(object):

    def __init__(self, jsmirror_location):
        self.data = {}
        self.data_last_modified = {}
        self.returndata = {}
        self.jsmirror_location = jsmirror_location

    @wsgify
    def __call__(self, req):
        path = req.path_info
        if path == '/bookmarklet':
            return self.make_bookmarklet(req)
        elif req.method == 'POST' and 'return' in req.GET:
            if path in self.returndata:
                data = json.loads(self.returndata[path])
                data.extend(json.loads(req.body))
                body = json.dumps(data)
            else:
                body = req.body
            print 'got returndata'
            self.returndata[path] = body
            return 'ok'
        if req.method == 'POST':
            now = time.time()
            body = json.loads(req.body)
            body['lastModified'] = now
            self.data[path] = json.dumps(body)
            self.data_last_modified[path] = now
            if path in self.returndata:
                print 'returning returndata for update', self.returndata[path]
            return self.returndata.pop(path, '[]')
        elif 'data' in req.GET:
            if 'if_modified_since' in req.params:
                try:
                    if_last_modified = float(req.params['if_modified_since'])
                except ValueError:
                    if_last_modified = None
                if (path in self.data_last_modified and if_last_modified
                    and if_last_modified >= self.data_last_modified[path]):
                    return Response('null')
            return self.data.get(path, '{}')
        elif 'getreturn' in req.GET:
            if path in self.returndata:
                print 'giving just returndata', self.returndata[path]
            return self.returndata.pop(path, '{}')
        else:
            return self.sub_jsmirror(req, self.template)

    def sub_jsmirror(self, req, template):
        location = urlparse.urljoin(req.application_url + '/', self.jsmirror_location)
        return template.replace('_JSMIRROR_', location)

    template = """\
<html>
<head>
<script src="_JSMIRROR_"></script>
<script>
var source = location.href+"";
if (source.indexOf('#') != -1) {
  source = source.substr(0, source.indexOf('#'));
}
source += '?data';
var mirror = new Mirror(source);
window.addEventListener('load', function () {
  mirror.poll();
  mirror.catchEvents();
}, false);
</script>
</head>
<body></body></html>
"""

    bookmarklet_js = """\
var n = 'jsmirror-script';
var s = document.getElementById(n);
if (s) {
document.body.removeChild(s);
}
s = document.createElement('script');
s.src = '_JSMIRROR_';
s.id = n;
document.body.appendChild(s);
window.runBookmarklet = '_APP_URL_';
"""

    bookmarklet_html = """\
<html><head><title>jsmirror Bookmarklet</title>
</head>
<body>
<h1>jsmirror Bookmarklet</h1>

<p>To install, drag this to your bookmarks:</p>
<h2><a href="javascript:_JS_">jsmirror</a></h2>
</body></html>
"""

    def make_bookmarklet(self, req):
        b = self.sub_jsmirror(req, self.bookmarklet_js)
        b = b.replace('_APP_URL_', req.application_url)
        b = b.replace('\n', '')
        b = b.replace(' = ', '=')
        b = '(function(){%s})()' % b
        html = self.bookmarklet_html.replace('_JS_', b)
        return Response(html, content_type='text/html')


@wsgify.middleware
def add_cors_headers(req, app):
    if req.method == 'OPTIONS':
        resp = Response('')
        resp.headers['Allow'] = 'GET,POST,PUT,OPTIONS'
    else:
        resp = req.get_response(app)
    resp.headers['Access-Control-Allow-Origin'] = '*'
    resp.headers['Access-Control-Request-Method'] = 'GET,POST,PUT,OPTIONS'
    return resp


if __name__ == '__main__':
    from paste.httpserver import serve
    from paste.urlmap import URLMap
    from paste.urlparser import StaticURLParser
    import os
    here = os.path.dirname(os.path.abspath(__file__))
    app = Application('../jsmirror.js')
    map = URLMap()
    map['/share'] = add_cors_headers(app)
    map['/'] = StaticURLParser(os.path.join(here))
    serve(map)
