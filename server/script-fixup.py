import re


def fixup(scripts):
    for req, script in scripts:
        fixup_script(script)

TEMPLATE = """\
#!/usr/bin/env python
import os, site
here = os.path.dirname(os.path.abspath(__file__))
site.addsitedir(os.path.join(here, 'vendor'))
site.addsitedir(os.path.join(here, 'vendor-binary'))

## Here is the normal script:

__CONTENT__
"""

future_re = re.compile(r'^from\s+__future__')


def fixup_script(script):
    with open(script) as fp:
        fp.readline()
        content = fp.read()
    content = TEMPLATE.replace('__CONTENT__', content)
    with open(script, 'w') as fp:
        fp.write(content)
