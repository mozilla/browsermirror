#!/usr/bin/env python
import os
import site
here = os.path.dirname(os.path.abspath(__file__))
site.addsitedir(os.path.join(here, 'vendor'))
site.addsitedir(os.path.join(here, 'vendor-binary'))

from echoserver import application
import optparse


parser = optparse.OptionParser(
    usage='%prog [OPTIONS]',
    )
parser.add_option('-H', '--host', metavar='HOST', default='localhost')
parser.add_option('-p', '--port', metavar='PORT', default='8080')


def main():
    import tornado.ioloop
    options, args = parser.parse_args()
    application.listen(int(options.port))
    print 'Started on %s:%s' % (options.host, options.port)
    tornado.ioloop.IOLoop.instance().start()


if __name__ == '__main__':
    main()
