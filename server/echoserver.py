import os
from tornado.websocket import WebSocketHandler
from tornado.web import RequestHandler, Application, StaticFileHandler
from itertools import count
try:
    import simplejson as json
except ImportError:
    import json

here = os.path.dirname(os.path.abspath(__file__))


class Queue(object):

    queues = {}
    max_length = 100

    def __init__(self, id):
        self.id = id
        self.sockets = []
        self.message_queue = []
        self.counter = count()

    def add_socket(self, socket):
        self.sockets.append(socket)

    def remove_socket(self, socket):
        self.sockets.remove(socket)

    def send_message(self, message, from_socket=None):
        for socket in self.sockets:
            if from_socket and from_socket is socket:
                continue
            socket.write_message(message)
        count = self.counter.next()
        self.message_queue.append((count, message))
        if len(self.message_queue) > self.max_length:
            self.message_queue[0:-self.max_length] = []
        return count

    def get_since(self, since):
        result = []
        latest = 0
        for count, message in self.message_queue:
            if count > since:
                result.append(message)
                latest = max(latest, count)
        return latest, result

    @classmethod
    def get(cls, id):
        if id not in cls.queues:
            cls.queues[id] = cls(id)
        return cls.queues[id]


class EchoWebSocket(WebSocketHandler):

    def open(self, id):
        self.queue = Queue.get(id)
        self.queue.add_socket(self)
        print "WebSocket opened: %s" % self.queue.id

    def on_message(self, message):
        print 'got message', message
        self.queue.send_message(message, self)

    def on_close(self):
        self.queue.remove_socket(self)
        print "WebSocket closed: %s" % self.queue.id


class XhrHandler(RequestHandler):

    def get_since(self):
        s = self.get_argument('since', None)
        if s:
            s = int(s)
        return s

    def get_everything(self, id):
        since = self.get_since()
        if since is None:
            return {}
        latest, messages = Queue.get(id).get_since(since)
        return {'since': latest, 'messages': messages}

    def send_json(self, data):
        self.request.set_header('Content-Type', 'application/json')
        self.request.write(json.dumps(data))
        self.request.finish()

    def get(self, id):
        data = self.get_everything(id)
        self.send_json(data)

    def post(self, id):
        queue = Queue.get(id)
        data = self.get_everything(id)
        req_data = json.loads(self.request.body)
        for message in req_data['messages']:
            count = queue.send_message(message)
            data['since'] = max(data['since'], count)
        self.send_json(data)


application = Application([
        (r'^/hub/(\w+)/xhr$', XhrHandler),
        (r'^/hub/(\w+)$', EchoWebSocket),
        (r'^/\w+/?()$', StaticFileHandler,
         dict(path=os.path.join(here, '../data/'),
              default_filename='view.html')),
        (r'^/()$', StaticFileHandler,
         dict(path=os.path.join(here, '../data/homepage.html'))),
        (r'^/(.*)', StaticFileHandler,
         dict(path=os.path.join(here, '../data')))
        ])
